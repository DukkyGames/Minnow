/**
 * Resolve spawn targets for one-shot shell command strings (agent execute_command).
 * Windows uses cmd.exe; Unix uses a login shell so PATH/profile matches interactive PTY tabs.
 */

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
 * @returns {{ command: string, args: string[], shell: boolean }}
 */
export function resolveOneShotSpawn({
  command,
  args = [],
  shell = false,
  platform = process.platform,
}) {
  const oneShot = args.length === 0 && typeof command === 'string';
  const winOneShot = oneShot && platform === 'win32';
  const unixOneShot = oneShot && platform !== 'win32';

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
