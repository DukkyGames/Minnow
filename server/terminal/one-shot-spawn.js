/**
 * Resolve spawn targets for one-shot shell command strings (agent execute_command).
 * Windows uses cmd.exe by default; WSL profiles route through wsl.exe + bash -l.
 */

import { buildWslOneShotSpawn } from './wsl.js';
import { describeShellProfileRuntime } from './shell-profiles.js';

/**
 * Pick a login shell for Unix one-shot invocations (macOS zsh, Linux bash).
 * @param {string} platform - Node `process.platform`
 * @returns {{ shell: string, loginArgs: string[] }}
 */
export function resolveUnixLoginShell(platform) {
  const shellEnv = typeof process.env.SHELL === 'string' ? process.env.SHELL.trim() : '';

  if (platform === 'darwin') {
    if (shellEnv.endsWith('/zsh') || shellEnv === 'zsh') {
      return { shell: shellEnv, loginArgs: ['-l'] };
    }
    if (shellEnv.endsWith('/bash') || shellEnv === 'bash') {
      return { shell: shellEnv, loginArgs: ['-l'] };
    }
    return { shell: '/bin/zsh', loginArgs: ['-l'] };
  }

  if (platform === 'linux') {
    if (shellEnv.endsWith('/bash') || shellEnv === 'bash') {
      return { shell: shellEnv, loginArgs: ['-l'] };
    }
    if (shellEnv.endsWith('/zsh') || shellEnv === 'zsh') {
      return { shell: shellEnv, loginArgs: ['-l'] };
    }
    return { shell: '/bin/bash', loginArgs: ['-l'] };
  }

  return { shell: '/bin/sh', loginArgs: [] };
}

/**
 * Map a command + args pair to the executable Node should spawn.
 * One-shot strings (no argv) run through the platform shell so pipes, redirects,
 * and `||` behave like an interactive terminal.
 *
 * @param {object} params
 * @param {string} params.command
 * @param {string[]} [params.args]
 * @param {boolean} [params.shell]
 * @param {string} [params.platform]
 * @param {import('./shell-profiles.js').ShellProfile | null} [params.shellProfile]
 * @param {string} [params.cwd]
 * @returns {{ command: string, args: string[], shell: boolean, cwd?: string }}
 */
export function resolveOneShotSpawn({
  command,
  args = [],
  shell = false,
  platform = process.platform,
  shellProfile = null,
  cwd = null,
}) {
  const oneShot = args.length === 0 && typeof command === 'string';
  const winOneShot = oneShot && platform === 'win32';
  const unixOneShot = oneShot && platform !== 'win32';
  const { runtime, distro } = describeShellProfileRuntime(shellProfile);

  if (runtime === 'wsl' && platform === 'win32') {
    return buildWslOneShotSpawn({
      command,
      args,
      distro,
      cwd: cwd ?? undefined,
    });
  }

  if (winOneShot) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command],
      shell: false,
    };
  }

  if (unixOneShot) {
    const login = resolveUnixLoginShell(platform);
    return {
      command: login.shell,
      args: [...login.loginArgs, '-c', command],
      shell: false,
    };
  }

  return {
    command,
    args,
    shell: shell === true,
  };
}
