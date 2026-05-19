/**
 * Validate session, tool, and system-prompt payloads before writing to disk.
 */

import { ALL_TOOL_IDS } from './tool-ids.js';

const PLACEHOLDER_CHAT_NAME = 'New chat';
const MAX_CHATS = 50;

function newChatId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function ensureChatShape(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      id: newChatId(),
      name: PLACEHOLDER_CHAT_NAME,
      modelId: '',
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: Date.now(),
    };
  }

  const history = Array.isArray(raw.history)
    ? raw.history.filter((m) => m && typeof m === 'object' && m.role)
    : [];

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newChatId(),
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : PLACEHOLDER_CHAT_NAME,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : '',
    history,
    lastStats: raw.lastStats && typeof raw.lastStats === 'object' ? raw.lastStats : null,
    modelInfo: raw.modelInfo && typeof raw.modelInfo === 'object' ? raw.modelInfo : {},
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

function trimChatsIfNeeded(state) {
  if (!state.chats || state.chats.length <= MAX_CHATS) return;
  const activeId = state.activeId;
  const sortedOldestFirst = [...state.chats].sort((a, b) => a.updatedAt - b.updatedAt);
  let toDrop = state.chats.length - MAX_CHATS;
  for (const c of sortedOldestFirst) {
    if (toDrop <= 0) break;
    if (c.id === activeId) continue;
    state.chats = state.chats.filter((x) => x.id !== c.id);
    toDrop -= 1;
  }
}

/**
 * @param {unknown} raw
 * @returns {object}
 */
export function validateSessionState(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid session state');
  }

  const parsed = /** @type {Record<string, unknown>} */ (raw);
  if (parsed.version !== 1) {
    throw new Error('Invalid session version');
  }

  if (!Array.isArray(parsed.chats)) {
    throw new Error('Invalid session state');
  }

  const chats = parsed.chats.map(ensureChatShape).filter(Boolean);
  const state = {
    version: 1,
    activeId: typeof parsed.activeId === 'string' ? parsed.activeId : '',
    sidebarCollapsed: !!parsed.sidebarCollapsed,
    chats: chats.length ? chats : [ensureChatShape(null)],
  };

  if (!state.chats.some((c) => c.id === state.activeId)) {
    state.activeId = state.chats[0].id;
  }

  trimChatsIfNeeded(state);

  if (!state.chats.length) {
    throw new Error('Session must have at least one chat');
  }

  return state;
}

/**
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeToolConfig(raw) {
  const enabled = {};
  for (const id of ALL_TOOL_IDS) {
    enabled[id] = ['get_datetime', 'calculate', 'web_search', 'wikipedia_search'].includes(id);
  }

  const config = { enabled, keys: { braveApiKey: '' } };

  if (!raw || typeof raw !== 'object') return config;

  const stored = /** @type {Record<string, unknown>} */ (raw);
  if (stored.enabled && typeof stored.enabled === 'object') {
    const enabledMap = /** @type {Record<string, unknown>} */ (stored.enabled);
    for (const id of ALL_TOOL_IDS) {
      if (typeof enabledMap[id] === 'boolean') {
        config.enabled[id] = enabledMap[id];
      }
    }
  }

  if (stored.keys && typeof stored.keys === 'object') {
    const keysMap = /** @type {Record<string, unknown>} */ (stored.keys);
    if (typeof keysMap.braveApiKey === 'string') {
      config.keys.braveApiKey = keysMap.braveApiKey;
    }
  }

  return config;
}

/**
 * @param {unknown} raw
 * @returns {{ presetId: string, text: string }}
 */
export function validateSystemPromptSettings(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid system prompt settings');
  }

  const parsed = /** @type {Record<string, unknown>} */ (raw);
  return {
    presetId: typeof parsed.presetId === 'string' ? parsed.presetId : '',
    text: typeof parsed.text === 'string' ? parsed.text : '',
  };
}

/**
 * Merge allowed fields into config.json meta.
 * @param {object} existing
 * @param {unknown} patch
 * @returns {object}
 */
export function mergeConfigMeta(existing, patch) {
  const base =
    existing && typeof existing === 'object'
      ? { ...existing }
      : {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          migratedFromLocalStorage: false,
          migratedAt: null,
          localStorageKeysMigrated: [],
          layoutVersion: 1,
        };

  if (!patch || typeof patch !== 'object') return base;

  const p = /** @type {Record<string, unknown>} */ (patch);

  if (typeof p.migratedFromLocalStorage === 'boolean') {
    base.migratedFromLocalStorage = p.migratedFromLocalStorage;
  }
  if (p.migratedAt === null || typeof p.migratedAt === 'string') {
    base.migratedAt = p.migratedAt;
  }
  if (Array.isArray(p.localStorageKeysMigrated)) {
    base.localStorageKeysMigrated = p.localStorageKeysMigrated.filter(
      (k) => typeof k === 'string',
    );
  }
  if (typeof p.layoutVersion === 'number') {
    base.layoutVersion = p.layoutVersion;
  }
  if (typeof p.schemaVersion === 'number') {
    base.schemaVersion = p.schemaVersion;
  }

  return base;
}
