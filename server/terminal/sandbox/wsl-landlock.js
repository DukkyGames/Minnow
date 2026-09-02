import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

export const WSL_HELPER_INSTALL_REL = '.local/share/minnow/minnow-sandbox';

/** @type {{ result: { ok: boolean, reason?: string, detail?: string, helperPath?: string, abi?: number } } | null} */
let wslLandlockProbeCache = null;

/**
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

export function resetWslLandlockProbeCache() {
  wslLandlockProbeCache = null;
  wslInstalledHelperByDistro.clear();
}

/**
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
 * @param {{ command: string, args?: string[], shell?: boolean }} spawnTarget
 * @returns {{ command: string, args: string[] }}
 */
export function recoverCommandFromWinSpawn(spawnTarget) {
  const inner = extractWslInnerSpawn(spawnTarget);
  if (inner) {
    const baseInner = path.basename(String(inner.command || '')).toLowerCase();
    if (baseInner === 'bash' || baseInner === 'sh') {
      const cIdx = inner.args.findIndex((a) => a === '-c' || a === '-C');
      if (cIdx >= 0 && typeof inner.args[cIdx + 1] === 'string') {
        return { command: inner.args[cIdx + 1], args: [] };
      }
    }
    return { command: inner.command, args: [...inner.args] };
  }

  const args = Array.isArray(spawnTarget.args) ? spawnTarget.args : [];
  const base = path.basename(String(spawnTarget.command || '')).toLowerCase();
  if (base === 'cmd.exe' || base === 'cmd') {
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
 * @param {string} helperPath
 * @returns {string}
 */
export function hostHelperPathToWsl(helperPath) {
  if (typeof helperPath !== 'string' || !helperPath.trim()) return helperPath;
  const trimmed = helperPath.trim();
  if (!trimmed.includes('/') && !trimmed.includes('\\') && !/^[a-zA-Z]:/.test(trimmed)) {
    return trimmed;
  }
  return windowsPathToWslPath(trimmed);
}

/**
 * @param {string} wslPath
 * @returns {boolean}
 */
export function isWslMountPath(wslPath) {
  return typeof wslPath === 'string' && /^\/mnt\/[a-zA-Z](\/|$)/.test(wslPath);
}

/**
 * @param {object} input
 * @param {string | null | undefined} [input.envOverride]
 * @param {string | null | undefined} [input.hostHelperPath]
 * @param {boolean} [input.installedExists]
 * @param {string | null | undefined} [input.installedPath]
 * @param {boolean} [input.allowBareName]
 * @returns {{ action: 'use-override' | 'use-installed' | 'install' | 'use-bare' | 'missing', wslPath?: string, hostPath?: string, reason?: string, }}
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
    if (override.startsWith('/') || (!override.includes('\\') && !/^[a-zA-Z]:/.test(override))) {
      return { action: 'use-override', wslPath: override };
    }
    return { action: 'install', hostPath: override };
  }

  if (hostHelperPath) {
    return { action: 'install', hostPath: hostHelperPath };
  }

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
 * @param {object} [opts]
 * @param {string | null} [opts.distro]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.homeFixture]
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
 * @param {string} home
 * @returns {string}
 */
export function wslInstalledHelperPath(home) {
  const base = String(home || '').replace(/\/+$/, '');
  return `${base}/${WSL_HELPER_INSTALL_REL}`;
}

/**
 * @param {string} hostHelperPath
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
 * @param {object} [opts]
 * @returns {string | null}
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
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ resourcesPath?: string, moduleDir?: string, allowBareName?: boolean, hostHelperPath?: string | null, skipInstall?: boolean, distro?: string | null, installedPathFixture?: string | null, homeFixture?: string, spawnSyncFn?: typeof spawnSync, copyFn?: Function, }} [opts]
 * @returns {string | null}
 */
export function resolveWslLandlockHelper(env = process.env, opts = {}) {
  if (opts.hostHelperPath != null) {
    if (!opts.hostHelperPath) return opts.allowBareName ? HELPER_BASENAME : null;
    return hostHelperPathToWsl(opts.hostHelperPath);
  }

  const override = env.MINNOW_SANDBOX_HELPER?.trim() || '';

  if (
    override &&
    !opts.forceWin32 &&
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
        }
      }
    }
  }

  if (opts.skipInstall) {
    if (hostResolved) return hostHelperPathToWsl(hostResolved);
    return opts.allowBareName ? HELPER_BASENAME : null;
  }

  const installed = hostResolved
    ? null
    : opts.installedPathFixture !== undefined
      ? opts.installedPathFixture || null
      : probeInstalledWslHelper({ ...opts, env });

  const plan = planWslHelperProvision({
    envOverride: null, 
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
    return null;
  }

  return opts.allowBareName ? HELPER_BASENAME : null;
}

/**
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
 * @param {{ listWslDistrosFn?: typeof listWslDistros, wslFixtures?: object }} [opts]
 * @returns {{ ok: boolean, reason?: string, detail?: string, distros?: string[], defaultDistro?: string | null }}
 */
export function probeWslPresent(opts = {}) {
  const listFn = opts.listWslDistrosFn ?? listWslDistros;
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
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 * @param {typeof listWslDistros} [opts.listWslDistrosFn]
 * @param {object} [opts.wslFixtures]
 * @param {string | null} [opts.distro]
 * @param {string | null} [opts.helperPath]
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
 * @param {string} p
 * @returns {string}
 */
export function mapPolicyPathToWsl(p) {
  return windowsPathToWslPath(p);
}

/**
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

  if (helperPath === 'wsl.exe' || helperPath === 'wsl') {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
    };
  }

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

  const winTemp =
    process.platform === 'win32' ? path.resolve(os.tmpdir()) : null;
  const writeRootsForWsl = winTemp
    ? policy.writeRoots.filter((wr) => {
        const abs = path.resolve(wr);
        return abs !== winTemp && !abs.startsWith(`${winTemp}${path.sep}`);
      })
    : policy.writeRoots;
  const policyForWsl = {
    ...policy,
    writeRoots: [...writeRootsForWsl, '/tmp', '/var/tmp'],
    platform: 'linux',
  };

  const linuxWrapped = wrapWithLandlock(inner, policyForWsl, {
    helperPath,
    seccomp: opts.seccomp !== false,
    mapPath: mapPolicyPathToWsl,
    compactHomeRead: true,
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

export { wrapWithLandlock };
export { buildLandlockArgv } from './landlock.js';
