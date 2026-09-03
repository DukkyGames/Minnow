/**
 * WSL distro discovery and Windows ↔ Linux path mapping for terminal shells.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

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
 * Live probes are async-warmed so the first shell tool does not block the server (MIN-584).
 * Fixture output stays synchronous for tests.
 * @param {{ listOutput?: string; defaultOutput?: string }} [fixtures] test hooks
 * @returns {{ distros: string[]; defaultDistro: string | null }}
 */
let wslDistroCache = null;
/** @type {Promise<{ distros: string[]; defaultDistro: string | null }> | null} */
let wslDistroWarmup = null;

function catalogFromFixtures(fixtures) {
  try {
    const listRaw = fixtures.listOutput ?? '';
    const distros = parseWslDistroList(listRaw);
    if (distros.length === 0) {
      return { distros: [], defaultDistro: null };
    }
    let defaultDistro = distros[0] ?? null;
    try {
      const verboseRaw = fixtures.defaultOutput ?? '';
      defaultDistro = parseDefaultWslDistro(verboseRaw) ?? defaultDistro;
    } catch {
      /* fall back to first listed distro */
    }
    return { distros, defaultDistro };
  } catch {
    return { distros: [], defaultDistro: null };
  }
}

export function listWslDistros(fixtures = {}) {
  const hasFixtures = fixtures.listOutput != null || fixtures.defaultOutput != null;
  if (hasFixtures) {
    return catalogFromFixtures(fixtures);
  }
  if (process.platform !== 'win32') {
    return { distros: [], defaultDistro: null };
  }
  if (wslDistroCache) return wslDistroCache;
  void warmupWslDistros();
  return { distros: [], defaultDistro: null };
}

/** Async WSL `-l` probes; fills {@link wslDistroCache}. */
export async function warmupWslDistros() {
  if (process.platform !== 'win32') {
    wslDistroCache = { distros: [], defaultDistro: null };
    return wslDistroCache;
  }
  if (wslDistroWarmup) return wslDistroWarmup;
  wslDistroWarmup = (async () => {
    try {
      const { stdout: listRaw } = await execFileAsync('wsl.exe', ['-l', '-q'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
      const distros = parseWslDistroList(listRaw);
      if (distros.length === 0) {
        wslDistroCache = { distros: [], defaultDistro: null };
        return wslDistroCache;
      }
      let defaultDistro = distros[0] ?? null;
      try {
        const { stdout: verboseRaw } = await execFileAsync('wsl.exe', ['-l', '-v'], {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true,
        });
        defaultDistro = parseDefaultWslDistro(verboseRaw) ?? defaultDistro;
      } catch {
        /* fall back to first listed distro */
      }
      wslDistroCache = { distros, defaultDistro };
    } catch {
      wslDistroCache = { distros: [], defaultDistro: null };
    }
    return wslDistroCache;
  })();
  return wslDistroWarmup;
}

export function resetWslDistroCacheForTests() {
  wslDistroCache = null;
  wslDistroWarmup = null;
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
 * Escape unescaped `$` for Windows `wsl.exe … bash -c` one-shots so host parsing
 * does not strip variables before bash sees them. Idempotent (already `\$` unchanged).
 * @param {string} command
 * @returns {string}
 */
export function escapeDollarsForWindowsWslOneShot(command) {
  if (typeof command !== 'string' || command.length === 0) return command;
  return command.replace(/(?<!\\)\$/g, '\\$');
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
    const script =
      process.platform === 'win32'
        ? escapeDollarsForWindowsWslOneShot(command)
        : command;
    wslArgs.push('--', 'bash', '-l', '-c', script);
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
