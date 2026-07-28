/**
 * WSL distro discovery and Windows ↔ Linux path mapping for terminal shells.
 */

import { execSync } from 'child_process';
import path from 'path';

/** Profile id prefix for per-distro WSL shells (`wsl:Ubuntu`). */
export const WSL_PROFILE_PREFIX = 'wsl:';

/**
 * @param {string} profileId
 * @returns {boolean}
 */
export function isWslProfileId(profileId) {
  return (
    typeof profileId === 'string' &&
    (profileId === 'bash' || profileId.startsWith(WSL_PROFILE_PREFIX))
  );
}

/**
 * Strip BOM / null bytes from `wsl.exe` stdout (Windows quirk).
 * @param {string | Buffer} raw
 * @returns {string}
 */
export function sanitizeWslOutput(raw) {
  return String(raw)
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .trim();
}

/**
 * Parse `wsl.exe -l -q` output into distro names.
 * @param {string} output
 * @returns {string[]}
 */
export function parseWslDistroList(output) {
  const text = sanitizeWslOutput(output);
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Parse default distro marker from `wsl.exe -l -v` table output.
 * @param {string} output
 * @returns {string | null}
 */
export function parseDefaultWslDistro(output) {
  const lines = sanitizeWslOutput(output).split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('*')) {
      const name = trimmed.replace(/^\*\s*/, '').split(/\s+/)[0];
      return name || null;
    }
  }
  return null;
}

/**
 * List installed WSL distro names (Windows only).
 * @param {{ listOutput?: string; defaultOutput?: string }} [fixtures] test hooks
 * @returns {{ distros: string[]; defaultDistro: string | null }}
 */
export function listWslDistros(fixtures = {}) {
  const hasFixtures = fixtures.listOutput != null || fixtures.defaultOutput != null;
  if (process.platform !== 'win32' && !hasFixtures) {
    return { distros: [], defaultDistro: null };
  }

  try {
    const listRaw =
      fixtures.listOutput ??
      execSync('wsl.exe -l -q', { encoding: 'utf8', timeout: 5000 });
    const distros = parseWslDistroList(listRaw);
    if (distros.length === 0) {
      return { distros: [], defaultDistro: null };
    }

    let defaultDistro = distros[0] ?? null;
    try {
      const verboseRaw =
        fixtures.defaultOutput ??
        execSync('wsl.exe -l -v', { encoding: 'utf8', timeout: 5000 });
      defaultDistro = parseDefaultWslDistro(verboseRaw) ?? defaultDistro;
    } catch {
      /* fall back to first listed distro */
    }

    return { distros, defaultDistro };
  } catch {
    return { distros: [], defaultDistro: null };
  }
}

/**
 * Convert a Windows absolute path to a WSL mount path (`C:\foo` → `/mnt/c/foo`).
 * Returns the input unchanged when it is already a POSIX path or not mappable.
 * @param {string} winPath
 * @returns {string}
 */
export function windowsPathToWslPath(winPath) {
  if (typeof winPath !== 'string' || !winPath.trim()) return winPath;

  const normalized = winPath.trim().replace(/\//g, '\\');
  const driveMatch = /^([a-zA-Z]):\\(.*)$/.exec(normalized);
  if (!driveMatch) {
    if (winPath.startsWith('/')) return winPath.replace(/\\/g, '/');
    return winPath;
  }

  const drive = driveMatch[1].toLowerCase();
  const rest = driveMatch[2].replace(/\\/g, '/');
  return `/mnt/${drive}${rest ? `/${rest}` : ''}`.replace(/\/+/g, '/');
}

/**
 * Convert a WSL mount path to a Windows path (`/mnt/c/foo` → `C:\foo`).
 * @param {string} wslPath
 * @returns {string}
 */
export function wslPathToWindowsPath(wslPath) {
  if (typeof wslPath !== 'string' || !wslPath.trim()) return wslPath;

  const posix = wslPath.trim().replace(/\\/g, '/');
  const mountMatch = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(posix);
  if (!mountMatch) return wslPath;

  const drive = mountMatch[1].toUpperCase();
  const rest = mountMatch[2] ? mountMatch[2].replace(/\//g, '\\') : '';
  return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
}

/**
 * Resolve the WSL distro name encoded in a shell profile id.
 * @param {string} profileId
 * @param {string | null} [defaultDistro]
 * @returns {string | null}
 */
export function resolveWslDistroFromProfileId(profileId, defaultDistro = null) {
  if (profileId === 'bash') return defaultDistro;
  if (!profileId.startsWith(WSL_PROFILE_PREFIX)) return null;
  const distro = profileId.slice(WSL_PROFILE_PREFIX.length).trim();
  return distro || defaultDistro;
}

/**
 * Build argv for `wsl.exe` interactive bash (PTY tabs).
 * @param {object} options
 * @param {string | null} [options.distro]
 * @param {string} [options.cwd] Windows cwd to pass via `--cd`
 * @returns {string[]}
 */
export function buildWslInteractiveArgs({ distro = null, cwd = null } = {}) {
  const args = [];
  if (distro) args.push('-d', distro);
  if (cwd) {
    const wslCwd = windowsPathToWslPath(cwd);
    if (wslCwd.startsWith('/')) args.push('--cd', wslCwd);
  }
  args.push('-e', 'bash', '-l');
  return args;
}

/**
 * Build spawn target for a one-shot command inside WSL bash.
 * @param {object} options
 * @param {string} options.command
 * @param {string[]} [options.args]
 * @param {string | null} [options.distro]
 * @param {string} [options.cwd] Windows cwd
 * @returns {{ command: string; args: string[]; shell: boolean; cwd?: string }}
 */
export function buildWslOneShotSpawn({
  command,
  args = [],
  distro = null,
  cwd = null,
}) {
  const wslArgs = [];
  if (distro) wslArgs.push('-d', distro);
  if (cwd) {
    const wslCwd = windowsPathToWslPath(cwd);
    if (wslCwd.startsWith('/')) wslArgs.push('--cd', wslCwd);
  }

  if (args.length === 0) {
    wslArgs.push('--', 'bash', '-l', '-c', command);
  } else {
    wslArgs.push('--', command, ...args);
  }

  return {
    command: 'wsl.exe',
    args: wslArgs,
    shell: false,
    cwd: process.env.USERPROFILE ?? process.env.SystemRoot ?? undefined,
  };
}
