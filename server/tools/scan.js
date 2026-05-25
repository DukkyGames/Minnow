/**
 * Scan ~/.minnow/tools/<id>/ for tool.json + handler.mjs plugin packs.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { readConfigJson } from '../config/store.js';
import { toPluginNamespacedName } from './bridge.js';
import { ALL_TOOL_IDS } from '../config/tool-ids.js';
import {
  MAX_MANIFEST_BYTES,
  PLUGIN_ID_RE,
  validateToolManifest,
} from './validate.js';

export { PLUGIN_ID_RE } from './validate.js';

/**
 * @typedef {object} PluginCapabilities
 * @property {boolean} filesystem
 * @property {boolean} network
 * @property {boolean} nodeBuiltin
 */

/**
 * @typedef {object} PluginManifest
 * @property {string} id
 * @property {string} functionName
 * @property {string} label
 * @property {string} description
 * @property {string} category
 * @property {object} parameters
 * @property {PluginCapabilities} capabilities
 */

/**
 * @typedef {PluginManifest & { source: 'user', path: string, handlerPath: string, namespacedName: string }} PluginListItem
 */

/**
 * @returns {string}
 */
export function getUserPluginsRoot() {
  return path.join(getMinnowHome(), 'tools');
}

/**
 * @param {string} dirName
 */
export function shouldExposePluginDir(dirName) {
  return !dirName.startsWith('_');
}

/**
 * @param {string} rootDir
 * @returns {Promise<PluginListItem[]>}
 */
export async function scanPluginDir(rootDir) {
  /** @type {PluginListItem[]} */
  const items = [];

  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return items;
    }
    console.warn(`[plugins] Cannot read ${rootDir}:`, err);
    return items;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!shouldExposePluginDir(entry.name)) continue;

    const pluginDir = path.join(rootDir, entry.name);
    const manifestPath = path.join(pluginDir, 'tool.json');
    const handlerPath = path.join(pluginDir, 'handler.mjs');

    let manifestRaw;
    try {
      const stat = await fs.stat(manifestPath);
      if (stat.size > MAX_MANIFEST_BYTES) {
        console.warn(
          `[plugins] Skip ${entry.name}: tool.json exceeds ${MAX_MANIFEST_BYTES} bytes`,
        );
        continue;
      }
      manifestRaw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      console.warn(`[plugins] Skip ${entry.name}: missing or unreadable tool.json`);
      continue;
    }

    try {
      await fs.access(handlerPath);
    } catch {
      console.warn(`[plugins] Skip ${entry.name}: missing handler.mjs`);
      continue;
    }

    try {
      const parsed = JSON.parse(manifestRaw);
      const manifest = validateToolManifest(parsed, entry.name);
      if (ALL_TOOL_IDS.includes(manifest.id)) {
        console.warn(`[plugins] Skip ${entry.name}: id collides with built-in tool id`);
        continue;
      }

      const namespaced = toPluginNamespacedName(manifest.id, manifest.functionName);

      items.push({
        ...manifest,
        source: 'user',
        path: manifestPath,
        handlerPath,
        namespacedName: namespaced,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[plugins] Skip ${entry.name}: ${message}`);
    }
  }

  return items;
}

/**
 * @returns {Promise<Record<string, { enabled?: boolean }>>}
 */
async function loadPluginsIndex() {
  const toolsConfig = (await readConfigJson('tools.json')) ?? {};
  const plugins =
    toolsConfig && typeof toolsConfig === 'object' && toolsConfig.plugins
      ? /** @type {Record<string, { enabled?: boolean }>} */ (toolsConfig.plugins)
      : {};
  return plugins ?? {};
}

/**
 * @param {PluginListItem[]} items
 * @param {Record<string, { enabled?: boolean }>} index
 */
export function filterPluginsByIndex(items, index) {
  return items.filter((item) => {
    const meta = index[item.id];
    if (!meta) return true;
    return meta.enabled !== false;
  });
}

/**
 * @returns {Promise<PluginListItem[]>}
 */
export async function listMergedPlugins() {
  const root = getUserPluginsRoot();
  try {
    await fs.mkdir(root, { recursive: true });
  } catch {
    /* ignore */
  }
  const scanned = await scanPluginDir(root);
  const index = await loadPluginsIndex();
  return filterPluginsByIndex(scanned, index).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
}
