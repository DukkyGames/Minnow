/**
 * Named sandbox policy profiles for agent one-shot shells (MIN-553).
 * Phase 1 ships the `workspace` profile: filesystem containment, network allowed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMinnowHome } from '../../config/home.js';
import { getWorktreesRoot, isPathUnderWorktreesRoot } from '../../worktree/paths.js';
import { getWorkspaceRoot } from '../../workspace/root.js';

/** @typedef {'workspace' | 'strict'} SandboxProfileName */

/**
 * @typedef {object} SandboxPolicy
 * @property {SandboxProfileName} profile
 * @property {string} home
 * @property {string} minnowHome
 * @property {string} workspaceRoot
 * @property {string | null} worktreeRoot active board/chat worktree under ~/.minnow/worktrees, if any
 * @property {string[]} writeRoots absolute dirs the child may write under
 * @property {string[]} denyReadRoots absolute dirs/files the child must not read
 * @property {string[]} allowReadExceptions absolute paths re-allowed after a parent deny (worktree + terminal logs)
 * @property {boolean} networkAllow
 * @property {string} platform
 */

/**
 * Resolve a path to a real absolute path when the target exists; otherwise path.resolve.
 * Seatbelt `subpath` matches the kernel path, so symlinks matter on macOS.
 * @param {string} p
 * @returns {string}
 */
export function resolvePolicyPath(p) {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Credential / secret locations under the user home (relative segments).
 * Files use a trailing note via build — see `isFileDeny`.
 * @type {Array<{ rel: string, file?: boolean }>}
 */
export const CREDENTIAL_DENY_ENTRIES = Object.freeze([
  { rel: '.ssh' },
  { rel: '.aws' },
  { rel: path.join('.config', 'gh') },
  { rel: path.join('.config', 'gcloud') },
  { rel: path.join('.docker', 'config.json'), file: true },
  { rel: '.npmrc', file: true },
  { rel: '.pypirc', file: true },
  // Browser profiles — high-value cookies / tokens
  { rel: path.join('Library', 'Application Support', 'Google', 'Chrome') },
  { rel: path.join('Library', 'Application Support', 'Chromium') },
  { rel: path.join('Library', 'Application Support', 'Firefox') },
  { rel: '.mozilla' },
  { rel: path.join('.config', 'google-chrome') },
  { rel: path.join('.config', 'chromium') },
]);

/**
 * Package-manager / toolchain caches that `workspace` profile may write.
 * @param {string} home
 * @param {string} platform
 * @returns {string[]}
 */
export function packageCacheWriteRoots(home, platform = process.platform) {
  const roots = [
    path.join(home, '.npm'),
    path.join(home, '.cache'),
    path.join(home, '.cargo'),
    path.join(home, '.rustup'),
    path.join(home, '.m2'),
    path.join(home, '.gradle'),
  ];
  if (platform === 'darwin') {
    roots.push(path.join(home, 'Library', 'Caches'));
  }
  return roots.map(resolvePolicyPath);
}

/**
 * Temp directories the child may write (os.tmpdir + common Unix aliases).
 * @returns {string[]}
 */
export function tempWriteRoots() {
  const roots = new Set();
  roots.add(resolvePolicyPath(os.tmpdir()));
  if (process.platform !== 'win32') {
    roots.add(resolvePolicyPath('/tmp'));
    roots.add(resolvePolicyPath('/private/tmp'));
  }
  return [...roots];
}

/**
 * True when `absPath` is under `root` (or equal). Does not consult live Minnow home.
 * @param {string} absPath
 * @param {string} root
 * @returns {boolean}
 */
function isUnderRoot(absPath, root) {
  if (!absPath || !root) return false;
  if (absPath === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return absPath.startsWith(prefix);
}

/**
 * When cwd lives under ~/.minnow/worktrees, treat it as the active worktree write root.
 * @param {string} cwd
 * @param {string} [worktreesRoot]
 * @returns {string | null}
 */
export function detectWorktreeRoot(cwd, worktreesRoot = getWorktreesRoot()) {
  if (!cwd || typeof cwd !== 'string') return null;
  const resolved = resolvePolicyPath(cwd);
  const root = resolvePolicyPath(worktreesRoot);
  // Prefer the injected root comparison so unit tests can pass a fake worktrees dir
  // without mutating MINNOW_HOME. Fall back to the live helper for production paths.
  if (!isUnderRoot(resolved, root) && !isPathUnderWorktreesRoot(resolved)) {
    return null;
  }
  return resolved;
}

/**
 * Build the Phase-1 `workspace` policy (filesystem containment, network allowed).
 *
 * @param {object} [params]
 * @param {SandboxProfileName} [params.profile]
 * @param {string} [params.workspaceRoot]
 * @param {string} [params.cwd] run cwd — used to detect an active worktree slot
 * @param {string} [params.worktreeRoot] explicit worktree root (overrides cwd detection)
 * @param {string} [params.home]
 * @param {string} [params.minnowHome]
 * @param {string} [params.platform]
 * @param {boolean} [params.networkAllow] ignored for `strict` (always false); default true for workspace
 * @returns {SandboxPolicy}
 */
export function buildPolicy({
  profile = 'workspace',
  workspaceRoot = getWorkspaceRoot(),
  cwd = null,
  worktreeRoot = null,
  home = os.homedir(),
  minnowHome = getMinnowHome(),
  platform = process.platform,
  networkAllow,
} = {}) {
  const homeAbs = resolvePolicyPath(home);
  const minnowAbs = resolvePolicyPath(minnowHome);
  const workspaceAbs = resolvePolicyPath(workspaceRoot);

  let worktreeAbs = worktreeRoot != null ? resolvePolicyPath(worktreeRoot) : null;
  if (!worktreeAbs && cwd) {
    worktreeAbs = detectWorktreeRoot(cwd, path.join(minnowAbs, 'worktrees'));
  }

  /** Primary checkout the agent may mutate. */
  const primaryWrite = worktreeAbs ?? workspaceAbs;

  const writeRoots = new Set();
  writeRoots.add(primaryWrite);
  // When running inside a worktree, still allow the main workspace (read-mostly tools
  // sometimes write build artifacts next to the repo the board was opened from).
  writeRoots.add(workspaceAbs);

  for (const t of tempWriteRoots()) writeRoots.add(t);

  const allowNetwork = profile === 'strict' ? false : networkAllow !== false;
  if (profile === 'workspace') {
    for (const c of packageCacheWriteRoots(homeAbs, platform)) writeRoots.add(c);
    // Terminal run logs under ~/.minnow (parent process writes these; allow for parity)
    writeRoots.add(resolvePolicyPath(path.join(minnowAbs, 'logs', 'terminal')));
  }

  const denyReadRoots = [];
  // Whole Minnow home is denied; narrower allows re-open the active slot + logs.
  denyReadRoots.push(minnowAbs);
  for (const entry of CREDENTIAL_DENY_ENTRIES) {
    denyReadRoots.push(resolvePolicyPath(path.join(homeAbs, entry.rel)));
  }

  const allowReadExceptions = [];
  if (worktreeAbs) {
    allowReadExceptions.push(worktreeAbs);
  }
  allowReadExceptions.push(resolvePolicyPath(path.join(minnowAbs, 'logs', 'terminal')));

  return {
    profile,
    home: homeAbs,
    minnowHome: minnowAbs,
    workspaceRoot: workspaceAbs,
    worktreeRoot: worktreeAbs,
    writeRoots: [...writeRoots],
    denyReadRoots,
    allowReadExceptions,
    networkAllow: allowNetwork,
    platform,
  };
}

/** Convenience alias matching the plan's naming. */
export function buildWorkspacePolicy(params = {}) {
  return buildPolicy({ ...params, profile: 'workspace' });
}
