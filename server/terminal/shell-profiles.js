/**
 * OS-gated shell profile catalog for interactive PTY tabs and execute_command.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import {
  buildWslInteractiveArgs,
  listWslDistros,
  resolveWslDistroFromProfileId,
  WSL_PROFILE_PREFIX,
} from './wsl.js';

/**
 * @typedef {object} ShellProfile
 * @property {string} id
 * @property {string} label
 * @property {string} shell
 * @property {string[]} args
 * @property {string} platform
 * @property {'native' | 'wsl'} [runtime]
 * @property {string} [distro] WSL distribution name when runtime is wsl
 */

let wslDetected = null;
/** @type {{ distros: string[]; defaultDistro: string | null } | null} */
let wslCatalog = null;

/**
 * Whether WSL is available (Windows only, cached).
 * @param {string} [platform]
 */
export function detectWsl(platform = process.platform) {
  if (platform !== 'win32') return false;
  if (wslDetected !== null) return wslDetected;
  try {
    execSync('wsl.exe --status', { stdio: 'ignore', timeout: 3000 });
    wslDetected = true;
  } catch {
    wslDetected = false;
  }
  return wslDetected;
}

/**
 * Cached WSL distro list (Windows only).
 * @param {{ wsl?: boolean }} [options]
 */
function getWslCatalog(options = {}) {
  if (wslCatalog !== null) return wslCatalog;
  if (options.wsl === false) {
    wslCatalog = { distros: [], defaultDistro: null };
    return wslCatalog;
  }
  if (options.wsl !== true && !detectWsl()) {
    wslCatalog = { distros: [], defaultDistro: null };
    return wslCatalog;
  }
  wslCatalog = listWslDistros();
  return wslCatalog;
}

/** Reset cached WSL detection (tests). */
export function resetWslShellProfileCache() {
  wslDetected = null;
  wslCatalog = null;
}

/**
 * Resolve executable on PATH (first match).
 * @param {string[]} candidates
 */
function resolveOnPath(candidates) {
  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');
  for (const name of candidates) {
    for (const dir of dirs) {
      const full = `${dir}${process.platform === 'win32' ? '\\' : '/'}${name}`;
      try {
        if (fs.existsSync(full)) return full;
      } catch {
        /* skip */
      }
    }
  }
  return candidates[0];
}

/**
 * @param {string} distro
 * @param {boolean} isDefault
 * @returns {ShellProfile}
 */
function wslDistroProfile(distro, isDefault) {
  const suffix = isDefault ? ' (default)' : '';
  return {
    id: `${WSL_PROFILE_PREFIX}${distro}`,
    label: `WSL ${distro}${suffix}`,
    shell: 'wsl.exe',
    args: buildWslInteractiveArgs({ distro }),
    platform: 'win32',
    runtime: 'wsl',
    distro,
  };
}

/**
 * Build profiles for a platform (pure, testable).
 * @param {string} platform - Node `process.platform`
 * @param {{ wsl?: boolean; wslDistros?: string[]; wslDefaultDistro?: string | null }} [options]
 * @returns {ShellProfile[]}
 */
export function resolveProfiles(platform, options = {}) {
  const profiles = [];

  if (platform === 'win32') {
    const pwsh = resolveOnPath(['pwsh.exe', 'powershell.exe']);
    profiles.push({
      id: 'powershell',
      label: pwsh.toLowerCase().includes('pwsh') ? 'PowerShell 7' : 'PowerShell',
      shell: pwsh,
      args: ['-NoLogo'],
      platform: 'win32',
      runtime: 'native',
    });
    profiles.push({
      id: 'cmd',
      label: 'Command Prompt',
      shell: 'cmd.exe',
      args: [],
      platform: 'win32',
      runtime: 'native',
    });

    const catalog =
      options.wslDistros != null
        ? {
            distros: options.wslDistros,
            defaultDistro: options.wslDefaultDistro ?? options.wslDistros[0] ?? null,
          }
        : getWslCatalog(options);

    if (catalog.distros.length > 0) {
      for (const distro of catalog.distros) {
        profiles.push(
          wslDistroProfile(distro, distro === catalog.defaultDistro),
        );
      }

      const defaultDistro = catalog.defaultDistro ?? catalog.distros[0];
      profiles.push({
        id: 'bash',
        label: defaultDistro ? `WSL Bash (${defaultDistro})` : 'WSL Bash',
        shell: 'wsl.exe',
        args: buildWslInteractiveArgs({ distro: defaultDistro }),
        platform: 'win32',
        runtime: 'wsl',
        distro: defaultDistro ?? undefined,
      });
    }

    return profiles;
  }

  if (platform === 'darwin') {
    profiles.push({
      id: 'zsh',
      label: 'zsh',
      shell: '/bin/zsh',
      args: ['-il'],
      platform: 'darwin',
      runtime: 'native',
    });
    profiles.push({
      id: 'bash',
      label: 'bash',
      shell: '/bin/bash',
      args: ['-il'],
      platform: 'darwin',
      runtime: 'native',
    });
    return profiles;
  }

  profiles.push({
    id: 'bash',
    label: 'bash',
    shell: '/bin/bash',
    args: ['-il'],
    platform: 'linux',
    runtime: 'native',
  });
  return profiles;
}

/** Profiles available on this machine. */
export function getAvailableShellProfiles() {
  return resolveProfiles(process.platform);
}

/**
 * @param {string} id
 * @returns {ShellProfile | null}
 */
export function getShellProfileById(id) {
  const direct = getAvailableShellProfiles().find((p) => p.id === id);
  if (direct) return direct;

  if (id.startsWith(WSL_PROFILE_PREFIX)) {
    const distro = id.slice(WSL_PROFILE_PREFIX.length);
    if (distro) {
      return wslDistroProfile(distro, false);
    }
  }

  return null;
}

/**
 * Resolve distro + runtime flags for a profile record.
 * @param {ShellProfile | null | undefined} profile
 * @returns {{ runtime: 'native' | 'wsl'; distro: string | null }}
 */
export function describeShellProfileRuntime(profile) {
  if (!profile) return { runtime: 'native', distro: null };
  if (profile.runtime === 'wsl') {
    const catalog = getWslCatalog();
    return {
      runtime: 'wsl',
      distro:
        profile.distro ??
        resolveWslDistroFromProfileId(profile.id, catalog.defaultDistro),
    };
  }
  return { runtime: 'native', distro: null };
}

/**
 * Build PTY spawn options for a shell profile and cwd.
 * @param {ShellProfile} profile
 * @param {string} cwd Windows or POSIX cwd
 * @returns {{ shell: string; args: string[]; cwd: string }}
 */
export function resolvePtySpawnForProfile(profile, cwd) {
  const { runtime, distro } = describeShellProfileRuntime(profile);
  if (runtime === 'wsl') {
    return {
      shell: 'wsl.exe',
      args: buildWslInteractiveArgs({ distro, cwd }),
      cwd: process.env.USERPROFILE ?? process.env.SystemRoot ?? cwd,
    };
  }
  return { shell: profile.shell, args: profile.args, cwd };
}

/**
 * Default shell profile id for the current OS (PowerShell on Windows, bash elsewhere).
 */
export function getDefaultShellProfileId() {
  const available = getAvailableShellProfiles();
  if (available.length === 0) return 'powershell';
  const preferred =
    process.platform === 'win32'
      ? available.find((p) => p.id === 'powershell')
      : available.find((p) => p.id === 'bash' || p.id === 'zsh');
  return preferred?.id ?? available[0].id;
}
