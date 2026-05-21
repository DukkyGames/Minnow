/**
 * Validate session, tool, and system-prompt payloads before writing to disk.
 */

import { ALL_TOOL_IDS } from './tool-ids.js';
import { normalizeOrchestratePlanPath } from './orchestrate-plan-path.js';

const PLACEHOLDER_CHAT_NAME = 'New chat';
const MAX_CHATS = 50;
const SESSION_SCHEMA_VERSION = 2;

/** Normalize workspace paths for stable keys (mirror src/lib/normalize-workspace-path.ts). */
function normalizeWorkspacePath(fsPath) {
  if (typeof fsPath !== 'string') return '';
  let p = fsPath.trim().replace(/\\/g, '/');
  p = p.replace(/\/+/g, '/');
  if (/^[a-zA-Z]:\//.test(p)) {
    p = p.charAt(0).toUpperCase() + p.slice(1);
  }
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

function ensureLastActiveMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string' && typeof value === 'string' && value.trim()) {
      out[normalizeWorkspacePath(key)] = value.trim();
    }
  }
  return out;
}

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

/** Validate in-flight assistant checkpoint (mirror src/state/pending-turn.ts). */
function ensurePendingTurn(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = /** @type {Record<string, unknown>} */ (raw);
  if (row.role !== 'assistant') return undefined;
  const startedAt = row.startedAt;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
    return undefined;
  }
  const content = typeof row.content === 'string' ? row.content : '';
  const out = { role: 'assistant', content, startedAt };
  if (Array.isArray(row.thinking)) {
    const thinking = row.thinking
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => String(s).trim());
    if (thinking.length) out.thinking = thinking;
  }
  if (Array.isArray(row.toolCalls)) {
    const toolCalls = row.toolCalls.filter(
      (tc) =>
        tc &&
        typeof tc === 'object' &&
        typeof tc.id === 'string' &&
        tc.function &&
        typeof tc.function.name === 'string',
    );
    if (toolCalls.length) out.toolCalls = toolCalls;
  }
  if (typeof row.modelId === 'string' && row.modelId) out.modelId = row.modelId;
  if (typeof row.providerId === 'string' && row.providerId) {
    out.providerId = row.providerId;
  }
  if (
    row.phase === 'streaming' ||
    row.phase === 'tools' ||
    row.phase === 'thinking'
  ) {
    out.phase = row.phase;
  }
  if (typeof row.toolRound === 'number' && Number.isInteger(row.toolRound) && row.toolRound >= 0) {
    out.toolRound = row.toolRound;
  }
  if (row.stopped === true) out.stopped = true;
  if (
    typeof row.thinkingDurationMs === 'number' &&
    Number.isFinite(row.thinkingDurationMs) &&
    row.thinkingDurationMs >= 0
  ) {
    out.thinkingDurationMs = row.thinkingDurationMs;
  }
  return out;
}

const BOARD_TASK_STATUSES = new Set([
  'planned',
  'in_progress',
  'testing',
  'complete',
  'failed',
  'blocked',
]);
const BOARD_CATEGORIES = new Set(['build', 'fix', 'test', 'research']);

function ensureBoardWaveId(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

function ensureBoardCategory(raw) {
  return typeof raw === 'string' && BOARD_CATEGORIES.has(raw) ? raw : null;
}

function ensureBoardTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title : '';
  const wave = ensureBoardWaveId(r.wave);
  const category = ensureBoardCategory(r.category);
  const statusRaw = typeof r.status === 'string' ? r.status : '';
  if (!id || wave === null || !category || !BOARD_TASK_STATUSES.has(statusRaw)) return null;
  const out = { id, title, wave, category, status: statusRaw };
  if (typeof r.assignedRunId === 'string' && r.assignedRunId.trim()) {
    out.assignedRunId = r.assignedRunId.trim();
  }
  if (typeof r.startedAt === 'number') out.startedAt = r.startedAt;
  if (typeof r.endedAt === 'number') out.endedAt = r.endedAt;
  if (typeof r.filesChanged === 'number' && Number.isFinite(r.filesChanged)) {
    out.filesChanged = r.filesChanged;
  }
  if (typeof r.notes === 'string') out.notes = r.notes;
  if (typeof r.error === 'string') out.error = r.error;
  return out;
}

function ensureOrchestrateBoard(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const planPath = typeof r.planPath === 'string' ? r.planPath.trim() : '';
  if (!planPath || !Array.isArray(r.tasks) || !Array.isArray(r.waves)) return undefined;
  const tasks = [];
  for (const item of r.tasks) {
    const task = ensureBoardTask(item);
    if (task) tasks.push(task);
  }
  if (!tasks.length) return undefined;
  const waves = [];
  for (const item of r.waves) {
    if (!item || typeof item !== 'object') continue;
    const w = /** @type {Record<string, unknown>} */ (item);
    const id = ensureBoardWaveId(w.id);
    const statusRaw = typeof w.status === 'string' ? w.status : 'planned';
    const status = BOARD_TASK_STATUSES.has(statusRaw) ? statusRaw : 'planned';
    if (id === null) continue;
    const wave = { id, status };
    if (typeof w.taskCount === 'number') wave.taskCount = w.taskCount;
    if (typeof w.completeCount === 'number') wave.completeCount = w.completeCount;
    waves.push(wave);
  }
  if (!waves.length) return undefined;
  const startedAt = typeof r.startedAt === 'number' ? r.startedAt : Date.now();
  const lastUpdatedAt = typeof r.lastUpdatedAt === 'number' ? r.lastUpdatedAt : startedAt;
  const out = { planPath, tasks, waves, startedAt, lastUpdatedAt };
  if (typeof r.activeParentTurnId === 'string' && r.activeParentTurnId.trim()) {
    out.activeParentTurnId = r.activeParentTurnId.trim();
  }
  return out;
}

function ensureViewMode(raw) {
  return raw === 'chat' || raw === 'board' ? raw : undefined;
}

function ensureChatShape(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      id: newChatId(),
      name: PLACEHOLDER_CHAT_NAME,
      workspacePath: '',
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

  const workspacePath =
    typeof row.workspacePath === 'string'
      ? normalizeWorkspacePath(row.workspacePath)
      : '';

  const pendingTurn = ensurePendingTurn(row.pendingTurn);

  const orchestratePlanPath = normalizeOrchestratePlanPath(row.orchestratePlanPath);
  const orchestrateBoard = ensureOrchestrateBoard(row.orchestrateBoard);
  const viewMode = ensureViewMode(row.viewMode);

  return {
    id: typeof row.id === 'string' && row.id ? row.id : newChatId(),
    name:
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : PLACEHOLDER_CHAT_NAME,
    workspacePath,
    modelId: typeof row.modelId === 'string' ? row.modelId : '',
    modeId: normalizeModeId(
      typeof row.modeId === 'string' ? row.modeId : undefined,
    ),
    expertSelection: ensureExpertSelection(row.expertSelection),
    lastResolvedExpertId:
      typeof row.lastResolvedExpertId === 'string' ? row.lastResolvedExpertId : null,
    ...(orchestratePlanPath ? { orchestratePlanPath } : {}),
    ...(orchestrateBoard ? { orchestrateBoard } : {}),
    ...(viewMode ? { viewMode } : {}),
    ...(terminalHistory?.length ? { terminalHistory } : {}),
    ...(pendingTurn ? { pendingTurn } : {}),
    ...(row.unread === true ? { unread: true } : {}),
    ...(typeof row.lastAssistantAt === 'number' &&
    Number.isFinite(row.lastAssistantAt) &&
    row.lastAssistantAt > 0
      ? { lastAssistantAt: row.lastAssistantAt }
      : {}),
    history,
    lastStats: row.lastStats && typeof row.lastStats === 'object' ? row.lastStats : null,
    modelInfo: row.modelInfo && typeof row.modelInfo === 'object' ? row.modelInfo : {},
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
    lastMessageAt:
      typeof row.lastMessageAt === 'number'
        ? row.lastMessageAt
        : typeof row.updatedAt === 'number'
          ? row.updatedAt
          : Date.now(),
  };
}

function getChatLastMessageAt(chat) {
  const last = chat.lastMessageAt;
  if (typeof last === 'number' && Number.isFinite(last) && last > 0) return last;
  const updated = chat.updatedAt;
  return typeof updated === 'number' && Number.isFinite(updated) ? updated : 0;
}

function trimChatsIfNeeded(state) {
  if (!state.chats || state.chats.length <= MAX_CHATS) return;
  const activeId = state.activeId;
  const sortedOldestFirst = [...state.chats].sort(
    (a, b) => getChatLastMessageAt(a) - getChatLastMessageAt(b),
  );
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
  const version = parsed.version;
  if (version !== 1 && version !== 2) {
    throw new Error('Invalid session version');
  }

  if (!Array.isArray(parsed.chats)) {
    throw new Error('Invalid session state');
  }

  const chats = parsed.chats.map(ensureChatShape).filter(Boolean);
  const state = {
    version: SESSION_SCHEMA_VERSION,
    activeId: typeof parsed.activeId === 'string' ? parsed.activeId : '',
    sidebarCollapsed: !!parsed.sidebarCollapsed,
    lastActiveChatIdByWorkspace: ensureLastActiveMap(parsed.lastActiveChatIdByWorkspace),
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
  const DEFAULT_ENABLED_TOOL_IDS = new Set([
    'get_datetime',
    'calculate',
    'web_search',
    'wikipedia_search',
    'save_memory',
    'ask_question',
  ]);
  const DEFAULT_FULL_PERMISSION_TOOL_IDS = new Set(['ask_question']);

  const enabled = {};
  const permissions = {};
  for (const id of ALL_TOOL_IDS) {
    const on = DEFAULT_ENABLED_TOOL_IDS.has(id);
    enabled[id] = on;
    permissions[id] = DEFAULT_FULL_PERMISSION_TOOL_IDS.has(id)
      ? 'full'
      : on
        ? 'ask'
        : 'off';
  }

  const config = { enabled, permissions, keys: { braveApiKey: '' } };

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

  let hadPermissionsInFile = false;
  if (stored.permissions && typeof stored.permissions === 'object') {
    const permMap = /** @type {Record<string, unknown>} */ (stored.permissions);
    for (const [id, value] of Object.entries(permMap)) {
      if (typeof id !== 'string' || !id) continue;
      if (value === 'full' || value === 'ask' || value === 'off') {
        config.permissions[id] = value;
        hadPermissionsInFile = true;
      }
    }
  }

  if (!hadPermissionsInFile) {
    for (const id of ALL_TOOL_IDS) {
      if (DEFAULT_FULL_PERMISSION_TOOL_IDS.has(id) && config.enabled[id]) {
        config.permissions[id] = 'full';
      } else {
        config.permissions[id] = config.enabled[id] ? 'ask' : 'off';
      }
    }
  } else {
    for (const id of ALL_TOOL_IDS) {
      const v = config.permissions[id];
      if (v !== 'full' && v !== 'ask' && v !== 'off') {
        if (DEFAULT_FULL_PERMISSION_TOOL_IDS.has(id) && config.enabled[id]) {
          config.permissions[id] = 'full';
        } else {
          config.permissions[id] = config.enabled[id] ? 'ask' : 'off';
        }
      }
    }
  }

  for (const id of ALL_TOOL_IDS) {
    const mode = config.permissions[id];
    config.enabled[id] = mode !== 'off';
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
 * @returns {{ enabled: Record<string, boolean> }}
 */
export function normalizeSkillConfig(raw) {
  const config = { enabled: {} };

  if (!raw || typeof raw !== 'object') return config;

  const stored = /** @type {Record<string, unknown>} */ (raw);
  if (!stored.enabled || typeof stored.enabled !== 'object') return config;

  const enabledMap = /** @type {Record<string, unknown>} */ (stored.enabled);
  for (const [id, value] of Object.entries(enabledMap)) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) continue;
    if (typeof value === 'boolean') {
      config.enabled[id] = value;
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

const MAX_USER_RULES_BYTES = 16 * 1024;

/**
 * @param {unknown} raw
 * @returns {{ version: 1, enabled: boolean, text: string }}
 */
export function validateUserRulesSettings(raw) {
  if (!raw || typeof raw !== 'object') {
    const err = new Error('Invalid user rules settings');
    err.statusCode = 400;
    throw err;
  }

  const parsed = /** @type {Record<string, unknown>} */ (raw);
  const version = parsed.version === 1 ? 1 : 1;
  const enabled = parsed.enabled === true;
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_USER_RULES_BYTES) {
    const err = new Error(`User rules text exceeds ${MAX_USER_RULES_BYTES} bytes`);
    err.statusCode = 413;
    throw err;
  }

  return { version, enabled, text };
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
            autoOpenOnAgentRun: false,
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

  if (p.workspace && typeof p.workspace === 'object') {
    const existingWorkspace =
      base.workspace && typeof base.workspace === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.workspace) }
        : { path: '' };
    const w = /** @type {Record<string, unknown>} */ (p.workspace);
    if (typeof w.path === 'string' && w.path.trim()) {
      existingWorkspace.path = w.path.trim();
    }
    if (Array.isArray(w.recentPaths)) {
      const trimmed = w.recentPaths
        .filter((p) => typeof p === 'string')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      existingWorkspace.recentPaths = trimmed.slice(0, 10);
    }
    base.workspace = existingWorkspace;
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

  if (p.toolSecurity && typeof p.toolSecurity === 'object') {
    const existingTs =
      base.toolSecurity && typeof base.toolSecurity === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.toolSecurity) }
        : { filesystemAccess: 'workspace' };
    const ts = /** @type {Record<string, unknown>} */ (p.toolSecurity);
    if (ts.filesystemAccess === 'full' || ts.filesystemAccess === 'workspace') {
      existingTs.filesystemAccess = ts.filesystemAccess;
    }
    base.toolSecurity = existingTs;
  }

  if (p.planning && typeof p.planning === 'object') {
    const existingPlanning =
      base.planning && typeof base.planning === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.planning) }
        : { granularity: 'medium' };
    const pl = /** @type {Record<string, unknown>} */ (p.planning);
    if (pl.granularity === 'large' || pl.granularity === 'medium' || pl.granularity === 'small') {
      existingPlanning.granularity = pl.granularity;
    }
    base.planning = existingPlanning;
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
