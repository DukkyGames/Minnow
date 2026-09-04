import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREDENTIAL_DENY_ENTRIES } from './policy.js';
import { SANDBOX_UNAVAILABLE_REASON, describeSandboxUnavailable } from './unavailable.js';

export const LANDLOCK_EXIT_ABI_UNAVAILABLE = 75;
export const LANDLOCK_EXIT_APPLY_FAILED = 76;

/**
 * Must stay in sync with `MAX_PATHS` in native/minnow-sandbox/minnow-sandbox.c.
 * The helper exits 64 (usage) when `--read` or `--write` exceeds this.
 */
export const LANDLOCK_HELPER_MAX_PATHS = 1024;

/**
 * Sibling grants when a write root contains a deny (tests put MINNOW_HOME under
 * os.tmpdir()). Unbounded readdir of /tmp or %TEMP% blows the helper's argv cap.
 */
export const LANDLOCK_MAX_SCOPED_WRITE_GRANTS = 64;

const HELPER_NAME = 'minnow-sandbox';

function sandboxModuleDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
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

  if (resourcesPath) {
    out.push(path.join(resourcesPath, HELPER_NAME));
    out.push(path.join(resourcesPath, 'bin', HELPER_NAME));
  }

  const repoNative = path.resolve(moduleDir, '../../../native/minnow-sandbox', HELPER_NAME);
  out.push(repoNative);

  out.push(path.resolve(moduleDir, '../../../../resources', HELPER_NAME));

  return out;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ resourcesPath?: string, moduleDir?: string }} [opts]
 * @returns {string | null}
 */
export function resolveMinnowSandboxHelper(env = process.env, opts = {}) {
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
    }
  }

  const pathEnv = env.PATH || env.Path || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, HELPER_NAME);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
    }
  }
  return null;
}

/**
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
 * @returns {readonly string[]}
 */
export function landlockDeviceWriteAllowlist() {
  return ['/dev/null', '/dev/zero', '/dev/tty'];
}

/**
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
  /** @type {string[]} */
  const out = [];
  for (const n of names) {
    const abs = path.join(home, n);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        out.push(abs);
      }
    } catch {
    }
  }
  return out;
}

/**
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
 * @param {string} p
 */
function toPosixTmpAligned(p) {
  if (typeof p !== 'string' || !p) return p;
  if (p.startsWith('/') && !/^[a-zA-Z]:/.test(p)) return p.replace(/\\/g, '/');
  const norm = path.normalize(p);
  const winTmp = /^([a-zA-Z]):[\\/]tmp(?:[\\/](.*))?$/i.exec(norm);
  if (winTmp) {
    const rest = winTmp[2] ? winTmp[2].replace(/\\/g, '/') : '';
    return rest ? `/tmp/${rest}` : '/tmp';
  }
  return norm.replace(/\\/g, '/');
}

/**
 * @param {string} absPath
 * @param {string} root
 */
function isUnderWriteRoot(absPath, root) {
  const posixRoot = root.startsWith('/') && !/^[a-zA-Z]:[/\\]/.test(root);
  if (!posixRoot) return isUnder(absPath, root);
  const a = toPosixTmpAligned(absPath);
  const r = toPosixTmpAligned(root);
  if (a === r) return true;
  const prefix = r.endsWith('/') ? r : `${r}/`;
  return a.startsWith(prefix);
}

/**
 * @param {string} writeRoot
 */
function resolveLandlockWriteRoot(writeRoot) {
  if (typeof writeRoot !== 'string' || !writeRoot.trim()) return writeRoot;
  const trimmed = writeRoot.trim();
  if (trimmed.startsWith('/') && !/^[a-zA-Z]:[/\\]/.test(trimmed)) {
    return trimmed.replace(/\\/g, '/');
  }
  return path.resolve(trimmed);
}

/**
 * @param {string} root
 * @param {string} name
 */
function joinWriteRootEntry(root, name) {
  if (root.startsWith('/') && !/^[a-zA-Z]:[/\\]/.test(root)) {
    return path.posix.join(root, name);
  }
  return path.join(root, name);
}

/**
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
    if (policy.denyReadRoots.some((d) => isUnder(abs, d) || isUnder(d, abs))) {
      continue;
    }
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
 * @param {string} writeRoot
 * @param {import('./policy.js').SandboxPolicy} policy
 * @returns {string[]}
 */
export function buildScopedWriteRootGrants(writeRoot, policy) {
  const root = resolveLandlockWriteRoot(writeRoot);
  const hasBlockedDescendant = policy.denyReadRoots.some(
    (deny) => deny && (deny === root || isUnderWriteRoot(deny, root)),
  );
  if (!hasBlockedDescendant) {
    return [root];
  }

  /** @type {string[]} */
  const grants = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const ent of entries) {
    const abs = joinWriteRootEntry(root, ent.name);
    const touchesDeny = policy.denyReadRoots.some(
      (deny) =>
        deny &&
        (isUnderWriteRoot(deny, abs) ||
          isUnderWriteRoot(abs, deny) ||
          toPosixTmpAligned(abs) === toPosixTmpAligned(deny)),
    );
    if (touchesDeny) continue;
    grants.push(abs);
    if (grants.length >= LANDLOCK_MAX_SCOPED_WRITE_GRANTS) break;
  }
  return grants;
}

/** @deprecated */
export const buildWriteRootReadGrants = buildScopedWriteRootGrants;

/**
 * @param {import('./policy.js').SandboxPolicy} policy
 * @returns {{ writePaths: string[], readPaths: string[] }}
 */
/**
 * @param {import('./policy.js').SandboxPolicy} policy
 * @param {{ compactHomeRead?: boolean }} [opts]
 */
export function buildLandlockPathLists(policy, { compactHomeRead = false } = {}) {
  const writePaths = [
    ...landlockDeviceWriteAllowlist(),
    ...policy.writeRoots.flatMap((wr) => buildScopedWriteRootGrants(wr, policy)),
  ];
  const homeReadPaths = compactHomeRead
    ? homeShellReadPaths(policy.home)
    : buildHomeReadAllowlist(policy);
  const readSet = new Set([
    ...defaultSystemReadRoots(),
    ...policy.allowReadExceptions,
    ...homeReadPaths,
  ]);
  for (const wr of policy.writeRoots) {
    for (const grant of buildScopedWriteRootGrants(wr, policy)) {
      readSet.add(grant);
    }
  }
  if (policy.workspaceRoot) readSet.add(policy.workspaceRoot);
  return {
    writePaths: writePaths.filter((p) => typeof p === 'string' && p.length > 0),
    readPaths: [...readSet].filter((p) => typeof p === 'string' && p.length > 0),
  };
}

/**
 * @param {{ command: string, args?: string[] }} spawnTarget
 * @param {import('./policy.js').SandboxPolicy} policy
 * @param {{ seccomp?: boolean, mapPath?: (p: string) => string }} [opts]
 * @returns {string[]}
 */
export function buildLandlockArgv(
  spawnTarget,
  policy,
  { seccomp = true, mapPath, compactHomeRead = false } = {},
) {
  const map = typeof mapPath === 'function' ? mapPath : (p) => p;
  let compact = compactHomeRead === true;
  let { writePaths, readPaths } = buildLandlockPathLists(policy, { compactHomeRead: compact });
  // GitHub runners (and some developer homes) have hundreds of top-level
  // entries; the C helper exits 64 if --read/--write exceeds MAX_PATHS.
  if (
    !compact &&
    (writePaths.length > LANDLOCK_HELPER_MAX_PATHS || readPaths.length > LANDLOCK_HELPER_MAX_PATHS)
  ) {
    compact = true;
    ({ writePaths, readPaths } = buildLandlockPathLists(policy, { compactHomeRead: true }));
  }
  ({ writePaths, readPaths } = capLandlockPathLists(writePaths, readPaths, policy));
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
 * Keep argv inside the C helper's --read/--write cap. Prefer devices and the
 * workspace so a huge temp directory cannot push the helper into usage exit 64.
 *
 * @param {string[]} writePaths
 * @param {string[]} readPaths
 * @param {import('./policy.js').SandboxPolicy} policy
 * @returns {{ writePaths: string[], readPaths: string[] }}
 */
function capLandlockPathLists(writePaths, readPaths, policy) {
  const prefer = [
    ...landlockDeviceWriteAllowlist(),
    policy.workspaceRoot,
    policy.worktreeRoot,
  ].filter((p) => typeof p === 'string' && p.length > 0);

  return {
    writePaths: takePreferredPaths(writePaths, prefer, LANDLOCK_HELPER_MAX_PATHS),
    readPaths: takePreferredPaths(readPaths, prefer, LANDLOCK_HELPER_MAX_PATHS),
  };
}

/**
 * @param {string[]} paths
 * @param {string[]} prefer
 * @param {number} max
 * @returns {string[]}
 */
function takePreferredPaths(paths, prefer, max) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const p of [...prefer, ...paths]) {
    if (out.length >= max) break;
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
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
      compactHomeRead: opts.compactHomeRead === true,
    }),
    shell: false,
    ...(spawnTarget.cwd != null ? { cwd: spawnTarget.cwd } : {}),
    ...(spawnTarget.env != null ? { env: spawnTarget.env } : {}),
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: boolean, reason?: string, detail?: string, abi?: number, helperPath?: string }}
 */
export function probeLandlock(env = process.env) {
  if (process.platform !== 'linux' && env.MINNOW_SANDBOX_FORCE_PROBE !== '1') {
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
      return {
        ok: result.ok,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.detail ? { detail: result.detail } : {}),
      };
    },
    wrap: (spawnTarget, policy) => wrapWithLandlock(spawnTarget, policy),
  };
}
