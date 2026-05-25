/**
 * Frozen context passed to plugin handler.mjs (workspace + minnow home).
 */

import { getMinnowHome } from '../config/home.js';
import { getWorkspaceRoot } from '../workspace/root.js';

/**
 * @typedef {object} PluginContext
 * @property {string} workspaceRoot
 * @property {string} minnowHome
 * @property {(message: string) => void} log
 * @property {Readonly<Record<string, string | undefined>>} env
 */

/**
 * @param {{ log?: (message: string) => void }} [options]
 * @returns {PluginContext}
 */
export function createPluginContext(options = {}) {
  const log =
    typeof options.log === 'function'
      ? options.log
      : (message) => console.log(`[plugin] ${message}`);

  return Object.freeze({
    workspaceRoot: getWorkspaceRoot(),
    minnowHome: getMinnowHome(),
    log,
    env: Object.freeze({
      NODE_ENV: process.env.NODE_ENV,
      MINNOW_HOME: process.env.MINNOW_HOME,
    }),
  });
}
