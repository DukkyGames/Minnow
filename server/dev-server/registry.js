/**
 * Multi-server registry for workspace dev servers (config.json → workspace.devServersByPath).
 * Seeded once from startup.md; startup.md-linked entries re-read command/cwd/health from disk.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readConfigJson, writeConfigJson } from '../config/store.js';
import { mergeConfigMeta } from '../config/validators.js';
import { getWorkspaceRoot, normalizeWorkspacePathKey } from '../workspace/root.js';
import { coerceNetwork, coercePort, DEFAULT_NETWORK, DEFAULT_PORT, readDevServerSettings } from './settings.js';
import { readStartupGuide } from './startup-guide.js';

/** @typedef {'startup.md' | 'user'} DevServerSource */

/**
 * @typedef {object} DevServerDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} command
 * @property {string} [cwd]
 * @property {number} port
 * @property {'local' | 'lan'} network
 * @property {string} [healthUrl]
 * @property {boolean} [autoStart]
 * @property {number} [order]
 * @property {string} [worktreeRoot] — absolute git worktree path to run from (default: Code workspace)
 * @property {DevServerSource} source
 */

const PRIMARY_ID = 'primary';

/**
 * @param {string} workspaceRoot
 */
function registryKey(workspaceRoot) {
  return normalizeWorkspacePathKey(path.resolve(workspaceRoot));
}

/**
 * @param {Record<string, unknown>} row
 * @returns {DevServerDefinition | null}
 */
function coerceDefinition(row) {
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null;
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : null;
  const command = typeof row.command === 'string' ? row.command.trim() : '';
  if (!id || !name) return null;
  const port = coercePort(row.port) ?? DEFAULT_PORT;
  const network = coerceNetwork(row.network);
  /** @type {DevServerDefinition} */
  const out = {
    id,
    name,
    command,
    port,
    network,
    source: row.source === 'startup.md' ? 'startup.md' : 'user',
  };
  if (typeof row.cwd === 'string' && row.cwd.trim()) out.cwd = row.cwd.trim();
  if (typeof row.healthUrl === 'string' && row.healthUrl.trim()) out.healthUrl = row.healthUrl.trim();
  if (typeof row.autoStart === 'boolean') out.autoStart = row.autoStart;
  if (typeof row.order === 'number' && Number.isFinite(row.order)) out.order = Math.floor(row.order);
  if (typeof row.worktreeRoot === 'string' && row.worktreeRoot.trim()) {
    out.worktreeRoot = row.worktreeRoot.trim();
  }
  return out;
}

/**
 * Persist registry list for a workspace (exact settings.js write pattern).
 * @param {string} workspaceRoot
 * @param {DevServerDefinition[]} servers
 */
async function writeRegistry(workspaceRoot, servers) {
  const key = registryKey(workspaceRoot);
  const meta = (await readConfigJson('config.json')) ?? {};
  const existingWs =
    meta.workspace && typeof meta.workspace === 'object'
      ? { .../** @type {Record<string, unknown>} */ (meta.workspace) }
      : {};
  const byPath =
    existingWs.devServersByPath && typeof existingWs.devServersByPath === 'object'
      ? { .../** @type {Record<string, unknown>} */ (existingWs.devServersByPath) }
      : {};

  byPath[key] = {
    servers: servers.map((s) => {
      if (s.source === 'startup.md') {
        return {
          id: s.id,
          name: s.name,
          port: s.port,
          network: s.network,
          autoStart: s.autoStart ?? false,
          order: s.order ?? 0,
          worktreeRoot: s.worktreeRoot ?? null,
          source: 'startup.md',
        };
      }
      return {
        id: s.id,
        name: s.name,
        command: s.command,
        cwd: s.cwd ?? '.',
        port: s.port,
        network: s.network,
        healthUrl: s.healthUrl ?? null,
        autoStart: s.autoStart ?? false,
        order: s.order ?? 0,
        worktreeRoot: s.worktreeRoot ?? null,
        source: 'user',
      };
    }),
  };
  existingWs.devServersByPath = byPath;

  const merged = mergeConfigMeta(meta, { workspace: existingWs });
  if (merged.workspace && typeof merged.workspace === 'object') {
    /** @type {Record<string, unknown>} */ (merged.workspace).devServersByPath = byPath;
  }
  await writeConfigJson('config.json', merged);
}

/**
 * @param {string} workspaceRoot
 * @returns {Promise<DevServerDefinition[] | null>}
 */
async function readRawRegistry(workspaceRoot) {
  const key = registryKey(workspaceRoot);
  const meta = (await readConfigJson('config.json')) ?? {};
  const ws =
    meta.workspace && typeof meta.workspace === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.workspace)
      : null;
  const byPath =
    ws?.devServersByPath && typeof ws.devServersByPath === 'object'
      ? /** @type {Record<string, unknown>} */ (ws.devServersByPath)
      : null;
  const bucket = byPath?.[key];
  if (!bucket || typeof bucket !== 'object') return null;
  const list = /** @type {Record<string, unknown>} */ (bucket).servers;
  if (!Array.isArray(list)) return null;
  /** @type {DevServerDefinition[]} */
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const coerced = coerceDefinition(/** @type {Record<string, unknown>} */ (item));
    if (coerced) out.push(coerced);
  }
  return out;
}

/**
 * Apply startup.md live fields onto a registry entry linked to the file.
 * @param {DevServerDefinition} entry
 * @param {{ command: string, cwd?: string, healthUrl?: string, port?: number } | null} guide
 * @param {{ port: number, network: 'local' | 'lan' }} settings
 */
function hydrateStartupEntry(entry, guide, settings) {
  if (entry.source !== 'startup.md' || !guide) return entry;
  return {
    ...entry,
    command: guide.command,
    cwd: guide.cwd ?? entry.cwd ?? '.',
    healthUrl: guide.healthUrl ?? entry.healthUrl,
    port: entry.port || settings.port || guide.port || DEFAULT_PORT,
    network: entry.network || settings.network || DEFAULT_NETWORK,
  };
}

/**
 * Seed registry from startup.md when empty.
 * @param {string} [workspaceRoot]
 * @returns {Promise<DevServerDefinition[]>}
 */
export async function readDevServers(workspaceRoot = getWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const settings = await readDevServerSettings(root);
  const startup = await readStartupGuide(root);
  let raw = await readRawRegistry(root);

  if (raw == null || raw.length === 0) {
    if (startup.guide) {
      /** @type {DevServerDefinition} */
      const seeded = {
        id: PRIMARY_ID,
        name: 'primary',
        command: startup.guide.command,
        cwd: startup.guide.cwd ?? '.',
        port: settings.port ?? startup.guide.port ?? DEFAULT_PORT,
        network: settings.network ?? DEFAULT_NETWORK,
        healthUrl: startup.guide.healthUrl,
        autoStart: false,
        order: 0,
        source: 'startup.md',
      };
      await writeRegistry(root, [seeded]);
      raw = [seeded];
    } else {
      return [];
    }
  }

  const hydrated = raw
    .map((entry) => hydrateStartupEntry(entry, startup.guide, settings))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));

  return hydrated;
}

/**
 * @param {string} workspaceRoot
 * @param {string} id
 */
export async function getDevServerDefinition(workspaceRoot, id) {
  const list = await readDevServers(workspaceRoot);
  return list.find((s) => s.id === id) ?? null;
}

/**
 * @param {string} [workspaceRoot]
 * @param {Partial<DevServerDefinition> & { name: string, command: string }} input
 */
export async function createDevServer(workspaceRoot = getWorkspaceRoot(), input) {
  const root = path.resolve(workspaceRoot);
  const list = await readDevServers(root);
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : randomUUID();
  if (list.some((s) => s.id === id)) {
    throw new Error(`Dev server id already exists: ${id}`);
  }
  /** @type {DevServerDefinition} */
  const created = {
    id,
    name: String(input.name).trim() || 'server',
    command: String(input.command).trim(),
    cwd: typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : '.',
    port: coercePort(input.port) ?? DEFAULT_PORT,
    network: coerceNetwork(input.network),
    healthUrl: typeof input.healthUrl === 'string' ? input.healthUrl.trim() : undefined,
    autoStart: Boolean(input.autoStart),
    order: typeof input.order === 'number' ? input.order : list.length,
    worktreeRoot:
      typeof input.worktreeRoot === 'string' && input.worktreeRoot.trim()
        ? input.worktreeRoot.trim()
        : undefined,
    source: 'user',
  };
  if (!created.command) throw new Error('command is required');
  list.push(created);
  await writeRegistry(root, list);
  return created;
}

/**
 * @param {string} workspaceRoot
 * @param {string} id
 * @param {Partial<DevServerDefinition>} patch
 */
export async function updateDevServer(workspaceRoot, id, patch) {
  const root = path.resolve(workspaceRoot);
  const list = await readDevServers(root);
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`Dev server not found: ${id}`);
  const current = list[idx];

  if (current.source === 'startup.md') {
    list[idx] = {
      ...current,
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : current.name,
      port: patch.port != null ? coercePort(patch.port) ?? current.port : current.port,
      network: patch.network != null ? coerceNetwork(patch.network) : current.network,
      autoStart: typeof patch.autoStart === 'boolean' ? patch.autoStart : current.autoStart,
      order: typeof patch.order === 'number' ? patch.order : current.order,
      worktreeRoot:
        patch.worktreeRoot !== undefined
          ? typeof patch.worktreeRoot === 'string' && patch.worktreeRoot.trim()
            ? patch.worktreeRoot.trim()
            : undefined
          : current.worktreeRoot,
    };
  } else {
    list[idx] = {
      ...current,
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : current.name,
      command:
        typeof patch.command === 'string' && patch.command.trim()
          ? patch.command.trim()
          : current.command,
      cwd: typeof patch.cwd === 'string' && patch.cwd.trim() ? patch.cwd.trim() : current.cwd,
      port: patch.port != null ? coercePort(patch.port) ?? current.port : current.port,
      network: patch.network != null ? coerceNetwork(patch.network) : current.network,
      healthUrl:
        patch.healthUrl !== undefined
          ? typeof patch.healthUrl === 'string' && patch.healthUrl.trim()
            ? patch.healthUrl.trim()
            : undefined
          : current.healthUrl,
      autoStart: typeof patch.autoStart === 'boolean' ? patch.autoStart : current.autoStart,
      order: typeof patch.order === 'number' ? patch.order : current.order,
      worktreeRoot:
        patch.worktreeRoot !== undefined
          ? typeof patch.worktreeRoot === 'string' && patch.worktreeRoot.trim()
            ? patch.worktreeRoot.trim()
            : undefined
          : current.worktreeRoot,
    };
  }

  await writeRegistry(root, list);
  return list[idx];
}

/**
 * @param {string} workspaceRoot
 * @param {string} id
 */
export async function deleteDevServer(workspaceRoot, id) {
  const root = path.resolve(workspaceRoot);
  const list = await readDevServers(root);
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) throw new Error(`Dev server not found: ${id}`);
  await writeRegistry(root, next);
  return { ok: true, id };
}

/** Clear persisted registries between tests (caller clears config; this is a no-op marker). */
export function resetDevServerRegistryForTests() {
}

export { PRIMARY_ID as PRIMARY_DEV_SERVER_ID };
