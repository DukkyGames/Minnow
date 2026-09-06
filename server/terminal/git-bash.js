/**
 * Git for Windows bash.exe detection and spawn helpers.
 *
 * Never resolve bash.exe from PATH: System32\bash.exe is the WSL launcher.
 * Never spawn git-bash.exe: that is mintty and cannot attach to node-pty.
 */

import fs from 'fs';
import path from 'path';

/** Profile id for Git Bash. Must not reuse Windows `bash` (that is WSL). */
export const GIT_BASH_PROFILE_ID = 'git-bash';

/** @type {string | null | undefined} undefined = not probed */
let cachedPath;

/** Reset cached detection (tests). */
export function resetGitBashCacheForTests() {
  cachedPath = undefined;
}

/**
 * MSYS/Git Bash env so a login shell keeps the workspace cwd, uses ConPTY,
 * and still sees Windows node/npm on PATH.
 * @returns {Record<string, string>}
 */
export function gitBashSpawnEnvPatch() {
  return {
    CHERE_INVOKING: '1',
    MSYSTEM: 'MINGW64',
    MSYS: 'enable_pcon',
    MSYS2_PATH_TYPE: 'inherit',
  };
}

/**
 * Convert a Windows absolute path to an MSYS path (`C:\foo` → `/c/foo`).
 * @param {string} winPath
 * @returns {string}
 */
export function windowsPathToMsysPath(winPath) {
  if (typeof winPath !== 'string' || !winPath.trim()) return winPath;

  const normalized = winPath.trim().replace(/\//g, '\\');
  const driveMatch = /^([a-zA-Z]):\\(.*)$/.exec(normalized);
  if (!driveMatch) {
    if (winPath.startsWith('/')) return winPath.replace(/\\/g, '/');
    return winPath;
  }

  const drive = driveMatch[1].toLowerCase();
  const rest = driveMatch[2].replace(/\\/g, '/');
  return `/${drive}${rest ? `/${rest}` : ''}`.replace(/\/+/g, '/');
}

/** Interactive PTY argv for Git `bin/bash.exe`. */
export function buildGitBashInteractiveArgs() {
  return ['--login', '-i'];
}

/**
 * One-shot spawn for an agent command string inside Git Bash.
 * @param {object} options
 * @param {string} options.command
 * @param {string} [options.cwd]
 * @param {string} options.bashPath
 * @returns {{ command: string; args: string[]; shell: boolean; cwd?: string; env: Record<string, string> }}
 */
export function buildGitBashOneShotSpawn({ command, cwd = null, bashPath }) {
  return {
    command: bashPath,
    args: ['--login', '-c', command],
    shell: false,
    ...(cwd != null ? { cwd } : {}),
    env: gitBashSpawnEnvPatch(),
  };
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
function bashExists(candidate) {
  if (typeof candidate !== 'string' || !candidate) return false;
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

/**
 * System32\bash.exe is WSL, not Git Bash.
 * @param {string} filePath
 * @returns {boolean}
 */
function isUnsafeBashPath(filePath) {
  const lower = filePath.replace(/\//g, '\\').toLowerCase();
  return lower.includes('\\system32\\');
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {string[]}
 */
function wellKnownBashCandidates(env) {
  const candidates = [];
  const programFiles = env.ProgramFiles;
  const programFilesX86 = env['ProgramFiles(x86)'];
  const localAppData = env.LOCALAPPDATA;
  const home = env.USERPROFILE || env.HOME;

  if (programFiles) {
    candidates.push(path.join(programFiles, 'Git', 'bin', 'bash.exe'));
  }
  if (programFilesX86) {
    candidates.push(path.join(programFilesX86, 'Git', 'bin', 'bash.exe'));
  }
  if (localAppData) {
    candidates.push(path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'));
  }
  if (home) {
    candidates.push(path.join(home, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'));
  }
  return candidates;
}

/**
 * If git.exe lives next to a Git for Windows layout, sibling `../bin/bash.exe`.
 * @param {string} gitExe
 * @returns {string | null}
 */
function siblingBashFromGitExe(gitExe) {
  const base = path.basename(gitExe).toLowerCase();
  if (base !== 'git.exe' && base !== 'git') return null;
  return path.resolve(path.dirname(gitExe), '..', 'bin', 'bash.exe');
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {string | null}
 */
function bashFromGitOnPath(env) {
  const pathEnv = env.PATH ?? env.Path ?? '';
  const dirs = String(pathEnv).split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const gitExe = path.join(dir, 'git.exe');
    if (!bashExists(gitExe)) continue;
    const bash = siblingBashFromGitExe(gitExe);
    if (bash && bashExists(bash) && !isUnsafeBashPath(bash)) {
      return bash;
    }
  }
  return null;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {string | null}
 */
function probeGitBashPath(env) {
  for (const candidate of wellKnownBashCandidates(env)) {
    if (bashExists(candidate) && !isUnsafeBashPath(candidate)) {
      return path.resolve(candidate);
    }
  }
  return bashFromGitOnPath(env);
}

/**
 * Resolve Git for Windows `bin/bash.exe`, or null when it is not installed.
 * @param {{ gitBashPath?: string | null; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }} [options]
 * @returns {string | null}
 */
export function detectGitBashPath(options = {}) {
  if (options.gitBashPath === null) return null;
  if (typeof options.gitBashPath === 'string' && options.gitBashPath.trim()) {
    return options.gitBashPath.trim();
  }

  const useCache = options.env == null;
  if (useCache && cachedPath !== undefined) return cachedPath;

  const found = probeGitBashPath(options.env ?? process.env);
  if (useCache) cachedPath = found;
  return found;
}
