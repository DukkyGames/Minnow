/**
 * CRUD for ~/.speedchat/prompt-configs/*.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureSpeedChatLayout, getSpeedChatHome } from '../config/home.js';
import { readConfigJson, writeConfigJson } from '../config/store.js';
import { validatePromptConfig } from './validate.js';

function configsDir() {
  return path.join(getSpeedChatHome(), 'prompt-configs');
}

function configPath(id) {
  return path.join(configsDir(), `${id}.json`);
}

/**
 * @returns {Promise<Array<{ id: string, label: string }>>}
 */
export async function listPromptConfigs() {
  await ensureSpeedChatLayout();
  const dir = configsDir();
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const configs = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    try {
      const raw = await fs.readFile(path.join(dir, name), 'utf8');
      const parsed = JSON.parse(raw);
      configs.push({
        id: parsed.id ?? id,
        label: typeof parsed.label === 'string' ? parsed.label : id,
      });
    } catch {
      configs.push({ id, label: id });
    }
  }
  configs.sort((a, b) => a.label.localeCompare(b.label));
  return configs;
}

/**
 * @param {string} id
 */
export async function loadPromptConfigFile(id) {
  await ensureSpeedChatLayout();
  try {
    const raw = await fs.readFile(configPath(id), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * @param {object} config
 */
export async function savePromptConfigFile(config) {
  const validated = validatePromptConfig(config);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  await ensureSpeedChatLayout();
  const id = validated.config.id;
  const now = new Date().toISOString();
  const existing = (await loadPromptConfigFile(id)) ?? {};
  const toWrite = {
    ...validated.config,
    meta: {
      createdAt: existing.meta?.createdAt ?? now,
      updatedAt: now,
    },
  };

  const full = configPath(id);
  const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(toWrite, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, full);
  return toWrite;
}

/**
 * @param {string} id
 */
export async function deletePromptConfigFile(id) {
  const meta = (await readConfigJson('config.json')) ?? {};
  if (meta.activePromptConfigId === id) {
    throw new Error('Cannot delete the active prompt configuration');
  }
  try {
    await fs.unlink(configPath(id));
    return true;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * @param {string} id
 * @param {string} newId
 * @param {string} [newLabel]
 */
export async function duplicatePromptConfigFile(id, newId, newLabel) {
  const source = await loadPromptConfigFile(id);
  if (!source) {
    throw new Error('Source configuration not found');
  }
  const copy = {
    ...source,
    id: newId,
    label: newLabel ?? `${source.label} (copy)`,
    profile: 'custom',
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  return savePromptConfigFile(copy);
}

/**
 * @param {string} id
 */
export async function isActivePromptConfig(id) {
  const meta = (await readConfigJson('config.json')) ?? {};
  return meta.activePromptConfigId === id;
}
