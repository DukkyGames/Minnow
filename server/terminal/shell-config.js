/**
 * Read terminal shell preferences from ~/.minnow/config.json.
 */

import { readConfigJson } from '../config/store.js';
import { normalizeWorkspacePathKey } from '../workspace/root.js';
import {
  getAvailableShellProfiles,
  getDefaultShellProfileId,
  getShellProfileById,
} from './shell-profiles.js';

/**
 * @typedef {object} TerminalShellConfig
 * @property {string | undefined} defaultShellProfileId
 * @property {Record<string, string>} workspaceShellProfiles
 */

/**
 * Normalize workspace shell profile overrides from config.
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function normalizeWorkspaceShellProfiles(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    if (typeof key !== 'string' || !key.trim()) continue;
    if (typeof value !== 'string' || !value.trim()) continue;
    out[normalizeWorkspacePathKey(key)] = value.trim();
  }
  return out;
}

/**
 * @param {unknown} meta
 * @returns {TerminalShellConfig}
 */
export function readTerminalShellConfigFromMeta(meta) {
  const terminal =
    meta && typeof meta === 'object' && meta.terminal && typeof meta.terminal === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.terminal)
      : {};

  const defaultShellProfileId =
    typeof terminal.defaultShellProfileId === 'string' &&
    terminal.defaultShellProfileId.trim()
      ? terminal.defaultShellProfileId.trim()
      : undefined;

  return {
    defaultShellProfileId,
    workspaceShellProfiles: normalizeWorkspaceShellProfiles(
      terminal.workspaceShellProfiles,
    ),
  };
}

/**
 * Load terminal shell prefs from disk.
 * @returns {Promise<TerminalShellConfig>}
 */
export async function readTerminalShellConfig() {
  const meta = (await readConfigJson('config.json')) ?? {};
  return readTerminalShellConfigFromMeta(meta);
}

/**
 * Resolve the shell profile id for a workspace (override → global default → OS default).
 * @param {TerminalShellConfig} config
 * @param {string} [workspaceRoot]
 * @returns {string}
 */
export function resolveShellProfileId(config, workspaceRoot) {
  if (workspaceRoot) {
    const key = normalizeWorkspacePathKey(workspaceRoot);
    const override = config.workspaceShellProfiles[key];
    if (override && getShellProfileById(override)) {
      return override;
    }
  }

  if (
    config.defaultShellProfileId &&
    getShellProfileById(config.defaultShellProfileId)
  ) {
    return config.defaultShellProfileId;
  }

  return getDefaultShellProfileId();
}

/**
 * Resolve the shell profile record used for execute_command / background runs.
 * @param {string} [workspaceRoot]
 * @returns {Promise<import('./shell-profiles.js').ShellProfile | null>}
 */
export async function resolveExecuteShellProfile(workspaceRoot) {
  const config = await readTerminalShellConfig();
  const profileId = resolveShellProfileId(config, workspaceRoot);
  return getShellProfileById(profileId);
}

/**
 * List shell profiles with config-aware default marker (for API responses).
 * @returns {Promise<{ profiles: import('./shell-profiles.js').ShellProfile[]; defaultShellProfileId: string }>}
 */
export async function listShellProfilesForApi() {
  const config = await readTerminalShellConfig();
  const profiles = getAvailableShellProfiles();
  const defaultShellProfileId = resolveShellProfileId(config);
  return { profiles, defaultShellProfileId };
}
