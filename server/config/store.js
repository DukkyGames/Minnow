/**
 * Read/write JSON config files under ~/.speedchat with atomic writes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveConfigPath, resourceToRelativeKey } from './paths.js';
import { ensureSpeedChatLayout } from './home.js';
import {
  mergeConfigMeta,
  normalizeToolConfig,
  normalizeSkillConfig,
  normalizeSubAgentsConfig,
  validateSessionState,
  validateSystemPromptSettings,
} from './validators.js';
import {
  DEFAULT_META,
  defaultSessionStateJson,
  defaultToolsJson,
  defaultSkillsJson,
  DEFAULT_SYSTEM_PROMPT,
} from './home.js';

/** Best-effort chmod for secret-bearing files on Unix. */
async function chmodSecretFile(filePath) {
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} relativeKey
 * @returns {Promise<boolean>}
 */
export async function configFileExists(relativeKey) {
  const full = resolveConfigPath(relativeKey);
  try {
    await fs.access(full);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} relativeKey
 * @returns {Promise<unknown>}
 */
export async function readConfigJson(relativeKey) {
  await ensureSpeedChatLayout();
  const full = resolveConfigPath(relativeKey);
  try {
    const raw = await fs.readFile(full, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Atomic write: temp file in same directory then rename.
 * @param {string} relativeKey
 * @param {unknown} data
 */
export async function writeConfigJson(relativeKey, data) {
  await ensureSpeedChatLayout();
  const full = resolveConfigPath(relativeKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, full);
  if (relativeKey === 'tools.json') {
    await chmodSecretFile(full);
  }
}

/**
 * @param {string} resource
 * @returns {Promise<unknown>}
 */
export async function readResource(resource) {
  const key = resourceToRelativeKey(resource);
  if (!key) throw new Error('Unknown resource');

  if (resource === 'sessions') {
    const data = await readConfigJson(key);
    return data ?? defaultSessionStateJson();
  }
  if (resource === 'tools') {
    const data = await readConfigJson(key);
    return data ?? defaultToolsJson();
  }
  if (resource === 'skills') {
    const data = await readConfigJson(key);
    return data ?? defaultSkillsJson();
  }
  if (resource === 'system-prompt') {
    const data = await readConfigJson(key);
    return data ?? DEFAULT_SYSTEM_PROMPT;
  }
  if (resource === 'meta') {
    let data = await readConfigJson(key);
    if (!data) {
      await ensureSpeedChatLayout();
      data = await readConfigJson(key);
    }
    if (!data?.uiDesigner) {
      return mergeConfigMeta(data ?? {}, { uiDesigner: DEFAULT_META.uiDesigner });
    }
    return data;
  }
  if (resource === 'sub-agents') {
    const data = await readConfigJson(key);
    return data ?? { version: 1, enabled: true, globalMaxConcurrent: 3, defaultTimeoutMs: 300000, types: {} };
  }

  return readConfigJson(key);
}

/**
 * @param {string} resource
 * @param {unknown} body
 */
export async function writeResource(resource, body) {
  const key = resourceToRelativeKey(resource);
  if (!key) throw new Error('Unknown resource');

  if (resource === 'sessions') {
    const validated = validateSessionState(body);
    await writeConfigJson(key, validated);
    return validated;
  }
  if (resource === 'tools') {
    const normalized = normalizeToolConfig(body);
    await writeConfigJson(key, normalized);
    return normalized;
  }
  if (resource === 'skills') {
    const normalized = normalizeSkillConfig(body);
    await writeConfigJson(key, normalized);
    return normalized;
  }
  if (resource === 'system-prompt') {
    const validated = validateSystemPromptSettings(body);
    await writeConfigJson(key, validated);
    return validated;
  }
  if (resource === 'meta') {
    const existing = (await readConfigJson(key)) ?? {};
    const merged = mergeConfigMeta(existing, body);
    await writeConfigJson(key, merged);
    return merged;
  }
  if (resource === 'sub-agents') {
    const { config } = normalizeSubAgentsConfig(body);
    await writeConfigJson(key, config);
    return config;
  }

  await writeConfigJson(key, body);
  return body;
}
