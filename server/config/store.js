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
  validateIssuesState,
  validateIssuesTaxonomy,
  defaultIssuesTaxonomy,
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

/**
 * JSON blobs with many concurrent writers must be read/written under one queue per file.
 * config.json: dev-server + workspace settings; sessions/state.json: SPA autosave + terminal history.
 */
const SERIALIZED_CONFIG_KEYS = new Set(['config.json', 'sessions/state.json']);

/** @type {Map<string, Promise<void>>} */
const configJsonQueues = new Map();

/**
 * @param {string} relativeKey
 * @returns {Promise<void>}
 */
function getConfigJsonQueue(relativeKey) {
  let queue = configJsonQueues.get(relativeKey);
  if (!queue) {
    queue = Promise.resolve();
    configJsonQueues.set(relativeKey, queue);
  }
  return queue;
}

/**
 * @template T
 * @param {string} relativeKey
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withConfigJsonLock(relativeKey, fn) {
  const run = getConfigJsonQueue(relativeKey).then(fn, fn);
  configJsonQueues.set(
    relativeKey,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/**
 * Windows (and occasionally Unix AV/indexers) can briefly lock the destination during rename.
 * @param {string} src
 * @param {string} dest
 */
async function renameConfigAtomic(src, dest) {
  const maxAttempts = 6;
  const baseDelayMs = 25;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (retryable && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
        continue;
      }
      throw err;
    }
  }
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
  if (!SERIALIZED_CONFIG_KEYS.has(relativeKey)) {
    return readConfigJsonUnlocked(relativeKey);
  }
  return withConfigJsonLock(relativeKey, () => readConfigJsonUnlocked(relativeKey));
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
  await renameConfigAtomic(tmp, full);
  if (relativeKey === 'tools.json' || relativeKey === 'search.json') {
    await chmodSecretFile(full);
  }
}

/**
 * @param {string} relativeKey
 * @param {unknown} data
 */
export async function writeConfigJson(relativeKey, data) {
  if (!SERIALIZED_CONFIG_KEYS.has(relativeKey)) {
    return writeConfigJsonUnlocked(relativeKey, data);
  }
  return withConfigJsonLock(relativeKey, () => writeConfigJsonUnlocked(relativeKey, data));
}

/**
 * Read-modify-write under the per-file queue (required for sessions/state.json terminal history, etc.).
 * @template T
 * @param {string} relativeKey
 * @param {(current: unknown) => T | Promise<T>} mutator
 * @returns {Promise<T>}
 */
export async function updateConfigJson(relativeKey, mutator) {
  if (!SERIALIZED_CONFIG_KEYS.has(relativeKey)) {
    const current = await readConfigJsonUnlocked(relativeKey);
    const next = await mutator(current);
    await writeConfigJsonUnlocked(relativeKey, next);
    return next;
  }
  return withConfigJsonLock(relativeKey, async () => {
    const current = await readConfigJsonUnlocked(relativeKey);
    const next = await mutator(current);
    await writeConfigJsonUnlocked(relativeKey, next);
    return next;
  });
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
    if (!data?.gitCommitMessage) {
      patch.gitCommitMessage = DEFAULT_META.gitCommitMessage;
    }
    if (!data?.editorIntentMode) {
      patch.editorIntentMode = DEFAULT_META.editorIntentMode;
    }
    if (!data?.editorSettings) {
      patch.editorSettings = DEFAULT_META.editorSettings;
    }
    if (!data?.voice) {
      patch.voice = DEFAULT_META.voice;
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
  if (resource === 'issues') {
    // null when file missing — client migrates from bugs on first load.
    return readConfigJson(key);
  }
  if (resource === 'issues-taxonomy') {
    const data = await readConfigJson(key);
    return data ?? defaultIssuesTaxonomy();
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
    if (body && typeof body === 'object' && 'server' in /** @type {Record<string, unknown>} */ (body)) {
      const { setConfigNetworkAccess, resolveConfigNetworkAccess } = await import('../network/access.js');
      setConfigNetworkAccess(resolveConfigNetworkAccess(merged));
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
  if (resource === 'issues') {
    const validated = validateIssuesState(body);
    await writeConfigJson(key, validated);
    return validated;
  }
  if (resource === 'issues-taxonomy') {
    const issuesKey = resourceToRelativeKey('issues');
    const issuesRaw = issuesKey ? await readConfigJson(issuesKey) : null;
    const issuesState = validateIssuesState(issuesRaw);
    const previousRaw = await readConfigJson(key);
    const previous = previousRaw
      ? validateIssuesTaxonomy(previousRaw, { issues: issuesState.issues })
      : defaultIssuesTaxonomy();
    const validated = validateIssuesTaxonomy(body, {
      previous,
      issues: issuesState.issues,
    });
    await writeConfigJson(key, validated);
    return validated;
  }

  await writeConfigJson(key, body);
  return body;
}
