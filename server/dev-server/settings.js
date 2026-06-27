/**
 * Per-workspace dev-server UI settings (port + network bind), persisted in config.json.
 */

import { readConfigJson, writeConfigJson } from '../config/store.js';
import { mergeConfigMeta } from '../config/validators.js';
import { normalizeWorkspacePathKey } from '../workspace/root.js';
import path from 'node:path';

/** @typedef {'local' | 'lan'} DevServerNetwork */

/**
 * @typedef {object} DevServerSettings
 * @property {number} [port]
 * @property {DevServerNetwork} [network]
 */

/** Default workspace dev-server port (not Minnow's host port — see server/constants/minnow-port.js). */
const DEFAULT_PORT = 3000;
const DEFAULT_NETWORK = /** @type {DevServerNetwork} */ ('local');

/**
 * @param {unknown} value
 * @returns {DevServerNetwork}
 */
function coerceNetwork(value) {
  return value === 'lan' ? 'lan' : 'local';
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function coercePort(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 65536) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0 && n < 65536) return Math.floor(n);
  }
  return undefined;
}

/**
 * @param {string} workspaceRoot
 */
function settingsKey(workspaceRoot) {
  return normalizeWorkspacePathKey(path.resolve(workspaceRoot));
}

/**
 * @param {Record<string, unknown>} row
 * @returns {DevServerSettings}
 */
function coerceSettingsRow(row) {
  /** @type {DevServerSettings} */
  const out = {};
  const port = coercePort(row.port);
  if (port != null) out.port = port;
  if (row.network != null) out.network = coerceNetwork(row.network);
  return out;
}

/**
 * @param {string} workspaceRoot
 * @returns {Promise<DevServerSettings>}
 */
export async function readDevServerSettings(workspaceRoot) {
  const key = settingsKey(workspaceRoot);
  const meta = (await readConfigJson('config.json')) ?? {};
  const ws =
    meta.workspace && typeof meta.workspace === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.workspace)
      : null;
  const byPath =
    ws?.devServerSettingsByPath && typeof ws.devServerSettingsByPath === 'object'
      ? /** @type {Record<string, unknown>} */ (ws.devServerSettingsByPath)
      : null;
  const row = byPath?.[key];
  if (!row || typeof row !== 'object') {
    return { port: DEFAULT_PORT, network: DEFAULT_NETWORK };
  }
  const parsed = coerceSettingsRow(/** @type {Record<string, unknown>} */ (row));
  return {
    port: parsed.port ?? DEFAULT_PORT,
    network: parsed.network ?? DEFAULT_NETWORK,
  };
}

/**
 * @param {string} workspaceRoot
 * @param {Partial<DevServerSettings>} patch
 * @returns {Promise<DevServerSettings>}
 */
export async function writeDevServerSettings(workspaceRoot, patch) {
  const key = settingsKey(workspaceRoot);
  const current = await readDevServerSettings(workspaceRoot);

  const next = {
    port: patch.port != null ? coercePort(patch.port) ?? current.port : current.port,
    network:
      patch.network != null ? coerceNetwork(patch.network) : current.network,
  };

  const meta = (await readConfigJson('config.json')) ?? {};
  const existingWs =
    meta.workspace && typeof meta.workspace === 'object'
      ? { .../** @type {Record<string, unknown>} */ (meta.workspace) }
      : {};
  const byPath =
    existingWs.devServerSettingsByPath &&
    typeof existingWs.devServerSettingsByPath === 'object'
      ? { .../** @type {Record<string, unknown>} */ (existingWs.devServerSettingsByPath) }
      : {};

  byPath[key] = { port: next.port, network: next.network };
  existingWs.devServerSettingsByPath = byPath;

  const merged = mergeConfigMeta(meta, { workspace: existingWs });
  if (merged.workspace && typeof merged.workspace === 'object') {
    /** @type {Record<string, unknown>} */ (merged.workspace).devServerSettingsByPath =
      byPath;
  }
  await writeConfigJson('config.json', merged);
  return next;
}

export { DEFAULT_PORT, DEFAULT_NETWORK, coercePort, coerceNetwork };
