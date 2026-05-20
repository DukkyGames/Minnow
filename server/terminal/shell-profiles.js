/**
 * OS-gated shell profile catalog for interactive PTY tabs.
 */

import { execSync } from 'child_process';
import fs from 'fs';

/** @typedef {{ id: string; label: string; shell: string; args: string[]; platform: string }} ShellProfile */

let wslDetected = null;

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
 * Build profiles for a platform (pure, testable).
 * @param {string} platform - Node `process.platform`
 * @param {{ wsl?: boolean }} [options]
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
    });
    profiles.push({
      id: 'cmd',
      label: 'Command Prompt',
      shell: 'cmd.exe',
      args: [],
      platform: 'win32',
    });
    if (options.wsl !== false && (options.wsl === true || detectWsl(platform))) {
      profiles.push({
        id: 'bash',
        label: 'WSL Bash',
        shell: 'wsl.exe',
        args: ['-e', 'bash', '-l'],
        platform: 'win32',
      });
    }
    return profiles;
  }

  if (platform === 'darwin') {
    profiles.push({
      id: 'zsh',
      label: 'zsh',
      shell: '/bin/zsh',
      args: ['-l'],
      platform: 'darwin',
    });
    profiles.push({
      id: 'bash',
      label: 'bash',
      shell: '/bin/bash',
      args: ['-l'],
      platform: 'darwin',
    });
    return profiles;
  }

  profiles.push({
    id: 'bash',
    label: 'bash',
    shell: '/bin/bash',
    args: ['-l'],
    platform: 'linux',
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
  return getAvailableShellProfiles().find((p) => p.id === id) ?? null;
}

/**
 * Default shell profile id for the current OS.
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
