import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMinnowHome } from '../../config/home.js';
import { getWorktreesRoot, isPathUnderWorktreesRoot } from '../../worktree/paths.js';
import { getEffectiveWorkspaceRoot } from '../../runtime/path-access.js';

/** @typedef {'workspace' | 'strict'} SandboxProfileName */

/**
 * @typedef {object} SandboxPolicy
 * @property {SandboxProfileName} profile
 * @property {string} home
 * @property {string} minnowHome
 * @property {string} workspaceRoot
 * @property {string | null} worktreeRoot
 * @property {string[]} writeRoots
 * @property {string[]} denyReadRoots
 * @property {string[]} allowReadExceptions
 * @property {boolean} networkAllow
 * @property {string} platform
 */

/**
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
  { rel: path.join('Library', 'Application Support', 'Google', 'Chrome') },
  { rel: path.join('Library', 'Application Support', 'Chromium') },
  { rel: path.join('Library', 'Application Support', 'Firefox') },
  { rel: '.mozilla' },
  { rel: path.join('.config', 'google-chrome') },
  { rel: path.join('.config', 'chromium') },
]);

/**
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
 * @param {string} cwd
 * @param {string} [worktreesRoot]
 * @returns {string | null}
 */
export function detectWorktreeRoot(cwd, worktreesRoot = getWorktreesRoot()) {
  if (!cwd || typeof cwd !== 'string') return null;
  const resolved = resolvePolicyPath(cwd);
  const root = resolvePolicyPath(worktreesRoot);
  if (!isUnderRoot(resolved, root) && !isPathUnderWorktreesRoot(resolved)) {
    return null;
  }
  return resolved;
}

/**
 * @param {object} [params]
 * @param {SandboxProfileName} [params.profile]
 * @param {string} [params.workspaceRoot]
 * @param {string} [params.cwd]
 * @param {string} [params.worktreeRoot]
 * @param {string} [params.home]
 * @param {string} [params.minnowHome]
 * @param {string} [params.platform]
 * @param {boolean} [params.networkAllow]
 * @returns {SandboxPolicy}
 */
export function buildPolicy({
  profile = 'workspace',
  workspaceRoot = getEffectiveWorkspaceRoot(),
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

  const primaryWrite = worktreeAbs ?? workspaceAbs;

  const writeRoots = new Set();
  writeRoots.add(primaryWrite);
  writeRoots.add(workspaceAbs);

  for (const t of tempWriteRoots()) writeRoots.add(t);

  const allowNetwork = profile === 'strict' ? false : networkAllow !== false;
  if (profile === 'workspace') {
    for (const c of packageCacheWriteRoots(homeAbs, platform)) writeRoots.add(c);
    writeRoots.add(resolvePolicyPath(path.join(minnowAbs, 'logs', 'terminal')));
  }

  const denyReadRoots = [];
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

export function buildWorkspacePolicy(params = {}) {
  return buildPolicy({ ...params, profile: 'workspace' });
}
