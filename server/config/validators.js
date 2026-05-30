/**
 * Validate session, tool, and system-prompt payloads before writing to disk.
 */

import { ALL_TOOL_IDS } from './tool-ids.js';
import { normalizeOrchestratePlanPath } from './orchestrate-plan-path.js';
import { normalizeSamplerPreset } from '../agents/sampler.js';
import {
  clampGenerationIdleTimeoutMs,
  clampGenerationMaxDurationMs,
  DEFAULT_GENERATION_IDLE_TIMEOUT_MS,
  DEFAULT_GENERATION_MAX_DURATION_MS,
} from '../generations/timeouts.js';

const PLACEHOLDER_CHAT_NAME = 'New chat';
const MAX_CHATS = 50;
const SESSION_SCHEMA_VERSION = 3;

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
const MODE_IDS = ['general', 'build', 'plan', 'orchestrate', 'research', 'reef', 'debug'];
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
  if (typeof r.timerAccumulatedMs === 'number') {
    out.timerAccumulatedMs = r.timerAccumulatedMs;
  }
  if (typeof r.timerSegmentStartedAt === 'number') {
    out.timerSegmentStartedAt = r.timerSegmentStartedAt;
  }
  return out;
}

const BUG_COLUMNS = new Set([
  'reported',
  'investigating',
  'planned',
  'fixing',
  'complete',
]);
const BUG_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function ensureBugCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title : '';
  const description = typeof r.description === 'string' ? r.description : '';
  const severityRaw = typeof r.severity === 'string' ? r.severity : 'medium';
  const columnRaw = typeof r.column === 'string' ? r.column : 'reported';
  if (!id || !BUG_SEVERITIES.has(severityRaw) || !BUG_COLUMNS.has(columnRaw)) return null;
  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : Date.now();
  const updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : createdAt;
  const out = {
    id,
    title,
    description,
    severity: severityRaw,
    column: columnRaw,
    createdAt,
    updatedAt,
  };
  if (typeof r.notes === 'string') out.notes = r.notes;
  if (typeof r.planPath === 'string' && r.planPath.trim()) out.planPath = r.planPath.trim();
  if (typeof r.investigateRunId === 'string' && r.investigateRunId.trim()) {
    out.investigateRunId = r.investigateRunId.trim();
  }
  if (typeof r.planRunId === 'string' && r.planRunId.trim()) {
    out.planRunId = r.planRunId.trim();
  }
  if (typeof r.fixRunId === 'string' && r.fixRunId.trim()) {
    out.fixRunId = r.fixRunId.trim();
  }
  if (typeof r.workspacePath === 'string') {
    out.workspacePath = normalizeWorkspacePath(r.workspacePath);
  } else {
    out.workspacePath = '';
  }
  if (typeof r.chatId === 'string' && r.chatId.trim()) {
    out.chatId = r.chatId.trim();
  }
  return out;
}

function ensureBugBoard(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (!Array.isArray(r.bugs)) return undefined;
  const bugs = [];
  for (const item of r.bugs) {
    const card = ensureBugCard(item);
    if (card) bugs.push(card);
  }
  const startedAt = typeof r.startedAt === 'number' ? r.startedAt : Date.now();
  const lastUpdatedAt = typeof r.lastUpdatedAt === 'number' ? r.lastUpdatedAt : startedAt;
  return { bugs, startedAt, lastUpdatedAt };
}

/** Validate ~/.minnow/bugs/state.json */
export function validateBugsState(raw) {
  if (!raw || typeof raw !== 'object') {
    return { version: 1, bugs: [] };
  }
  const row = /** @type {Record<string, unknown>} */ (raw);
  if (row.version !== 1 || !Array.isArray(row.bugs)) {
    return { version: 1, bugs: [] };
  }
  const bugs = [];
  for (const item of row.bugs) {
    const card = ensureBugCard(item);
    if (card) bugs.push(card);
  }
  return { version: 1, bugs };
}

function ensureViewMode(raw) {
  return raw === 'chat' || raw === 'board' ? raw : undefined;
}

const GENERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persisted backend generation id for reload re-subscribe. */
function ensureCurrentGenerationId(raw) {
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim();
  return GENERATION_ID_RE.test(id) ? id : undefined;
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

  const currentGenerationId = ensureCurrentGenerationId(row.currentGenerationId);

  const orchestratePlanPath = normalizeOrchestratePlanPath(row.orchestratePlanPath);
  const orchestrateBoard = ensureOrchestrateBoard(row.orchestrateBoard);
  const viewMode = ensureViewMode(row.viewMode);

  const runs = Array.isArray(row.runs)
    ? row.runs.filter((r) => r && typeof r === 'object')
    : undefined;
  const activeBranchByFork =
    row.activeBranchByFork && typeof row.activeBranchByFork === 'object'
      ? row.activeBranchByFork
      : undefined;

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
    ...(runs?.length ? { runs } : {}),
    ...(activeBranchByFork ? { activeBranchByFork } : {}),
    ...(terminalHistory?.length ? { terminalHistory } : {}),
    ...(currentGenerationId ? { currentGenerationId } : {}),
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
  if (version !== 1 && version !== 2 && version !== 3) {
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
const MAX_APPROVAL_PATTERNS = 64;

/** @param {unknown} value */
function isToolPermissionMode(value) {
  return value === 'full' || value === 'ask' || value === 'off';
}

/** @param {unknown} permissions */
function isLegacyFlatPermissions(permissions) {
  if (!permissions || typeof permissions !== 'object') return false;
  const obj = /** @type {Record<string, unknown>} */ (permissions);
  if (obj.default && typeof obj.default === 'object' && !Array.isArray(obj.default)) {
    return false;
  }
  for (const value of Object.values(obj)) {
    if (isToolPermissionMode(value)) return true;
  }
  return false;
}

/** @param {unknown} raw @returns {object | null} */
function normalizeApprovalPattern(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const row = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const toolId = typeof row.toolId === 'string' ? row.toolId.trim() : '';
  const agentScope =
    row.agentScope === '*' ?
      '*'
    : typeof row.agentScope === 'string' ?
      row.agentScope.trim()
    : '';
  const argPath = typeof row.argPath === 'string' ? row.argPath.trim() : '';
  const match = row.match;
  const value = typeof row.value === 'string' ? row.value : '';
  if (!id || !toolId || !agentScope || !argPath || !value) return null;
  if (match !== 'startsWith' && match !== 'equals') return null;
  return { id, toolId, agentScope, argPath, match, value };
}

/** @param {unknown} raw */
function normalizeApprovalPatterns(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (out.length >= MAX_APPROVAL_PATTERNS) break;
    const pattern = normalizeApprovalPattern(item);
    if (!pattern || seen.has(pattern.id)) continue;
    seen.add(pattern.id);
    out.push(pattern);
  }
  return out;
}

/** @param {unknown} raw */
function normalizePerAgentMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [agentKey, toolsRaw] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    if (!agentKey.trim() || !toolsRaw || typeof toolsRaw !== 'object') continue;
    const tools = {};
    for (const [toolId, mode] of Object.entries(/** @type {Record<string, unknown>} */ (toolsRaw))) {
      if (!toolId || !isToolPermissionMode(mode)) continue;
      tools[toolId] = mode;
    }
    if (Object.keys(tools).length > 0) {
      out[agentKey.trim()] = tools;
    }
  }
  return out;
}

/**
 * @param {unknown} stored
 * @param {Record<string, string>} seedDefault
 */
function normalizePermissionsFromStored(stored, seedDefault) {
  if (!stored || typeof stored !== 'object') {
    return { default: { ...seedDefault }, perAgent: {}, patterns: [] };
  }

  if (isLegacyFlatPermissions(stored)) {
    const merged = { ...seedDefault };
    for (const [id, value] of Object.entries(/** @type {Record<string, unknown>} */ (stored))) {
      if (!id || !isToolPermissionMode(value)) continue;
      merged[id] = value;
    }
    return { default: merged, perAgent: {}, patterns: [] };
  }

  const obj = /** @type {Record<string, unknown>} */ (stored);
  const merged = { ...seedDefault };
  if (obj.default && typeof obj.default === 'object') {
    for (const [id, value] of Object.entries(/** @type {Record<string, unknown>} */ (obj.default))) {
      if (!id || !isToolPermissionMode(value)) continue;
      merged[id] = value;
    }
  }

  return {
    default: merged,
    perAgent: normalizePerAgentMap(obj.perAgent),
    patterns: normalizeApprovalPatterns(obj.patterns),
  };
}

export function normalizeToolConfig(raw) {
  const DEFAULT_ENABLED_TOOL_IDS = new Set([
    'get_datetime',
    'calculate',
    'web_search',
    'wikipedia_search',
    'save_memory',
    'ask_question',
  ]);
  const enabled = {};
  const permissionsDefault = {};
  for (const id of ALL_TOOL_IDS) {
    const on = DEFAULT_ENABLED_TOOL_IDS.has(id);
    enabled[id] = on;
    permissionsDefault[id] = on ? 'ask' : 'off';
  }

  const config = {
    enabled,
    permissions: { default: permissionsDefault, perAgent: {}, patterns: [] },
    keys: { braveApiKey: '' },
    toolCache: { enabled: true },
    plugins: {},
  };

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
    hadPermissionsInFile =
      isLegacyFlatPermissions(stored.permissions) ||
      (typeof /** @type {Record<string, unknown>} */ (stored.permissions).default === 'object' &&
        /** @type {Record<string, unknown>} */ (stored.permissions).default !== null);
    config.permissions = normalizePermissionsFromStored(
      stored.permissions,
      config.permissions.default,
    );
  }

  if (!hadPermissionsInFile) {
    for (const id of ALL_TOOL_IDS) {
      config.permissions.default[id] = config.enabled[id] ? 'ask' : 'off';
    }
  } else {
    for (const id of ALL_TOOL_IDS) {
      const v = config.permissions.default[id];
      if (!isToolPermissionMode(v)) {
        config.permissions.default[id] = config.enabled[id] ? 'ask' : 'off';
      }
    }
  }

  for (const id of ALL_TOOL_IDS) {
    const mode = config.permissions.default[id];
    config.enabled[id] = mode !== 'off';
  }

  if (stored.keys && typeof stored.keys === 'object') {
    const keysMap = /** @type {Record<string, unknown>} */ (stored.keys);
    if (typeof keysMap.braveApiKey === 'string') {
      config.keys.braveApiKey = keysMap.braveApiKey;
    }
  }

  if (stored.toolCache && typeof stored.toolCache === 'object') {
    const cacheMap = /** @type {Record<string, unknown>} */ (stored.toolCache);
    if (typeof cacheMap.enabled === 'boolean') {
      config.toolCache = { enabled: cacheMap.enabled };
    }
  }
  if (!config.toolCache) {
    config.toolCache = { enabled: true };
  }

  if (stored.plugins && typeof stored.plugins === 'object') {
    const pluginsMap = /** @type {Record<string, unknown>} */ (stored.plugins);
    for (const [pluginId, meta] of Object.entries(pluginsMap)) {
      if (!pluginId.trim() || typeof meta !== 'object' || meta === null) continue;
      const row = /** @type {Record<string, unknown>} */ (meta);
      config.plugins[pluginId.trim()] = {
        enabled: row.enabled !== false,
      };
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

const SUPERVISOR_DEFAULTS = {
  enabled: true,
  autoResume: true,
  repetitionDetection: true,
  llmEscalation: true,
  askUserOnBudgetExhausted: true,
  stallMs: 30_000,
  maxRetriesPerTask: 3,
  orchestratorHeartbeatMs: 90_000,
  inProgressNoRunMs: 45_000,
  spawnStuckMs: 30_000,
  parentSilenceAfterToolMs: 20_000,
  subAgentToolSilenceMs: 60_000,
  runRestartCap: 2,
  spawnCapPerTask: 3,
  llmEscalationsPerSession: 10,
  llmEscalationTimeoutMs: 8_000,
  tickIntervalMs: 5_000,
  repetition: {
    duplicateToolCallThreshold: 3,
    sameErrorThreshold: 3,
    maxRestartsPerRun: 2,
  },
  escalationProviderId: '',
  escalationModelId: '',
};

/**
 * Deep-merge `supervisor` config with clamps (server + tests).
 * @param {Record<string, unknown>} patch
 * @param {Record<string, unknown>} base
 * @returns {object}
 */
export function mergeSupervisorConfig(patch, base) {
  const out = {
    ...SUPERVISOR_DEFAULTS,
    ...(base && typeof base === 'object' ? base : {}),
    repetition: {
      ...SUPERVISOR_DEFAULTS.repetition,
      ...(base?.repetition && typeof base.repetition === 'object' ? base.repetition : {}),
    },
  };
  if (!patch || typeof patch !== 'object') return out;
  const p = /** @type {Record<string, unknown>} */ (patch);

  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  if (typeof p.autoResume === 'boolean') out.autoResume = p.autoResume;
  if (typeof p.repetitionDetection === 'boolean') out.repetitionDetection = p.repetitionDetection;
  if (typeof p.llmEscalation === 'boolean') out.llmEscalation = p.llmEscalation;
  if (typeof p.askUserOnBudgetExhausted === 'boolean') {
    out.askUserOnBudgetExhausted = p.askUserOnBudgetExhausted;
  }
  if (typeof p.stallMs === 'number' && Number.isFinite(p.stallMs)) {
    out.stallMs = Math.min(600_000, Math.max(5_000, Math.round(p.stallMs)));
  }
  if (typeof p.maxRetriesPerTask === 'number' && Number.isFinite(p.maxRetriesPerTask)) {
    out.maxRetriesPerTask = Math.min(10, Math.max(0, Math.round(p.maxRetriesPerTask)));
  }
  if (typeof p.orchestratorHeartbeatMs === 'number' && Number.isFinite(p.orchestratorHeartbeatMs)) {
    out.orchestratorHeartbeatMs = Math.min(600_000, Math.max(10_000, Math.round(p.orchestratorHeartbeatMs)));
  }
  if (typeof p.inProgressNoRunMs === 'number' && Number.isFinite(p.inProgressNoRunMs)) {
    out.inProgressNoRunMs = Math.min(300_000, Math.max(10_000, Math.round(p.inProgressNoRunMs)));
  }
  if (typeof p.spawnStuckMs === 'number' && Number.isFinite(p.spawnStuckMs)) {
    out.spawnStuckMs = Math.min(120_000, Math.max(5_000, Math.round(p.spawnStuckMs)));
  }
  if (typeof p.parentSilenceAfterToolMs === 'number' && Number.isFinite(p.parentSilenceAfterToolMs)) {
    out.parentSilenceAfterToolMs = Math.min(120_000, Math.max(5_000, Math.round(p.parentSilenceAfterToolMs)));
  }
  if (typeof p.subAgentToolSilenceMs === 'number' && Number.isFinite(p.subAgentToolSilenceMs)) {
    out.subAgentToolSilenceMs = Math.min(300_000, Math.max(10_000, Math.round(p.subAgentToolSilenceMs)));
  }
  if (typeof p.runRestartCap === 'number' && Number.isFinite(p.runRestartCap)) {
    out.runRestartCap = Math.min(20, Math.max(0, Math.round(p.runRestartCap)));
  }
  if (typeof p.spawnCapPerTask === 'number' && Number.isFinite(p.spawnCapPerTask)) {
    out.spawnCapPerTask = Math.min(20, Math.max(0, Math.round(p.spawnCapPerTask)));
  }
  if (typeof p.llmEscalationsPerSession === 'number' && Number.isFinite(p.llmEscalationsPerSession)) {
    out.llmEscalationsPerSession = Math.min(50, Math.max(0, Math.round(p.llmEscalationsPerSession)));
  }
  if (typeof p.llmEscalationTimeoutMs === 'number' && Number.isFinite(p.llmEscalationTimeoutMs)) {
    out.llmEscalationTimeoutMs = Math.min(60_000, Math.max(1_000, Math.round(p.llmEscalationTimeoutMs)));
  }
  if (typeof p.tickIntervalMs === 'number' && Number.isFinite(p.tickIntervalMs)) {
    out.tickIntervalMs = Math.min(60_000, Math.max(1_000, Math.round(p.tickIntervalMs)));
  }
  if (typeof p.escalationProviderId === 'string') out.escalationProviderId = p.escalationProviderId.trim();
  if (typeof p.escalationModelId === 'string') out.escalationModelId = p.escalationModelId.trim();

  const rep = p.repetition;
  if (rep && typeof rep === 'object') {
    const r = /** @type {Record<string, unknown>} */ (rep);
    if (typeof r.duplicateToolCallThreshold === 'number' && Number.isFinite(r.duplicateToolCallThreshold)) {
      out.repetition.duplicateToolCallThreshold = Math.min(10, Math.max(2, Math.round(r.duplicateToolCallThreshold)));
    }
    if (typeof r.sameErrorThreshold === 'number' && Number.isFinite(r.sameErrorThreshold)) {
      out.repetition.sameErrorThreshold = Math.min(10, Math.max(2, Math.round(r.sameErrorThreshold)));
    }
    if (typeof r.maxRestartsPerRun === 'number' && Number.isFinite(r.maxRestartsPerRun)) {
      out.repetition.maxRestartsPerRun = Math.min(10, Math.max(0, Math.round(r.maxRestartsPerRun)));
    }
  }

  return out;
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

  if (p.chat && typeof p.chat === 'object') {
    const existingChat =
      base.chat && typeof base.chat === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.chat) }
        : {
            maxToolTurns: 8,
            generationIdleTimeoutMs: DEFAULT_GENERATION_IDLE_TIMEOUT_MS,
            generationMaxDurationMs: DEFAULT_GENERATION_MAX_DURATION_MS,
          };
    let maxToolTurns =
      typeof existingChat.maxToolTurns === 'number' && Number.isFinite(existingChat.maxToolTurns)
        ? Math.round(existingChat.maxToolTurns)
        : 8;
    maxToolTurns = Math.min(64, Math.max(1, maxToolTurns));
    let generationIdleTimeoutMs = clampGenerationIdleTimeoutMs(
      existingChat.generationIdleTimeoutMs,
    );
    let generationMaxDurationMs = clampGenerationMaxDurationMs(
      existingChat.generationMaxDurationMs,
    );
    const c = /** @type {Record<string, unknown>} */ (p.chat);
    if (typeof c.maxToolTurns === 'number' && Number.isFinite(c.maxToolTurns)) {
      maxToolTurns = Math.min(64, Math.max(1, Math.round(c.maxToolTurns)));
    }
    if (
      typeof c.generationIdleTimeoutMs === 'number' &&
      Number.isFinite(c.generationIdleTimeoutMs)
    ) {
      generationIdleTimeoutMs = clampGenerationIdleTimeoutMs(c.generationIdleTimeoutMs);
    }
    if (
      typeof c.generationMaxDurationMs === 'number' &&
      Number.isFinite(c.generationMaxDurationMs)
    ) {
      generationMaxDurationMs = clampGenerationMaxDurationMs(c.generationMaxDurationMs);
    }
    base.chat = {
      maxToolTurns,
      generationIdleTimeoutMs,
      generationMaxDurationMs,
    };
  }

  if (p.toolCalls && typeof p.toolCalls === 'object') {
    const existingToolCalls =
      base.toolCalls && typeof base.toolCalls === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.toolCalls) }
        : { useConstrainedDecoding: false };
    const tc = /** @type {Record<string, unknown>} */ (p.toolCalls);
    if (tc.useConstrainedDecoding === true) {
      existingToolCalls.useConstrainedDecoding = true;
    } else if (tc.useConstrainedDecoding === false) {
      existingToolCalls.useConstrainedDecoding = false;
    }
    base.toolCalls = existingToolCalls;
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

  if (p.browser && typeof p.browser === 'object') {
    const existingBrowser =
      base.browser && typeof base.browser === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.browser) }
        : {
            enabled: true,
            allowNavigate: true,
            allowedOriginPatterns: [
              'http://localhost:*',
              'http://127.0.0.1:*',
              'https://localhost:*',
            ],
          };
    const b = /** @type {Record<string, unknown>} */ (p.browser);
    if (typeof b.enabled === 'boolean') existingBrowser.enabled = b.enabled;
    if (typeof b.allowNavigate === 'boolean') {
      existingBrowser.allowNavigate = b.allowNavigate;
    }
    if (Array.isArray(b.allowedOriginPatterns)) {
      existingBrowser.allowedOriginPatterns = b.allowedOriginPatterns.filter(
        (row) => typeof row === 'string' && row.trim(),
      );
    }
    base.browser = existingBrowser;
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

  if (
    p.activePromptProfile === 'full' ||
    p.activePromptProfile === 'lite' ||
    p.activePromptProfile === 'custom'
  ) {
    base.activePromptProfile = p.activePromptProfile;
  }
  if (p.activePromptConfigId === null || typeof p.activePromptConfigId === 'string') {
    base.activePromptConfigId = p.activePromptConfigId;
  }
  if (typeof p.activeInfoPresetId === 'string' && p.activeInfoPresetId.trim()) {
    base.activeInfoPresetId = p.activeInfoPresetId.trim();
  }
  if (p.activeSetupProfileId === null || typeof p.activeSetupProfileId === 'string') {
    base.activeSetupProfileId = p.activeSetupProfileId;
  }
  if (typeof p.workspaceProfileAutoApply === 'boolean') {
    base.workspaceProfileAutoApply = p.workspaceProfileAutoApply;
  }
  if (p.workspaceProfiles && typeof p.workspaceProfiles === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(
      /** @type {Record<string, unknown>} */ (p.workspaceProfiles),
    )) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const normKey = normalizeWorkspacePath(key);
      if (!normKey) continue;
      if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(value.trim())) continue;
      out[normKey] = value.trim();
    }
    base.workspaceProfiles = out;
  }

  if (p.supervisor && typeof p.supervisor === 'object') {
    base.supervisor = mergeSupervisorConfig(
      /** @type {Record<string, unknown>} */ (p.supervisor),
      base.supervisor && typeof base.supervisor === 'object'
        ? /** @type {Record<string, unknown>} */ (base.supervisor)
        : {},
    );
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
  let maxToolTurns = 12;
  if (typeof base.maxToolTurns === 'number' && Number.isFinite(base.maxToolTurns)) {
    maxToolTurns = Math.min(64, Math.max(1, Math.round(base.maxToolTurns)));
  } else if (
    typeof base.defaultMaxToolTurns === 'number' &&
    Number.isFinite(base.defaultMaxToolTurns)
  ) {
    maxToolTurns = Math.min(64, Math.max(1, Math.round(base.defaultMaxToolTurns)));
  }
  base.maxToolTurns = maxToolTurns;
  delete base.defaultMaxToolTurns;
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

    if (row.maxInputTokens !== undefined && row.maxInputTokens !== null) {
      const cap = Number(row.maxInputTokens);
      if (!Number.isFinite(cap) || cap < 1) {
        row.maxInputTokens = null;
      } else {
        row.maxInputTokens = Math.floor(cap);
      }
    }

    const policy = row.contextEnforcementPolicy;
    if (
      policy !== undefined &&
      policy !== 'summarize' &&
      policy !== 'slide' &&
      policy !== 'truncate'
    ) {
      delete row.contextEnforcementPolicy;
      warnings.push(
        `Invalid contextEnforcementPolicy for types.${typeId}; removed`,
      );
    }

    if (row.minRecentTurns !== undefined) {
      const n = Number(row.minRecentTurns);
      row.minRecentTurns =
        Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
    }

    if (row.summaryReserveTokens !== undefined) {
      const n = Number(row.summaryReserveTokens);
      row.summaryReserveTokens =
        Number.isFinite(n) && n >= 64 ? Math.floor(n) : undefined;
    }

    if (row.summarySchema !== undefined) {
      const schema = String(row.summarySchema).trim();
      if (!schema) {
        delete row.summarySchema;
      } else {
        row.summarySchema = schema.slice(0, 64);
      }
    }

    if (row.sampler !== undefined) {
      const normalized = normalizeSamplerPreset(row.sampler);
      if (normalized === null) {
        delete row.sampler;
      } else if (Object.keys(normalized).length === 0) {
        delete row.sampler;
      } else {
        row.sampler = normalized;
      }
    }

    delete row.maxToolTurns;
  }

  if (base.defaultMaxInputTokens !== undefined && base.defaultMaxInputTokens !== null) {
    const cap = Number(base.defaultMaxInputTokens);
    base.defaultMaxInputTokens =
      Number.isFinite(cap) && cap >= 1000 ? Math.min(Math.floor(cap), 200000) : null;
  }

  const defaultPolicy = base.defaultContextEnforcementPolicy;
  if (
    defaultPolicy !== undefined &&
    defaultPolicy !== 'summarize' &&
    defaultPolicy !== 'slide' &&
    defaultPolicy !== 'truncate'
  ) {
    delete base.defaultContextEnforcementPolicy;
  }

  if (base.defaultSummarySchema !== undefined) {
    const schema = String(base.defaultSummarySchema).trim();
    if (!schema) delete base.defaultSummarySchema;
    else base.defaultSummarySchema = schema.slice(0, 64);
  }

  return { config: base, warnings };
}
