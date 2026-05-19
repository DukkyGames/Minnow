/**
 * Validate session, tool, and system-prompt payloads before writing to disk.
 */

import { ALL_TOOL_IDS } from './tool-ids.js';

const PLACEHOLDER_CHAT_NAME = 'New chat';
const MAX_CHATS = 50;

/** Valid operating mode ids (mirror src/chat/modes/types.ts). */
const MODE_IDS = ['build', 'plan', 'orchestrate', 'research'];
const DEFAULT_MODE_ID = 'build';

/** Normalize persisted or unknown mode ids. */
function normalizeModeId(value) {
  if (typeof value === 'string' && MODE_IDS.includes(value)) return value;
  return DEFAULT_MODE_ID;
}

/** Default expert picker when missing on older chats. */
function defaultExpertSelection() {
  return { mode: 'auto', expertId: null };
}

/** Coerce expert picker shape (mirror src/state/sessions.ts). */
function ensureExpertSelection(raw) {
  if (!raw || typeof raw !== 'object') return defaultExpertSelection();
  const row = /** @type {Record<string, unknown>} */ (raw);
  const mode = row.mode === 'manual' ? 'manual' : 'auto';
  const expertId =
    mode === 'manual' && typeof row.expertId === 'string' && row.expertId.trim()
      ? row.expertId.trim()
      : null;
  return { mode, expertId };
}

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
      modeId: DEFAULT_MODE_ID,
      expertSelection: defaultExpertSelection(),
      lastResolvedExpertId: null,
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: Date.now(),
    };
  }

  const row = /** @type {Record<string, unknown>} */ (raw);
  const history = Array.isArray(row.history)
    ? row.history.filter((m) => m && typeof m === 'object' && m.role)
    : [];

  const terminalHistory = Array.isArray(row.terminalHistory)
    ? row.terminalHistory.filter((r) => r && typeof r === 'object')
    : undefined;

  return {
    id: typeof row.id === 'string' && row.id ? row.id : newChatId(),
    name:
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : PLACEHOLDER_CHAT_NAME,
    modelId: typeof row.modelId === 'string' ? row.modelId : '',
    modeId: normalizeModeId(
      typeof row.modeId === 'string' ? row.modeId : undefined,
    ),
    expertSelection: ensureExpertSelection(row.expertSelection),
    lastResolvedExpertId:
      typeof row.lastResolvedExpertId === 'string' ? row.lastResolvedExpertId : null,
    ...(terminalHistory?.length ? { terminalHistory } : {}),
    history,
    lastStats: row.lastStats && typeof row.lastStats === 'object' ? row.lastStats : null,
    modelInfo: row.modelInfo && typeof row.modelInfo === 'object' ? row.modelInfo : {},
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
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

  if (p.titles && typeof p.titles === 'object') {
    const existingTitles =
      base.titles && typeof base.titles === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.titles) }
        : {
            enabled: true,
            modelId: '',
            providerId: '',
            maxTokens: 24,
            temperature: 0.3,
          };
    const t = /** @type {Record<string, unknown>} */ (p.titles);
    if (typeof t.enabled === 'boolean') existingTitles.enabled = t.enabled;
    if (typeof t.modelId === 'string') existingTitles.modelId = t.modelId;
    if (typeof t.providerId === 'string') existingTitles.providerId = t.providerId;
    if (typeof t.maxTokens === 'number' && Number.isFinite(t.maxTokens)) {
      existingTitles.maxTokens = Math.min(32, Math.max(16, Math.round(t.maxTokens)));
    }
    if (typeof t.temperature === 'number' && Number.isFinite(t.temperature)) {
      existingTitles.temperature = Math.min(0.4, Math.max(0.2, t.temperature));
    }
    base.titles = existingTitles;
  }

  if (p.terminal && typeof p.terminal === 'object') {
    const existingTerminal =
      base.terminal && typeof base.terminal === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.terminal) }
        : {
            open: false,
            heightPx: 240,
            autoOpenOnAgentRun: true,
          };
    const t = /** @type {Record<string, unknown>} */ (p.terminal);
    if (typeof t.open === 'boolean') existingTerminal.open = t.open;
    if (typeof t.heightPx === 'number' && Number.isFinite(t.heightPx)) {
      existingTerminal.heightPx = Math.min(800, Math.max(120, Math.round(t.heightPx)));
    }
    if (typeof t.autoOpenOnAgentRun === 'boolean') {
      existingTerminal.autoOpenOnAgentRun = t.autoOpenOnAgentRun;
    }
    base.terminal = existingTerminal;
  }

  if (p.filePanel && typeof p.filePanel === 'object') {
    const existingPanel =
      base.filePanel && typeof base.filePanel === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.filePanel) }
        : {
            fileSidebarCollapsed: false,
            viewerOpen: false,
            splitRatio: 0.55,
            expandedDirs: [],
            selectedPath: null,
            treeRoot: '.',
          };
    const fp = /** @type {Record<string, unknown>} */ (p.filePanel);
    if (typeof fp.fileSidebarCollapsed === 'boolean') {
      existingPanel.fileSidebarCollapsed = fp.fileSidebarCollapsed;
    }
    if (typeof fp.viewerOpen === 'boolean') {
      existingPanel.viewerOpen = fp.viewerOpen;
    }
    if (typeof fp.splitRatio === 'number' && Number.isFinite(fp.splitRatio)) {
      existingPanel.splitRatio = Math.min(0.75, Math.max(0.35, fp.splitRatio));
    }
    if (Array.isArray(fp.expandedDirs)) {
      existingPanel.expandedDirs = fp.expandedDirs.filter((d) => typeof d === 'string');
    }
    if (fp.selectedPath === null || typeof fp.selectedPath === 'string') {
      existingPanel.selectedPath = fp.selectedPath;
    }
    if (typeof fp.treeRoot === 'string' && fp.treeRoot.trim()) {
      existingPanel.treeRoot = fp.treeRoot;
    }
    base.filePanel = existingPanel;
  }

  if (p.uiDesigner && typeof p.uiDesigner === 'object') {
    const existingUi =
      base.uiDesigner && typeof base.uiDesigner === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.uiDesigner) }
        : {
            providerId: '',
            modelId: '',
            fallbackToChatModel: true,
          };
    const u = /** @type {Record<string, unknown>} */ (p.uiDesigner);
    if (typeof u.providerId === 'string') existingUi.providerId = u.providerId;
    if (typeof u.modelId === 'string') existingUi.modelId = u.modelId;
    if (typeof u.fallbackToChatModel === 'boolean') {
      existingUi.fallbackToChatModel = u.fallbackToChatModel;
    }
    base.uiDesigner = existingUi;
  }

  return base;
}

const DEFAULT_SUB_AGENTS = {
  version: 1,
  enabled: true,
  globalMaxConcurrent: 3,
  defaultTimeoutMs: 300000,
  types: {},
};

/**
 * Normalize sub-agents.json user overrides (warn on unknown tool ids).
 * @param {unknown} body
 * @returns {{ config: object, warnings: string[] }}
 */
export function normalizeSubAgentsConfig(body) {
  const warnings = [];
  const base =
    body && typeof body === 'object'
      ? { ...DEFAULT_SUB_AGENTS, .../** @type {Record<string, unknown>} */ (body) }
      : { ...DEFAULT_SUB_AGENTS };

  if (typeof base.enabled !== 'boolean') base.enabled = true;
  if (typeof base.globalMaxConcurrent !== 'number' || base.globalMaxConcurrent < 1) {
    base.globalMaxConcurrent = 3;
  }
  if (typeof base.defaultTimeoutMs !== 'number' || base.defaultTimeoutMs < 1000) {
    base.defaultTimeoutMs = 300000;
  }
  if (typeof base.version !== 'number') base.version = 1;

  if (!base.types || typeof base.types !== 'object') {
    base.types = {};
  }

  const types = /** @type {Record<string, unknown>} */ (base.types);
  for (const [typeId, rawType] of Object.entries(types)) {
    if (!rawType || typeof rawType !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (rawType);

    const checkToolList = (key) => {
      const list = row[key];
      if (!Array.isArray(list)) return;
      for (const name of list) {
        if (typeof name !== 'string') continue;
        if (!ALL_TOOL_IDS.includes(name)) {
          warnings.push(`Unknown tool id "${name}" in types.${typeId}.${key}`);
        }
      }
    };

    checkToolList('allowedTools');
    checkToolList('deniedTools');
  }

  return { config: base, warnings };
}
