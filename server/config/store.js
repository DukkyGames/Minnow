/**
 * Read/write JSON config files under ~/.minnow with atomic writes.
 * Sessions resource uses SQLite (sessions-repo) unless MINNOW_SESSIONS_STORE=json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveConfigPath, resourceToRelativeKey } from './paths.js';
import { ensureMinnowLayout } from './home.js';
import {
  mergeConfigMeta,
  migrateChatRowV5ToV6,
  normalizeChatRow,
  normalizeGroupRow,
  normalizeSessionScalars,
  normalizeToolConfig,
  normalizeSearchConfig,
  normalizeServersConfig,
  normalizeResearchConfig,
  seedSearchConfigFromTools,
  defaultResearchConfig,
  normalizeSkillConfig,
  normalizeSubAgentsConfig,
  SESSION_SCHEMA_VERSION,
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
import {
  patchSessionState,
  readWholeSessionState,
  useJsonSessionsStore,
  writeWholeSessionState,
} from './sessions-repo.js';
import { sessionsJsonPath } from './sessions-paths.js';
import { notifySessionStateWritten } from '../session/publish.js';
import { getSessionRev } from '../session/rev-store.js';

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
  // Sessions JSON key is no longer on the allowlist — resolve via sessions-paths.
  if (relativeKey === 'sessions/state.json') {
    try {
      await fs.access(sessionsJsonPath());
      return true;
    } catch {
      return false;
    }
  }
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
 * config.json: dev-server + workspace settings.
 * sessions/state.json mutex removed in A.2 (SQLite locking); kept only for JSON rollback.
 */
const SERIALIZED_CONFIG_KEYS = new Set(['config.json']);

/** @type {Map<string, Promise<void>>} */
const configJsonQueues = new Map();

/** Separate mutex for MINNOW_SESSIONS_STORE=json rollback path. */
/** @type {Promise<void>} */
let sessionsJsonQueue = Promise.resolve();

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
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withSessionsJsonLock(fn) {
  const run = sessionsJsonQueue.then(fn, fn);
  sessionsJsonQueue = run.then(
    () => undefined,
    () => undefined,
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
 * Kept reachable for JSON-mode sessions rollback and generic config reads.
 * @param {string} relativeKey
 * @returns {Promise<unknown>}
 */
async function readConfigJsonUnlocked(relativeKey) {
  await ensureMinnowLayout();
  // Sessions bypass the allowlist (removed in A.2).
  if (relativeKey === 'sessions/state.json') {
    try {
      const raw = await fs.readFile(sessionsJsonPath(), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }
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
  if (relativeKey === 'sessions/state.json' && useJsonSessionsStore()) {
    return withSessionsJsonLock(() => readConfigJsonUnlocked(relativeKey));
  }
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
  const full =
    relativeKey === 'sessions/state.json'
      ? sessionsJsonPath()
      : resolveConfigPath(relativeKey);
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
  if (relativeKey === 'sessions/state.json' && useJsonSessionsStore()) {
    return withSessionsJsonLock(() => writeConfigJsonUnlocked(relativeKey, data));
  }
  if (!SERIALIZED_CONFIG_KEYS.has(relativeKey)) {
    return writeConfigJsonUnlocked(relativeKey, data);
  }
  return withConfigJsonLock(relativeKey, () => writeConfigJsonUnlocked(relativeKey, data));
}

/**
 * Read-modify-write under the per-file queue (required for config.json, JSON sessions rollback).
 * @template T
 * @param {string} relativeKey
 * @param {(current: unknown) => T | Promise<T>} mutator
 * @returns {Promise<T>}
 */
export async function updateConfigJson(relativeKey, mutator) {
  if (relativeKey === 'sessions/state.json' && useJsonSessionsStore()) {
    return withSessionsJsonLock(async () => {
      const current = await readConfigJsonUnlocked(relativeKey);
      const next = await mutator(current);
      await writeConfigJsonUnlocked(relativeKey, next);
      return next;
    });
  }
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
    if (useJsonSessionsStore()) {
      const data = await readConfigJson(key);
      return data ?? defaultSessionStateJson();
    }
    await ensureMinnowLayout();
    return readWholeSessionState();
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
    if (useJsonSessionsStore()) {
      await writeConfigJson(key, validated);
      // Phase 0: bump rev + fan out SSE after every sessions write (JSON path).
      notifySessionStateWritten(validated);
      return validated;
    }
    await ensureMinnowLayout();
    const rawChats =
      body && typeof body === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (body).chats)
        ? /** @type {Record<string, unknown>} */ (body).chats
        : undefined;
    writeWholeSessionState(validated, { rawChats });
    // Phase 0: SQLite PUT also publishes so multi-device clients stay in sync.
    notifySessionStateWritten(validated);
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

/**
 * Apply a partial sessions delta (PATCH /api/config/sessions).
 * SQLite path uses {@link patchSessionState}; JSON fallback does in-memory splice.
 * After a successful patch, bumps Phase 0 session rev and fans out SSE (full state).
 *
 * @param {string} resource
 * @param {unknown} body
 * @returns {Promise<{ ok: true, applied: Record<string, unknown>, rev: number }>}
 */
export async function patchResource(resource, body) {
  if (resource !== 'sessions') {
    const err = new Error('PATCH is only supported for sessions');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 405;
    throw err;
  }

  let result;
  if (useJsonSessionsStore()) {
    result = await patchJsonSessionState(body);
  } else {
    await ensureMinnowLayout();
    result = patchSessionState(body);
  }

  // PATCH returns a delta ack — re-read the authoritative blob for SSE subscribers.
  const state = useJsonSessionsStore()
    ? ((await readConfigJson('sessions/state.json')) ?? defaultSessionStateJson())
    : readWholeSessionState();
  const rev = notifySessionStateWritten(state);
  return { ...result, rev: rev || getSessionRev() };
}

/**
 * JSON-store fallback for PATCH — read whole blob, apply delta, rewrite.
 * Same semantics as {@link patchSessionState} (absent keys unchanged; explicit deletes).
 * @param {unknown} delta
 */
async function patchJsonSessionState(delta) {
  if (!delta || typeof delta !== 'object') {
    const err = new Error('Invalid session patch');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
    throw err;
  }

  const body = /** @type {Record<string, unknown>} */ (delta);
  const baseVersion = body.baseVersion;
  if (
    baseVersion !== undefined &&
    baseVersion !== 1 &&
    baseVersion !== 2 &&
    baseVersion !== 3 &&
    baseVersion !== 4 &&
    baseVersion !== 5 &&
    baseVersion !== 6
  ) {
    const err = new Error('Invalid session baseVersion');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
    throw err;
  }

  const applied = {
    chats: 0,
    deletedChats: 0,
    groups: 0,
    deletedGroups: 0,
    scalars: false,
  };

  const current = validateSessionState(
    (await readConfigJson('sessions/state.json')) ?? defaultSessionStateJson(),
  );

  const deleteChatIds = new Set(
    Array.isArray(body.deleteChatIds)
      ? body.deleteChatIds.filter((id) => typeof id === 'string' && id.trim())
      : [],
  );
  const deleteGroupIds = new Set(
    Array.isArray(body.deleteGroupIds)
      ? body.deleteGroupIds.filter((id) => typeof id === 'string' && id.trim())
      : [],
  );

  let chats = current.chats.filter((c) => {
    if (deleteChatIds.has(c.id)) {
      applied.deletedChats += 1;
      return false;
    }
    return true;
  });

  let groups = (current.groups ?? []).filter((g) => {
    if (deleteGroupIds.has(g.id)) {
      applied.deletedGroups += 1;
      return false;
    }
    return true;
  });

  if (Array.isArray(body.chats)) {
    for (const raw of body.chats) {
      if (!raw || typeof raw !== 'object') continue;
      const chat = normalizeChatRow(raw);
      migrateChatRowV5ToV6(chat);
      // Preserve server-owned terminalHistory when the client omits/replaces it.
      const existing = chats.find((c) => c.id === chat.id);
      if (existing?.terminalHistory?.length && !chat.terminalHistory?.length) {
        chat.terminalHistory = existing.terminalHistory;
      } else if (existing?.terminalHistory?.length) {
        // Client may send terminalHistory; ignore it (server-owned).
        chat.terminalHistory = existing.terminalHistory;
      } else {
        delete chat.terminalHistory;
      }
      const idx = chats.findIndex((c) => c.id === chat.id);
      if (idx >= 0) chats[idx] = chat;
      else chats.push(chat);
      applied.chats += 1;
    }
  }

  if (Array.isArray(body.groups)) {
    for (const raw of body.groups) {
      const group = normalizeGroupRow(raw);
      if (!group?.id) continue;
      const idx = groups.findIndex((g) => g.id === group.id);
      if (idx >= 0) groups[idx] = group;
      else groups.push(group);
      applied.groups += 1;
    }
  }

  /** @type {Record<string, unknown>} */
  let next = {
    ...current,
    version: SESSION_SCHEMA_VERSION,
    chats,
    groups,
  };

  if (body.scalars && typeof body.scalars === 'object') {
    const scalars = normalizeSessionScalars(body.scalars, { mode: 'partial' });
    for (const [key, value] of Object.entries(scalars)) {
      if (value === null && (key === 'sidebarWidth' || key === 'activeBoardGroupId' || key === 'codeChangeTotalsByWorkspace')) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    applied.scalars = Object.keys(scalars).length > 0;
  }

  if (!next.chats.length) {
    const err = new Error('Session must have at least one chat');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
    throw err;
  }
  if (!next.chats.some((c) => c.id === next.activeId)) {
    next.activeId = next.chats[0].id;
  }

  const validated = validateSessionState(next);
  await writeConfigJson('sessions/state.json', validated);
  return { ok: true, applied };
}
