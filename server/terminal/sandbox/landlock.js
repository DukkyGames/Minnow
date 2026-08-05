/**
 * Linux Landlock adapter — invokes the `minnow-sandbox` helper (MIN-553 Phase 5).
 *
 * Same argv-wrapper shape as Seatbelt: helper becomes the spawn parent, then
 * execve's the already-resolved one-shot command. Phase 6 (WSL) should call
 * wrapWithLandlock / buildLandlockArgv inside the WSL tree — not a second policy.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREDENTIAL_DENY_ENTRIES } from './policy.js';
import { SANDBOX_UNAVAILABLE_REASON, describeSandboxUnavailable } from './unavailable.js';

/** Helper exit when Landlock syscalls / ABI are missing (see native/minnow-sandbox). */
export const LANDLOCK_EXIT_ABI_UNAVAILABLE = 75;
/** Helper exit when ruleset apply fails after ABI negotiate. */
export const LANDLOCK_EXIT_APPLY_FAILED = 76;

const HELPER_NAME = 'minnow-sandbox';

/**
 * Absolute path to this module's directory (works under Electron asar when the
 * helper itself lives outside asar via extraResources).
 */
function sandboxModuleDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Repo / install candidates for the helper binary.
 * Order: env override → Electron resources → build output → PATH.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ resourcesPath?: string, moduleDir?: string }} [opts]
 * @returns {string[]}
 */
export function listMinnowSandboxHelperCandidates(
  env = process.env,
  { resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '', moduleDir = sandboxModuleDir() } = {},
) {
  /** @type {string[]} */
  const out = [];
  // Override is handled exclusively in resolveMinnowSandboxHelper (authoritative).

  if (resourcesPath) {
    // electron-builder linux.extraResources → resources/minnow-sandbox
    out.push(path.join(resourcesPath, HELPER_NAME));
    out.push(path.join(resourcesPath, 'bin', HELPER_NAME));
  }

  // Dev tree: native/minnow-sandbox/minnow-sandbox (server/terminal/sandbox → repo = ../../..)
  const repoNative = path.resolve(moduleDir, '../../../native/minnow-sandbox', HELPER_NAME);
  out.push(repoNative);

  // Next to a sibling "resources" folder (some unpacked layouts)
  out.push(path.resolve(moduleDir, '../../../../resources', HELPER_NAME));

  return out;
}

/**
 * Resolve an executable helper path, or null if none exist.
 * Also accepts a bare name on PATH (last resort — Phase 6 WSL distros).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ resourcesPath?: string, moduleDir?: string }} [opts]
 * @returns {string | null}
 */
export function resolveMinnowSandboxHelper(env = process.env, opts = {}) {
  // Explicit override wins even when missing — callers/tests need a way to force
  // "no helper" without PATH / resources accidentally satisfying the probe.
  const override = env.MINNOW_SANDBOX_HELPER?.trim();
  if (override) {
    try {
      return fs.existsSync(override) ? override : null;
    } catch {
      return null;
    }
  }

  for (const candidate of listMinnowSandboxHelperCandidates(env, opts)) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      /* ignore */
    }
  }

  // PATH lookup without spawning `which` — scan PATH entries.
  const pathEnv = env.PATH || env.Path || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, HELPER_NAME);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * System prefixes agents need to run shells / dynamic linkers / package tools.
 * Landlock is allowlist-only — these are RO (read+exec) grants.
 * @returns {string[]}
 */
export function defaultSystemReadRoots() {
  return [
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/lib32',
    '/etc',
    '/dev',
    '/proc',
    '/sys',
    '/run',
    '/var',
    '/opt',
  ];
}

/**
 * Shell / toolchain files under $HOME that must stay readable without granting
 * the entire home (which would also allow ~/.minnow / ~/.ssh via Landlock
 * parent→child inheritance).
 * @param {string} home
 * @returns {string[]}
 */
export function homeShellReadPaths(home) {
  const names = [
    '.bashrc',
    '.bash_profile',
    '.bash_login',
    '.profile',
    '.zshrc',
    '.zprofile',
    '.zshenv',
    '.zlogin',
    '.inputrc',
    '.dircolors',
  ];
  return names.map((n) => path.join(home, n));
}

/**
 * Whether `absPath` equals or is nested under `root`.
 * @param {string} absPath
 * @param {string} root
 */
function isUnder(absPath, root) {
  if (!absPath || !root) return false;
  if (absPath === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return absPath.startsWith(prefix);
}

/**
 * Enumerate $HOME children for RO allow, skipping credential / minnow deny roots.
 * Landlock cannot "carve out" a deny under an allowed parent — so we never grant
 * the home directory itself, only selected children + shell rc files.
 *
 * @param {import('./policy.js').SandboxPolicy} policy
 * @returns {string[]}
 */
export function buildHomeReadAllowlist(policy) {
  const home = policy.home;
  /** @type {string[]} */
  const allow = [...homeShellReadPaths(home)];

  let entries = [];
  try {
    entries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    return allow;
  }

  for (const ent of entries) {
    const abs = path.join(home, ent.name);
    // Skip anything under a deny-read root (including ~/.minnow wholesale).
    if (policy.denyReadRoots.some((d) => isUnder(abs, d) || isUnder(d, abs))) {
      continue;
    }
    // Skip known credential relative entries even if resolve failed to expand.
    const hitCredential = CREDENTIAL_DENY_ENTRIES.some((e) => {
      const relRoot = e.rel.split(path.sep)[0];
      return ent.name === relRoot || ent.name === e.rel;
    });
    if (hitCredential) continue;
    if (ent.name === '.minnow') continue;
    allow.push(abs);
  }

  return allow;
}

/**
 * Build --write / --read path lists for the helper from a workspace policy.
 *
 * @param {import('./policy.js').SandboxPolicy} policy
 * @returns {{ writePaths: string[], readPaths: string[] }}
 */
export function buildLandlockPathLists(policy) {
  const writePaths = [...policy.writeRoots];
  const readSet = new Set([
    ...defaultSystemReadRoots(),
    ...policy.writeRoots,
    ...policy.allowReadExceptions,
    ...buildHomeReadAllowlist(policy),
  ]);
  // Always allow the workspace root for read even if somehow omitted from writes.
  if (policy.workspaceRoot) readSet.add(policy.workspaceRoot);
  return {
    writePaths,
    readPaths: [...readSet],
  };
}

/**
 * Argv for minnow-sandbox (helper path excluded) — Phase 6 can reuse this inside WSL.
 *
 * @param {{ command: string, args?: string[] }} spawnTarget
 * @param {import('./policy.js').SandboxPolicy} policy
 * @param {{ seccomp?: boolean, mapPath?: (p: string) => string }} [opts]
 * @returns {string[]}
 */
export function buildLandlockArgv(spawnTarget, policy, { seccomp = true, mapPath } = {}) {
  const map = typeof mapPath === 'function' ? mapPath : (p) => p;
  const { writePaths, readPaths } = buildLandlockPathLists(policy);
  /** @type {string[]} */
  const args = [];
  if (!seccomp) args.push('--no-seccomp');
  for (const p of writePaths) {
    const mapped = map(p);
    if (mapped) {
      args.push('--write', mapped);
    }
  }
  for (const p of readPaths) {
    const mapped = map(p);
    if (mapped) {
      args.push('--read', mapped);
    }
  }
  const innerArgs = Array.isArray(spawnTarget.args) ? spawnTarget.args : [];
  args.push('--', spawnTarget.command, ...innerArgs);
  return args;
}

/**
 * Wrap a resolved spawn target with minnow-sandbox.
 *
 * @param {{ command: string, args?: string[], shell?: boolean, cwd?: string, env?: NodeJS.ProcessEnv }} spawnTarget
 * @param {import('./policy.js').SandboxPolicy} policy
 * @param {{ helperPath?: string, seccomp?: boolean, mapPath?: (p: string) => string }} [opts]
 * @returns {{ command: string, args: string[], shell: boolean, cwd?: string, env?: NodeJS.ProcessEnv }}
 */
export function wrapWithLandlock(spawnTarget, policy, opts = {}) {
  const helperPath = opts.helperPath ?? resolveMinnowSandboxHelper();
  if (!helperPath) {
    throw new Error(describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING));
  }
  return {
    command: helperPath,
    args: buildLandlockArgv(spawnTarget, policy, {
      seccomp: opts.seccomp !== false,
      mapPath: opts.mapPath,
    }),
    shell: false,
    ...(spawnTarget.cwd != null ? { cwd: spawnTarget.cwd } : {}),
    ...(spawnTarget.env != null ? { env: spawnTarget.env } : {}),
  };
}

/**
 * Probe helper presence + Landlock ABI via `--probe`.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: boolean, reason?: string, detail?: string, abi?: number, helperPath?: string }}
 */
export function probeLandlock(env = process.env) {
  if (process.platform !== 'linux' && env.MINNOW_SANDBOX_FORCE_PROBE !== '1') {
    // Unit tests on Windows/macOS can force the probe path with a stub helper.
    // Production resolveSandbox('linux') still uses this function from the adapter.
  }

  const helperPath = resolveMinnowSandboxHelper(env);
  if (!helperPath) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING,
      detail: describeSandboxUnavailable(SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING),
    };
  }

  const result = spawnSync(helperPath, ['--probe'], {
    encoding: 'utf8',
    timeout: 5_000,
    env,
  });

  if (result.error) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE,
      detail: result.error.message,
      helperPath,
    };
  }

  if (result.status === LANDLOCK_EXIT_ABI_UNAVAILABLE) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_ABI_UNAVAILABLE,
      detail: (result.stderr || '').trim() || describeSandboxUnavailable(
        SANDBOX_UNAVAILABLE_REASON.LANDLOCK_ABI_UNAVAILABLE,
      ),
      helperPath,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE,
      detail:
        (result.stderr || '').trim() ||
        `minnow-sandbox --probe exit ${result.status}`,
      helperPath,
    };
  }

  let abi;
  const match = String(result.stdout || '').match(/landlock_abi=(\d+)/);
  if (match) abi = Number(match[1]);

  return { ok: true, helperPath, abi };
}

/**
 * @returns {import('./index.js').SandboxAdapter}
 */
export function createLandlockAdapter() {
  return {
    kind: 'landlock',
    probe: async () => {
      const result = probeLandlock();
      // Drop non-meta fields for the shared probe shape.
      return {
        ok: result.ok,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.detail ? { detail: result.detail } : {}),
      };
    },
    wrap: (spawnTarget, policy) => wrapWithLandlock(spawnTarget, policy),
  };
}
