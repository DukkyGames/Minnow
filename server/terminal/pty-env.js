/**
 * Environment for interactive PTY shells.
 *
 * Electron and CI often leak TERM=dumb, COLUMNS, LINES, and TERMCAP into
 * process.env. Those values make zsh skip or delay zle, so ArrowUp echoes as
 * caret notation (^[[A) instead of recalling history.
 */

import { gitBashSpawnEnvPatch } from './git-bash.js';

/** Keys that confuse an interactive line editor when inherited from the host. */
const DROP_ENV_KEYS = [
  'TMUX',
  'TMUX_PANE',
  'STY',
  'WINDOW',
  'WINDOWID',
  'TERMCAP',
  'COLUMNS',
  'LINES',
  'ELECTRON_RUN_AS_NODE',
];

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [baseEnv]
 * @param {{ term?: string; workspaceRoot?: string; termProgram?: string; gitBash?: boolean }} [options]
 * @returns {Record<string, string>}
 */
export function buildPtySpawnEnv(baseEnv = process.env, options = {}) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  for (const key of DROP_ENV_KEYS) {
    delete env[key];
  }

  const term = options.term ?? 'xterm-256color';
  env.TERM = term;
  if (!env.COLORTERM) {
    env.COLORTERM = 'truecolor';
  }
  env.TERM_PROGRAM = options.termProgram ?? 'Minnow';
  if (options.workspaceRoot) {
    env.MINNOW_WORKSPACE_ROOT = options.workspaceRoot;
  }
  if (options.gitBash) {
    Object.assign(env, gitBashSpawnEnvPatch());
  }
  return env;
}
