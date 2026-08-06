/**
 * Windows agent shell sandbox via WSL2 + Landlock (MIN-553 Phase 6).
 *
 * Cursor-shaped: route agent one-shots through WSL, then apply the same
 * minnow-sandbox Landlock helper *inside* that tree. Bare wsl.exe alone is
 * NOT containment (host drives are RW at /mnt/c) — never report applied:true
 * without the Landlock helper in the Linux-side argv.
 *
 * Dedicated Minnow WSL distro is out of scope; native Win sandbox is future work.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  listMinnowSandboxHelperCandidates,
  LANDLOCK_EXIT_ABI_UNAVAILABLE,
  resolveMinnowSandboxHelper,
  wrapWithLandlock,
} from './landlock.js';
import { SANDBOX_UNAVAILABLE_REASON, describeSandboxUnavailable } from './unavailable.js';
import {
  buildWslOneShotSpawn,
  listWslDistros,
  windowsPathToWslPath,
} from '../wsl.js';

const HELPER_BASENAME = 'minnow-sandbox';

/** Relative path under $HOME inside the distro (avoid /mnt/… noexec). */
export const WSL_HELPER_INSTALL_REL = '.local/share/minnow/minnow-sandbox';

/** @type {{ result: { ok: boolean, reason?: string, detail?: string, helperPath?: string, abi?: number } } | null} */
let wslLandlockProbeCache = null;

/**
 * Cached absolute path of the helper installed inside a WSL distro.
 * Keyed by distro id (`""` for default) so switching distros cannot reuse a stale path.
 * @type {Map<string, string>}
 */
const wslInstalledHelperByDistro = new Map();

/**
 * @param {string | null | undefined} distro
 * @returns {string}
 */
function distroCacheKey(distro) {
  return distro && String(distro).trim() ? String(distro).trim() : '';
}

/**
 * Reset Phase-6 probe cache (tests only).
 */
export function resetWslLandlockProbeCache() {
  wslLandlockProbeCache = null;
  wslInstalledHelperByDistro.clear();
}

/**
 * True when the spawn target is already a wsl.exe invocation.
 * @param {{ command?: string }} spawnTarget
 * @returns {boolean}
 */
export function isWslExeSpawn(spawnTarget) {
  const cmd = spawnTarget?.command;
  if (typeof cmd !== 'string') return false;
  const base = path.basename(cmd).toLowerCase();
  return base === 'wsl.exe' || base === 'wsl';
}

/**
 * Split `wsl.exe` argv at the `--` separator into prefix (distro/cd) and Linux argv.
 * @param {string[]} args
 * @returns {{ prefix: string[], innerArgv: string[] } | null}
 */
export function splitWslArgv(args) {
  if (!Array.isArray(args)) return null;
  const dd = args.indexOf('--');
  if (dd < 0) return null;
  return {
    prefix: args.slice(0, dd),
    innerArgv: args.slice(dd + 1),
  };
}

/**
 * Parse the Linux-side command from a wsl.exe spawn target.
 * @param {{ command: string, args?: string[] }} spawnTarget
 * @returns {{ command: string, args: string[] } | null}
 */
export function extractWslInnerSpawn(spawnTarget) {
  if (!isWslExeSpawn(spawnTarget)) return null;
  const split = splitWslArgv(spawnTarget.args ?? []);
  if (!split || split.innerArgv.length === 0) return null;
  return {
    command: split.innerArgv[0],
    args: split.innerArgv.slice(1),
  };
}

/**
 * Recover a logical command from a Windows one-shot (cmd.exe /c …) for WSL rewrite.
 * @param {{ command: string, args?: string[], shell?: boolean }} spawnTarget
 * @returns {{ command: string, args: string[] }}
 */
export function recoverCommandFromWinSpawn(spawnTarget) {
  const args = Array.isArray(spawnTarget.args) ? spawnTarget.args : [];
  const base = path.basename(String(spawnTarget.command || '')).toLowerCase();
  if (base === 'cmd.exe' || base === 'cmd') {
    // resolveOneShotSpawn: cmd.exe /d /s /c <string>
    const cIdx = args.findIndex((a) => a === '/c' || a === '/C');
    if (cIdx >= 0 && typeof args[cIdx + 1] === 'string') {
      return { command: args[cIdx + 1], args: [] };
    }
  }
  return {
    command: spawnTarget.command,
    args,
  };
}

/**
 * Ensure the spawn goes through wsl.exe (required for Landlock on Windows).
 * Leaves an existing WSL spawn untouched.
 *
 * @param {{ command: string, args?: string[], shell?: boolean, cwd?: string, env?: NodeJS.ProcessEnv }} spawnTarget
 * @param {{ distro?: string | null, cwd?: string | null }} [opts]
 * @returns {{ command: string, args: string[], shell: boolean, cwd?: string, env?: NodeJS.ProcessEnv }}
 */
export function ensureWslOneShotSpawn(spawnTarget, { distro = null, cwd = null } = {}) {
  if (isWslExeSpawn(spawnTarget)) {
    return {
      command: spawnTarget.command,
      args: Array.isArray(spawnTarget.args) ? [...spawnTarget.args] : [],
      shell: false,
      ...(spawnTarget.cwd != null ? { cwd: spawnTarget.cwd } : {}),
      ...(spawnTarget.env != null ? { env: spawnTarget.env } : {}),
    };
  }

  const recovered = recoverCommandFromWinSpawn(spawnTarget);
  const wslCwd =
    cwd ??
    (typeof spawnTarget.cwd === 'string' && /^[a-zA-Z]:[\\/]/.test(spawnTarget.cwd)
      ? spawnTarget.cwd
      : null);

  const built = buildWslOneShotSpawn({
    command: recovered.command,
    args: recovered.args,
    distro,
    cwd: wslCwd ?? undefined,
  });

  return {
    ...built,
    ...(spawnTarget.env != null ? { env: spawnTarget.env } : {}),
  };
}

/**
 * Translate a host (Windows) helper path to the path WSL will exec.
 * Already-POSIX paths (including bare `minnow-sandbox`) pass through.
 *
 * @param {string} helperPath
 * @returns {string}
 */
export function hostHelperPathToWsl(helperPath) {
  if (typeof helperPath !== 'string' || !helperPath.trim()) return helperPath;
  const trimmed = helperPath.trim();
  // Bare PATH name inside the distro
  if (!trimmed.includes('/') && !trimmed.includes('\\') && !/^[a-zA-Z]:/.test(trimmed)) {
    return trimmed;
  }
  return windowsPathToWslPath(trimmed);
}

/**
 * True when a WSL-side path is under /mnt/… (NTFS bind — often noexec).
 * @param {string} wslPath
 * @returns {boolean}
 */
export function isWslMountPath(wslPath) {
  return typeof wslPath === 'string' && /^\/mnt\/[a-zA-Z](\/|$)/.test(wslPath);
}

/**
 * Pure decision for where the Landlock helper should run inside WSL.
 *
 * When a host/Electron ELF is available, always (re)install into the distro FS —
 * never trust a pre-existing `~/.local/share/minnow/minnow-sandbox` (stale or planted
 * binary that is `exec "$@"` would still look "wrapped"). `/mnt/…` is never a success
 * path here (noexec); install failure must fail closed at the caller.
 *
 * @param {object} input
 * @param {string | null | undefined} [input.envOverride] MINNOW_SANDBOX_HELPER
 * @param {string | null | undefined} [input.hostHelperPath] Windows-visible ELF
 * @param {boolean} [input.installedExists] whether ~/.local/share/minnow/minnow-sandbox exists
 * @param {string | null | undefined} [input.installedPath] absolute path inside the distro
 * @param {boolean} [input.allowBareName]
 * @returns {{
 *   action: 'use-override' | 'use-installed' | 'install' | 'use-bare' | 'missing',
 *   wslPath?: string,
 *   hostPath?: string,
 *   reason?: string,
 * }}
 */
export function planWslHelperProvision({
  envOverride = null,
  hostHelperPath = null,
  installedExists = false,
  installedPath = null,
  allowBareName = false,
} = {}) {
  const override = typeof envOverride === 'string' ? envOverride.trim() : '';
  if (override) {
    // Bare name or already-Linux path — honor without copying.
    if (override.startsWith('/') || (!override.includes('\\') && !/^[a-zA-Z]:/.test(override))) {
      return { action: 'use-override', wslPath: override };
    }
    // Windows path override → always reinstall from that host ELF (authenticity).
    return { action: 'install', hostPath: override };
  }

  // Host/Electron ELF present → always refresh the distro copy (upgrade + authenticity).
  if (hostHelperPath) {
    return { action: 'install', hostPath: hostHelperPath };
  }

  // No packaged ELF — reuse an already-installed copy if present (dev / PATH setup).
  if (installedExists && installedPath) {
    return { action: 'use-installed', wslPath: installedPath };
  }

  if (allowBareName) {
    return { action: 'use-bare', wslPath: HELPER_BASENAME };
  }

  return {
    action: 'missing',
    reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
  };
}

/**
 * Resolve $HOME inside a WSL distro (absolute path, no tilde).
 * @param {object} [opts]
 * @param {string | null} [opts.distro]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.homeFixture] test inject
 * @returns {string | null}
 */
export function resolveWslHome(opts = {}) {
  if (typeof opts.homeFixture === 'string' && opts.homeFixture) {
    return opts.homeFixture;
  }
  const spawnFn = opts.spawnSyncFn ?? spawnSync;
  /** @type {string[]} */
  const wslArgs = [];
  if (opts.distro) wslArgs.push('-d', opts.distro);
  wslArgs.push('--', 'bash', '-lc', 'printf %s "$HOME"');
  const result = spawnFn('wsl.exe', wslArgs, {
    encoding: 'utf8',
    timeout: 10_000,
    env: opts.env ?? process.env,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  const home = String(result.stdout || '').trim();
  return home.startsWith('/') ? home : null;
}

/**
 * Absolute install path for the helper inside WSL (`$HOME/.local/share/minnow/…`).
 * @param {string} home
 * @returns {string}
 */
export function wslInstalledHelperPath(home) {
  const base = String(home || '').replace(/\/+$/, '');
  return `${base}/${WSL_HELPER_INSTALL_REL}`;
}

/**
 * Copy the host-visible Linux ELF into the distro Linux FS and chmod +x.
 * Prefers that path for probe/wrap over `/mnt/c/…` (noexec).
 *
 * @param {string} hostHelperPath Windows path to the ELF
 * @param {object} [opts]
 * @returns {{ ok: true, helperPath: string } | { ok: false, reason: string, detail: string }}
 */
export function installHelperIntoWsl(hostHelperPath, opts = {}) {
  if (!hostHelperPath) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
    };
  }

  try {
    if (!opts.skipHostExistsCheck && !fs.existsSync(hostHelperPath)) {
      return {
        ok: false,
        reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
        detail: `Host Landlock helper missing: ${hostHelperPath}`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const home =
    opts.home ??
    resolveWslHome({
      distro: opts.distro ?? null,
      spawnSyncFn: opts.spawnSyncFn,
      env: opts.env,
      homeFixture: opts.homeFixture,
    });
  if (!home) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE,
      detail: 'Could not resolve $HOME inside WSL for minnow-sandbox install',
    };
  }

  const dest = opts.destPath ?? wslInstalledHelperPath(home);
  const srcWsl = hostHelperPathToWsl(hostHelperPath);
  const destDir = dest.replace(/\/[^/]+$/, '');
  const cacheKey = distroCacheKey(opts.distro);

  // Argv-only wsl.exe calls — do NOT rely on Windows→Linux env passthrough
  // (WSL drops env vars unless listed in WSLENV; empty $MN_* made install silently fail).
  /** @param {string[]} linuxArgv */
  const buildWslArgs = (linuxArgv) => {
    /** @type {string[]} */
    const wslArgs = [];
    if (opts.distro) wslArgs.push('-d', opts.distro);
    wslArgs.push('--', ...linuxArgv);
    return wslArgs;
  };

  if (typeof opts.copyFn === 'function') {
    const copied = opts.copyFn({
      hostHelperPath,
      srcWsl,
      dest,
      destDir,
      steps: [
        ['mkdir', '-p', destDir],
        ['cp', '-f', srcWsl, dest],
        ['chmod', '+x', dest],
        ['test', '-x', dest],
      ],
    });
    if (!copied?.ok) {
      return {
        ok: false,
        reason: copied?.reason ?? SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
        detail: copied?.detail ?? 'WSL helper install copyFn failed',
      };
    }
    wslInstalledHelperByDistro.set(cacheKey, dest);
    return { ok: true, helperPath: dest };
  }

  const spawnFn = opts.spawnSyncFn ?? spawnSync;
  const steps = [
    ['mkdir', '-p', destDir],
    ['cp', '-f', srcWsl, dest],
    ['chmod', '+x', dest],
    ['test', '-x', dest],
  ];

  for (const linuxArgv of steps) {
    const result = spawnFn('wsl.exe', buildWslArgs(linuxArgv), {
      encoding: 'utf8',
      timeout: 30_000,
      env: opts.env ?? process.env,
      windowsHide: true,
    });

    if (result.error) {
      const msg = result.error.message || String(result.error);
      const isWslMissing = result.error.code === 'ENOENT' || /wsl\.exe/i.test(msg);
      return {
        ok: false,
        reason: isWslMissing
          ? SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE
          : SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
        detail: msg,
      };
    }

    if (result.status !== 0) {
      const stderr = String(result.stderr || '').trim();
      return {
        ok: false,
        reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
        detail:
          stderr ||
          `WSL helper install step failed (${linuxArgv.join(' ')}) exit ${result.status}`,
      };
    }
  }

  wslInstalledHelperByDistro.set(cacheKey, dest);
  return { ok: true, helperPath: dest };
}

/**
 * Probe whether the installed helper already exists inside WSL (executable).
 * @param {object} [opts]
 * @returns {string | null} absolute WSL path or null
 */
export function probeInstalledWslHelper(opts = {}) {
  if (opts.installedPathFixture != null) {
    return opts.installedPathFixture || null;
  }
  const cacheKey = distroCacheKey(opts.distro);
  if (wslInstalledHelperByDistro.has(cacheKey)) {
    return wslInstalledHelperByDistro.get(cacheKey) ?? null;
  }

  const home =
    opts.home ??
    resolveWslHome({
      distro: opts.distro ?? null,
      spawnSyncFn: opts.spawnSyncFn,
      env: opts.env,
      homeFixture: opts.homeFixture,
    });
  if (!home) return null;

  const dest = wslInstalledHelperPath(home);
  const spawnFn = opts.spawnSyncFn ?? spawnSync;
  /** @type {string[]} */
  const wslArgs = [];
  if (opts.distro) wslArgs.push('-d', opts.distro);
  // Argv-only — paths as args, not bash -lc / env (WSL drops Windows env by default).
  wslArgs.push('--', 'test', '-x', dest);

  const result = spawnFn('wsl.exe', wslArgs, {
    encoding: 'utf8',
    timeout: 10_000,
    env: opts.env ?? process.env,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  wslInstalledHelperByDistro.set(cacheKey, dest);
  return dest;
}

/**
 * Resolve a Landlock helper path usable *inside* WSL.
 * Prefers `~/.local/share/minnow/minnow-sandbox` (auto-install from host ELF) over
 * `/mnt/…` mounts. `MINNOW_SANDBOX_HELPER` override still wins for Linux paths /
 * bare names; Windows-path overrides are treated as the host ELF source.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{
 *   resourcesPath?: string,
 *   moduleDir?: string,
 *   allowBareName?: boolean,
 *   hostHelperPath?: string | null,
 *   skipInstall?: boolean,
 *   distro?: string | null,
 *   installedPathFixture?: string | null,
 *   homeFixture?: string,
 *   spawnSyncFn?: typeof spawnSync,
 *   copyFn?: Function,
 * }} [opts]
 * @returns {string | null} WSL-side path or basename, or null
 */
export function resolveWslLandlockHelper(env = process.env, opts = {}) {
  // Explicit inject for unit tests — bypass install / host discovery.
  if (opts.hostHelperPath != null) {
    if (!opts.hostHelperPath) return opts.allowBareName ? HELPER_BASENAME : null;
    return hostHelperPathToWsl(opts.hostHelperPath);
  }

  const override = env.MINNOW_SANDBOX_HELPER?.trim() || '';

  // Linux-side / bare override: use as-is (no copy).
  if (
    override &&
    (override.startsWith('/') || (!override.includes('\\') && !/^[a-zA-Z]:/.test(override)))
  ) {
    return override;
  }

  /** @type {string | null} */
  let hostResolved = null;
  if (override) {
    try {
      if (fs.existsSync(override)) hostResolved = override;
    } catch {
      return null;
    }
    if (!hostResolved) return null;
  } else {
    hostResolved = resolveMinnowSandboxHelper(env, opts);
    if (!hostResolved) {
      for (const candidate of listMinnowSandboxHelperCandidates(env, opts)) {
        try {
          if (candidate && fs.existsSync(candidate)) {
            hostResolved = candidate;
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (opts.skipInstall) {
    if (hostResolved) return hostHelperPathToWsl(hostResolved);
    return opts.allowBareName ? HELPER_BASENAME : null;
  }

  // Host ELF always reinstalls — skip the WSL `test -x` probe (slow + unused).
  const installed = hostResolved
    ? null
    : opts.installedPathFixture !== undefined
      ? opts.installedPathFixture || null
      : probeInstalledWslHelper({ ...opts, env });

  const plan = planWslHelperProvision({
    envOverride: null, // Linux overrides already returned above
    hostHelperPath: hostResolved,
    installedExists: Boolean(installed),
    installedPath: installed,
    allowBareName: opts.allowBareName === true,
  });

  if (plan.action === 'use-installed' || plan.action === 'use-bare') {
    return plan.wslPath ?? null;
  }

  if (plan.action === 'install' && plan.hostPath) {
    const installedResult = installHelperIntoWsl(plan.hostPath, { ...opts, env });
    if (installedResult.ok) return installedResult.helperPath;
    // Fail closed: do NOT fall back to /mnt/… (often noexec; would claim applied without running).
    return null;
  }

  return opts.allowBareName ? HELPER_BASENAME : null;
}

/**
 * Ensure a usable WSL-side helper path (install when needed). Soft-fails with reason.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @returns {{ ok: true, helperPath: string } | { ok: false, reason: string, detail: string }}
 */
export function ensureWslLandlockHelper(env = process.env, opts = {}) {
  const pathOrNull = resolveWslLandlockHelper(env, { ...opts, allowBareName: false });
  if (!pathOrNull) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
    };
  }
  // Never claim success with bare wsl.exe as the "helper".
  if (pathOrNull === 'wsl.exe' || pathOrNull === 'wsl') {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
    };
  }
  return { ok: true, helperPath: pathOrNull };
}

/**
 * Probe: is WSL installed with at least one distro?
 * @param {{ listWslDistrosFn?: typeof listWslDistros, wslFixtures?: object }} [opts]
 * @returns {{ ok: boolean, reason?: string, detail?: string, distros?: string[], defaultDistro?: string | null }}
 */
export function probeWslPresent(opts = {}) {
  const listFn = opts.listWslDistrosFn ?? listWslDistros;
  // On non-Windows, only succeed when fixtures are injected (unit tests).
  const fixtures = opts.wslFixtures ?? {};
  const hasFixtures = fixtures.listOutput != null || fixtures.defaultOutput != null;
  if (process.platform !== 'win32' && !hasFixtures && !opts.forceWin32) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE),
    };
  }

  try {
    const catalog = listFn(fixtures);
    if (!catalog.distros || catalog.distros.length === 0) {
      return {
        ok: false,
        reason: SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE,
        detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE),
      };
    }
    return {
      ok: true,
      distros: catalog.distros,
      defaultDistro: catalog.defaultDistro ?? catalog.distros[0] ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run `minnow-sandbox --probe` inside WSL and map exit codes to unavailable reasons.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 * @param {typeof listWslDistros} [opts.listWslDistrosFn]
 * @param {object} [opts.wslFixtures]
 * @param {string | null} [opts.distro]
 * @param {string | null} [opts.helperPath] WSL-side helper path override
 * @param {boolean} [opts.allowBareName]
 * @param {boolean} [opts.useCache]
 * @returns {{ ok: boolean, reason?: string, detail?: string, helperPath?: string, abi?: number }}
 */
export function probeWslLandlock(env = process.env, opts = {}) {
  if (opts.useCache !== false && wslLandlockProbeCache) {
    return wslLandlockProbeCache.result;
  }

  const wsl = probeWslPresent(opts);
  if (!wsl.ok) {
    const result = {
      ok: false,
      reason: wsl.reason ?? SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE,
      detail: wsl.detail ?? describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE),
    };
    if (opts.useCache !== false) wslLandlockProbeCache = { result };
    return result;
  }

  const helperPath =
    opts.helperPath ??
    resolveWslLandlockHelper(env, { ...opts, allowBareName: opts.allowBareName !== false });

  if (!helperPath) {
    const result = {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
    };
    if (opts.useCache !== false) wslLandlockProbeCache = { result };
    return result;
  }

  const distro = opts.distro ?? wsl.defaultDistro ?? null;
  /** @type {string[]} */
  const wslArgs = [];
  if (distro) wslArgs.push('-d', distro);
  wslArgs.push('--', helperPath, '--probe');

  const spawnFn = opts.spawnSyncFn ?? spawnSync;
  const result = spawnFn('wsl.exe', wslArgs, {
    encoding: 'utf8',
    timeout: 15_000,
    env,
    windowsHide: true,
  });

  if (result.error) {
    const msg = result.error.message || String(result.error);
    // ENOENT on wsl.exe → WSL missing; otherwise treat as helper/runtime failure.
    const isWslMissing =
      result.error.code === 'ENOENT' || /wsl\.exe/i.test(msg);
    const mapped = {
      ok: false,
      reason: isWslMissing
        ? SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE
        : SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE,
      detail: msg,
      helperPath,
    };
    if (opts.useCache !== false) wslLandlockProbeCache = { result: mapped };
    return mapped;
  }

  const status = result.status;
  const stderr = String(result.stderr || '').trim();
  const stdout = String(result.stdout || '');

  // Distro / exec failures often surface as non-zero without our helper codes.
  if (status === LANDLOCK_EXIT_ABI_UNAVAILABLE) {
    const mapped = {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_ABI_UNAVAILABLE,
      detail: stderr || describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_ABI_UNAVAILABLE),
      helperPath,
    };
    if (opts.useCache !== false) wslLandlockProbeCache = { result: mapped };
    return mapped;
  }

  if (status === 127 || /not found|No such file/i.test(stderr)) {
    const mapped = {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: stderr || describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
      helperPath,
    };
    if (opts.useCache !== false) wslLandlockProbeCache = { result: mapped };
    return mapped;
  }

  if (status !== 0) {
    const mapped = {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE,
      detail: stderr || `wsl minnow-sandbox --probe exit ${status}`,
      helperPath,
    };
    if (opts.useCache !== false) wslLandlockProbeCache = { result: mapped };
    return mapped;
  }

  let abi;
  const match = stdout.match(/landlock_abi=(\d+)/);
  if (match) abi = Number(match[1]);

  const okResult = { ok: true, helperPath, abi };
  if (opts.useCache !== false) wslLandlockProbeCache = { result: okResult };
  return okResult;
}

/**
 * Policy path mapper for Landlock argv running inside WSL (Windows → /mnt/…).
 * POSIX system roots pass through via windowsPathToWslPath.
 * @param {string} p
 * @returns {string}
 */
export function mapPolicyPathToWsl(p) {
  return windowsPathToWslPath(p);
}

/**
 * Compose wsl.exe + Landlock helper around an already-resolved one-shot spawn.
 * Does not spawn. Returns `{ ok:false, reason }` without rewriting when unavailable
 * so callers never treat bare WSL as sandboxed.
 *
 * @param {{ command: string, args?: string[], shell?: boolean, cwd?: string, env?: NodeJS.ProcessEnv }} spawnTarget
 * @param {import('./policy.js').SandboxPolicy} policy
 * @param {object} [opts]
 * @returns {{ ok: true, spawn: object, helperPath: string } | { ok: false, reason: string, detail: string }}
 */
export function composeWslLandlockWrap(spawnTarget, policy, opts = {}) {
  const wsl = probeWslPresent(opts);
  if (!wsl.ok) {
    return {
      ok: false,
      reason: wsl.reason ?? SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE,
      detail: wsl.detail ?? describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE),
    };
  }

  // Prefer a host-visible ELF (auto-install into ~/.local/share/minnow when possible).
  let helperPath = resolveWslLandlockHelper(opts.env ?? process.env, {
    ...opts,
    allowBareName: false,
  });

  if (!helperPath) {
    const probed =
      wslLandlockProbeCache?.result?.ok && wslLandlockProbeCache.result.helperPath
        ? wslLandlockProbeCache.result
        : opts.skipLiveProbe
          ? { ok: false }
          : probeWslLandlock(opts.env ?? process.env, { ...opts, useCache: true });
    if (probed.ok && probed.helperPath) {
      helperPath = probed.helperPath;
    }
  }

  if (!helperPath) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
    };
  }

  // Refuse to claim success if helper path is somehow empty / is wsl.exe itself.
  if (helperPath === 'wsl.exe' || helperPath === 'wsl') {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
    };
  }

  // Live --probe before applied:true (catch noexec / broken install / planted non-helper).
  // Unit tests that only check argv shape may set skipLiveProbe: true.
  if (opts.skipLiveProbe !== true) {
    const live = probeWslLandlock(opts.env ?? process.env, {
      ...opts,
      helperPath,
      useCache: false,
      allowBareName: false,
    });
    if (!live.ok) {
      return {
        ok: false,
        reason: live.reason ?? SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE,
        detail:
          live.detail ??
          describeSandboxUnavailable(live.reason ?? SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE),
      };
    }
  }

  const distro = opts.distro ?? wsl.defaultDistro ?? null;
  const wslSpawn = ensureWslOneShotSpawn(spawnTarget, {
    distro,
    cwd: opts.cwd ?? spawnTarget.cwd ?? null,
  });

  const split = splitWslArgv(wslSpawn.args);
  if (!split || split.innerArgv.length === 0) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE,
      detail: 'WSL spawn is missing a -- separator; cannot compose Landlock wrap',
    };
  }

  const inner = {
    command: split.innerArgv[0],
    args: split.innerArgv.slice(1),
  };

  // Linux-side temps: Windows policy omits /tmp; the command runs in WSL.
  const policyForWsl = {
    ...policy,
    writeRoots: [...policy.writeRoots, '/tmp', '/var/tmp'],
    platform: 'linux',
  };

  // Reuse Phase 5 wrap — map Windows policy paths to /mnt/… for the helper.
  const linuxWrapped = wrapWithLandlock(inner, policyForWsl, {
    helperPath,
    seccomp: opts.seccomp !== false,
    mapPath: mapPolicyPathToWsl,
  });

  const wrappedArgs = [...split.prefix, '--', linuxWrapped.command, ...linuxWrapped.args];

  return {
    ok: true,
    helperPath,
    spawn: {
      command: wslSpawn.command,
      args: wrappedArgs,
      shell: false,
      ...(wslSpawn.cwd != null ? { cwd: wslSpawn.cwd } : {}),
      ...(spawnTarget.env != null ? { env: spawnTarget.env } : {}),
    },
  };
}

/**
 * Wrap like wrapWithLandlock, but as a wsl.exe parent with Landlock inside.
 * Throws only on programmer misuse; prefer composeWslLandlockWrap for soft unavailable.
 *
 * @param {object} spawnTarget
 * @param {import('./policy.js').SandboxPolicy} policy
 * @param {object} [opts]
 */
export function wrapWithWslLandlock(spawnTarget, policy, opts = {}) {
  const composed = composeWslLandlockWrap(spawnTarget, policy, opts);
  if (!composed.ok) {
    throw new Error(composed.detail || describeSandboxUnavailable(composed.reason));
  }
  return composed.spawn;
}

/**
 * True when argv is wsl.exe → minnow-sandbox → real command (not bare WSL).
 * @param {{ command?: string, args?: string[] }} spawnTarget
 * @returns {boolean}
 */
export function isWslLandlockWrapped(spawnTarget) {
  if (!isWslExeSpawn(spawnTarget)) return false;
  const inner = extractWslInnerSpawn(spawnTarget);
  if (!inner) return false;
  const base = path.basename(inner.command);
  return base === HELPER_BASENAME || inner.command.includes(HELPER_BASENAME);
}

/**
 * @returns {import('./index.js').SandboxAdapter}
 */
export function createWslLandlockAdapter() {
  return {
    kind: 'wsl-landlock',
    probe: async () => {
      const result = probeWslLandlock();
      return {
        ok: result.ok,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.detail ? { detail: result.detail } : {}),
      };
    },
    wrap: (spawnTarget, policy) => wrapWithWslLandlock(spawnTarget, policy),
  };
}

// Re-export Phase 5 entry points used by composition tests / docs.
export { wrapWithLandlock };
export { buildLandlockArgv } from './landlock.js';
