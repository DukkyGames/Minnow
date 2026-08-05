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

/** @type {{ result: { ok: boolean, reason?: string, detail?: string, helperPath?: string, abi?: number } } | null} */
let wslLandlockProbeCache = null;

/**
 * Reset Phase-6 probe cache (tests only).
 */
export function resetWslLandlockProbeCache() {
  wslLandlockProbeCache = null;
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
 * Resolve a Landlock helper path usable *inside* WSL.
 * Prefers a host-visible Linux ELF (translated to /mnt/…); optional bare PATH name
 * when `allowBareName` is true (probe verifies it via wsl.exe).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ resourcesPath?: string, moduleDir?: string, allowBareName?: boolean, hostHelperPath?: string | null }} [opts]
 * @returns {string | null} WSL-side path or basename, or null
 */
export function resolveWslLandlockHelper(env = process.env, opts = {}) {
  // Explicit inject for tests
  if (opts.hostHelperPath != null) {
    if (!opts.hostHelperPath) return opts.allowBareName ? HELPER_BASENAME : null;
    return hostHelperPathToWsl(opts.hostHelperPath);
  }

  const override = env.MINNOW_SANDBOX_HELPER?.trim();
  if (override) {
    // Already a Linux path or bare name — use as-is for WSL exec.
    if (override.startsWith('/') || (!override.includes('\\') && !/^[a-zA-Z]:/.test(override))) {
      // Windows-hosted override that is a POSIX string: still require host file if absolute under /mnt
      if (override.startsWith('/mnt/')) {
        // Best-effort: confirm the Windows side of the mount exists when mappable
        return override;
      }
      if (override.startsWith('/')) {
        return override;
      }
      // Bare name on WSL PATH
      return override;
    }
    try {
      if (fs.existsSync(override)) return hostHelperPathToWsl(override);
    } catch {
      /* ignore */
    }
    return null;
  }

  // Host-visible candidates (Electron resources / repo build) → /mnt/c/…
  const hostResolved = resolveMinnowSandboxHelper(env, opts);
  if (hostResolved) {
    return hostHelperPathToWsl(hostResolved);
  }

  for (const candidate of listMinnowSandboxHelperCandidates(env, opts)) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return hostHelperPathToWsl(candidate);
      }
    } catch {
      /* ignore */
    }
  }

  if (opts.allowBareName) {
    return HELPER_BASENAME;
  }
  return null;
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

  // Prefer a host-visible ELF; fall back to a successful probe's helper (PATH inside WSL).
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

  // Refuse to claim success if helper path is somehow empty after checks.
  if (helperPath === 'wsl.exe' || helperPath === 'wsl') {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
    };
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
