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
 * Parse the script payload after `node -e` / `python -c` in a one-shot string.
 * @param {string} rest — text after the `-e` / `-c` flag
 * @returns {string | null}
 */
function parseInlineScriptPayload(rest) {
  const trimmed = rest.trim();
  if (!trimmed) return null;
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    let out = '';
    for (let i = 1; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (ch === '\\' && i + 1 < trimmed.length) {
        out += trimmed[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        return out;
      }
      out += ch;
    }
    return null;
  }
  return trimmed;
}

/**
 * Rewrite `node -e <script>` / `python -c <script>` one-liners to argv spawn (shell:false).
 * @param {string} command
 * @returns {{ command: string, args: string[] } | null}
 */
export function tryRewriteInlineInterpreterCommand(command) {
  if (typeof command !== 'string') return null;
  const trimmed = command.trim();
  const node = trimmed.match(/^node(?:\.exe)?\s+-e\s+([\s\S]+)$/i);
  if (node) {
    const script = parseInlineScriptPayload(node[1]);
    if (script == null) return null;
    return { command: 'node', args: ['-e', script] };
  }
  const python = trimmed.match(/^(py|python3?)\s+-c\s+([\s\S]+)$/i);
  if (python) {
    const script = parseInlineScriptPayload(python[2]);
    if (script == null) return null;
    return { command: python[1].toLowerCase(), args: ['-c', script] };
  }
  return null;
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

  if (oneShot) {
    const rewritten = tryRewriteInlineInterpreterCommand(command);
    if (rewritten) {
      return {
        command: rewritten.command,
        args: rewritten.args,
        shell: false,
      };
    }
  }

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
