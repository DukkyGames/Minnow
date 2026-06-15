/**
 * Read/write JSON config files under ~/.minnow with atomic writes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveConfigPath, resourceToRelativeKey } from './paths.js';
import { ensureMinnowLayout } from './home.js';
import {
  mergeConfigMeta,
  normalizeToolConfig,
  normalizeSearchConfig,
  normalizeServersConfig,
  normalizeResearchConfig,
  seedSearchConfigFromTools,
  defaultSearchConfig,
  defaultServersConfig,
  defaultResearchConfig,
  normalizeSkillConfig,
  normalizeSubAgentsConfig,
  validateSessionState,
  validateSystemPromptSettings,
  validateUserRulesSettings,
  validateBugsState,
} from './validators.js';
import {
  DEFAULT_META,
  defaultSessionStateJson,
  defaultToolsJson,
  defaultSkillsJson,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_RULES,
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

/** Serialize config.json updates so parallel dev-server settings + run-state writes do not clobber each other. */
let configJsonQueue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withConfigJsonLock(fn) {
  const run = configJsonQueue.then(fn, fn);
  configJsonQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * @param {string} relativeKey
 * @returns {Promise<unknown>}
 */
async function readConfigJsonUnlocked(relativeKey) {
  await ensureMinnowLayout();
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
 * @param {string} relativeKey
 * @returns {Promise<unknown>}
 */
export async function readConfigJson(relativeKey) {
  if (relativeKey !== 'config.json') {
    return readConfigJsonUnlocked(relativeKey);
  }
  return withConfigJsonLock(() => readConfigJsonUnlocked(relativeKey));
}

/**
 * Atomic write: temp file in same directory then rename.
 * @param {string} relativeKey
 * @param {unknown} data
 */
async function writeConfigJsonUnlocked(relativeKey, data) {
  await ensureMinnowLayout();
  const full = resolveConfigPath(relativeKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, full);
  if (relativeKey === 'tools.json' || relativeKey === 'search.json') {
    await chmodSecretFile(full);
  }
}

/**
 * @param {string} relativeKey
 * @param {unknown} data
 */
export async function writeConfigJson(relativeKey, data) {
  if (relativeKey !== 'config.json') {
    return writeConfigJsonUnlocked(relativeKey, data);
  }
  return withConfigJsonLock(() => writeConfigJsonUnlocked(relativeKey, data));
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
  if (resource === 'search') {
    let data = await readConfigJson(key);
    if (data === null) {
      const toolsRaw = (await readConfigJson('tools.json')) ?? defaultToolsJson();
      const tools = normalizeToolConfig(toolsRaw);
      const seeded = seedSearchConfigFromTools(tools);
      await writeConfigJson(key, seeded);
      data = seeded;
    }
    return normalizeSearchConfig(data);
  }
  if (resource === 'servers') {
    const data = await readConfigJson(key);
    return normalizeServersConfig(data);
  }
  if (resource === 'research') {
    const data = await readConfigJson(key);
    return data ?? defaultResearchConfig();
  }
  if (resource === 'skills') {
    const data = await readConfigJson(key);
    return data ?? defaultSkillsJson();
  }
  if (resource === 'system-prompt') {
    const data = await readConfigJson(key);
    return data ?? DEFAULT_SYSTEM_PROMPT;
  }
  if (resource === 'rules') {
    const data = await readConfigJson(key);
    return data ?? DEFAULT_RULES;
  }
  if (resource === 'meta') {
    let data = await readConfigJson(key);
    if (!data) {
      await ensureMinnowLayout();
      data = await readConfigJson(key);
    }
    const patch = {};
    if (!data?.uiDesigner) {
      patch.uiDesigner = DEFAULT_META.uiDesigner;
    }
    if (!data?.titles) {
      patch.titles = DEFAULT_META.titles;
    }
    if (!data?.sampler) {
      patch.sampler = DEFAULT_META.sampler;
    }
    if (!data?.thinking) {
      patch.thinking = DEFAULT_META.thinking;
    }
    if (!data?.chat) {
      patch.chat = DEFAULT_META.chat;
    }
    if (!data?.browser) {
      patch.browser = DEFAULT_META.browser;
    }
    if (!data?.editorAiCompletion) {
      patch.editorAiCompletion = DEFAULT_META.editorAiCompletion;
    }
    if (!data?.editorSettings) {
      patch.editorSettings = DEFAULT_META.editorSettings;
    }
    if (!data?.voice) {
      patch.voice = DEFAULT_META.voice;
    }
    if (!data?.images) {
      patch.images = DEFAULT_META.images;
    }
    if (Object.keys(patch).length > 0) {
      return mergeConfigMeta(data ?? {}, patch);
    }
    return data;
  }
  if (resource === 'sub-agents') {
    const data = await readConfigJson(key);
    return data ?? { version: 1, enabled: true, globalMaxConcurrent: 3, defaultTimeoutMs: 300000, types: {} };
  }
  if (resource === 'bugs') {
    const data = await readConfigJson(key);
    return data ?? { version: 1, bugs: [] };
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
  if (resource === 'search') {
    const normalized = normalizeSearchConfig(body);
    await writeConfigJson(key, normalized);
    return normalized;
  }
  if (resource === 'servers') {
    const normalized = normalizeServersConfig(body);
    await writeConfigJson(key, normalized);
    return normalized;
  }
  if (resource === 'research') {
    const normalized = normalizeResearchConfig(body);
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
  if (resource === 'rules') {
    const validated = validateUserRulesSettings(body);
    await writeConfigJson(key, validated);
    return validated;
  }
  if (resource === 'meta') {
    const existing = (await readConfigJson(key)) ?? {};
    const merged = mergeConfigMeta(existing, body);
    await writeConfigJson(key, merged);
    if (body && typeof body === 'object' && 'browser' in /** @type {Record<string, unknown>} */ (body)) {
      const { resetBrowserConfigCache } = await import('../cdp/browser-config.js');
      resetBrowserConfigCache();
    }
    return merged;
  }
  if (resource === 'sub-agents') {
    const { config } = normalizeSubAgentsConfig(body);
    await writeConfigJson(key, config);
    return config;
  }
  if (resource === 'bugs') {
    const validated = validateBugsState(body);
    await writeConfigJson(key, validated);
    return validated;
  }

  await writeConfigJson(key, body);
  return body;
}
