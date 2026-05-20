import { MAX_CHATS, PLACEHOLDER_CHAT_NAME, SAVE_DEBOUNCE_MS, STORAGE_KEY } from '../constants';
import { abortChatTitleGeneration } from '../chat/titles/inflight';
import { isPlaceholderChatName } from '../chat/titles/placeholder';
import { setSaveTimer, saveTimer } from '../app-state';
import { getSessions, putSessions } from '../config/api-client';
import { defaultSessionState } from '../config/defaults';
import { isServerStorageMode } from '../config/storage-mode';
import { DEFAULT_MODE_ID, normalizeModeId } from '../chat/modes/types';
import { normalizeOrchestratePlanPath } from '../chat/orchestrate/plan-path';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import {
  getChatsForWorkspace as filterChatsForWorkspace,
  getUnassignedChats as filterUnassignedChats,
  migrateSessionStateV1ToV2 as migrateSessionJsonToV2,
  resolveActiveChatIdForWorkspace as pickActiveChatIdForWorkspace,
  type RawSessionJson,
} from './session-workspace-scope';
import { setStatus } from '../ui/status';
import { getWorkspacePath } from './workspace';
import {
  clearStalePendingTurnsOnLoad,
  ensurePendingTurn,
} from './pending-turn-shape';
import type {
  AssistantMessage,
  AssistantToolCallMessage,
  BoardCategory,
  BoardTask,
  BoardTaskStatus,
  BoardWave,
  Chat,
  ExpertSelection,
  Message,
  OrchestrateBoardState,
  PersistedSubAgentRun,
  PersistedSubAgentStatus,
  SessionState,
  TerminalRunRecord,
  ToolCall,
  ToolResultMessage,
} from '../types';

/** Default expert picker when missing on older chats. */
export function defaultExpertSelection(): ExpertSelection {
  return { mode: 'auto', expertId: null };
}

function ensureExpertSelection(raw: unknown): ExpertSelection {
  if (!raw || typeof raw !== 'object') return defaultExpertSelection();
  const row = raw as Partial<ExpertSelection>;
  const mode = row.mode === 'manual' ? 'manual' : 'auto';
  const expertId =
    mode === 'manual' && typeof row.expertId === 'string' && row.expertId.trim()
      ? row.expertId.trim()
      : null;
  return { mode, expertId };
}

/** In-memory session blob mirrored to ~/.minnow or localStorage fallback. */
export let sessionState: SessionState | null = null;

/** Replace in-memory session blob (unit tests). */
export function setSessionStateForTests(state: SessionState | null): void {
  sessionState = state;
}

export type SaveSessionsResult = 'ok' | 'quota_exceeded';

export interface RemoveChatResult {
  ok: boolean;
  removed?: Chat;
  /** True when the main column should reload the active chat. */
  activeChanged: boolean;
  activeChat: Chat;
}

function requireSessionState(): SessionState {
  if (!sessionState) {
    throw new Error('sessionState is not initialized; call loadSessionsFromStorage() first');
  }
  return sessionState;
}

export function newChatId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function createEmptyChatObject(modelId: string, workspacePath?: string): Chat {
  const boundWorkspace =
    workspacePath !== undefined
      ? normalizeWorkspacePath(workspacePath)
      : normalizeWorkspacePath(getWorkspacePath());
  return {
    id: newChatId(),
    name: PLACEHOLDER_CHAT_NAME,
    workspacePath: boundWorkspace,
    modelId: modelId || '',
    modeId: DEFAULT_MODE_ID,
    workAgentId: null,
    workAgentAuto: true,
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: Date.now(),
  };
}

function ensureToolCall(raw: unknown): ToolCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const fn = row.function;
  if (!id || !fn || typeof fn !== 'object') return null;
  const func = fn as Record<string, unknown>;
  const name = typeof func.name === 'string' ? func.name : '';
  if (!name) return null;
  const args = typeof func.arguments === 'string' ? func.arguments : '';
  return { id, type: 'function', function: { name, arguments: args } };
}

function ensureToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(ensureToolCall).filter((tc): tc is ToolCall => Boolean(tc));
}

function ensureMessageEntry(m: Partial<Message> | null | undefined): Message | null {
  if (!m || !m.role) return null;

  if (m.role === 'tool') {
    const toolMsg = m as Partial<ToolResultMessage>;
    const toolCallId =
      typeof toolMsg.tool_call_id === 'string' ? toolMsg.tool_call_id.trim() : '';
    if (!toolCallId) return null;
    const content = toolMsg.content != null ? String(toolMsg.content) : '';
    const attachments = Array.isArray(toolMsg.attachments)
      ? toolMsg.attachments.filter(
          (a) =>
            a &&
            typeof a === 'object' &&
            a.type === 'image' &&
            typeof a.url === 'string',
        )
      : undefined;
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      content,
      ...(attachments?.length ? { attachments } : {}),
    };
  }

  if (m.role === 'user') {
    const content = m.content != null ? String(m.content) : '';
    return { role: 'user', content };
  }

  if (m.role !== 'assistant') return null;

  const toolCalls = ensureToolCalls((m as Partial<AssistantToolCallMessage>).tool_calls);
  if (toolCalls.length) {
    const withTools: AssistantToolCallMessage = {
      role: 'assistant',
      content: m.content == null ? null : String(m.content),
      tool_calls: toolCalls,
    };
    if (m.stats && typeof m.stats === 'object') withTools.stats = m.stats;
    if (m.usage && typeof m.usage === 'object') withTools.usage = m.usage;
    return withTools;
  }

  const assistant: AssistantMessage = {
    role: 'assistant',
    content: m.content != null ? String(m.content) : '',
  };
  if (m.stats && typeof m.stats === 'object') assistant.stats = m.stats;
  if (m.usage && typeof m.usage === 'object') assistant.usage = m.usage;
  return assistant;
}

function ensureTerminalHistory(raw: unknown): TerminalRunRecord[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const row = r as Partial<TerminalRunRecord>;
      if (typeof row.id !== 'string' || typeof row.command !== 'string') return null;
      return {
        id: row.id,
        command: row.command,
        cwd: typeof row.cwd === 'string' ? row.cwd : '.',
        source: row.source === 'user' ? 'user' : 'agent',
        ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
        startedAt: typeof row.startedAt === 'number' ? row.startedAt : 0,
        finishedAt: typeof row.finishedAt === 'number' ? row.finishedAt : 0,
        exitCode: typeof row.exitCode === 'number' ? row.exitCode : null,
        timedOut: row.timedOut === true,
        logPath: typeof row.logPath === 'string' ? row.logPath : '',
      } satisfies TerminalRunRecord;
    })
    .filter((x): x is TerminalRunRecord => Boolean(x));
  return rows.length ? rows : undefined;
}

const PERSISTED_SUB_AGENT_STATUSES = new Set<PersistedSubAgentStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

const BOARD_TASK_STATUSES = new Set<BoardTaskStatus>([
  'planned',
  'in_progress',
  'testing',
  'complete',
  'failed',
  'blocked',
]);

const BOARD_CATEGORIES = new Set<BoardCategory>(['build', 'fix', 'test', 'research']);

function ensureBoardWaveId(raw: unknown): number | string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

function ensureBoardCategory(raw: unknown): BoardCategory | null {
  return typeof raw === 'string' && BOARD_CATEGORIES.has(raw as BoardCategory)
    ? (raw as BoardCategory)
    : null;
}

function ensureBoardTask(raw: unknown): BoardTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title : '';
  const wave = ensureBoardWaveId(r.wave);
  const category = ensureBoardCategory(r.category);
  const statusRaw = typeof r.status === 'string' ? r.status : '';
  if (!id || wave === null || !category || !BOARD_TASK_STATUSES.has(statusRaw as BoardTaskStatus)) {
    return null;
  }
  const status = statusRaw as BoardTaskStatus;
  const assignedRunId =
    typeof r.assignedRunId === 'string' && r.assignedRunId.trim()
      ? r.assignedRunId.trim()
      : undefined;
  const filesChanged =
    typeof r.filesChanged === 'number' && Number.isFinite(r.filesChanged)
      ? r.filesChanged
      : undefined;
  return {
    id,
    title,
    wave,
    category,
    status,
    ...(assignedRunId ? { assignedRunId } : {}),
    ...(typeof r.startedAt === 'number' ? { startedAt: r.startedAt } : {}),
    ...(typeof r.endedAt === 'number' ? { endedAt: r.endedAt } : {}),
    ...(filesChanged !== undefined ? { filesChanged } : {}),
    ...(typeof r.notes === 'string' ? { notes: r.notes } : {}),
    ...(typeof r.error === 'string' ? { error: r.error } : {}),
  };
}

function ensureOrchestrateBoard(raw: unknown): OrchestrateBoardState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const planPath = typeof r.planPath === 'string' ? r.planPath.trim() : '';
  if (!planPath || !Array.isArray(r.tasks) || !Array.isArray(r.waves)) return undefined;
  const tasks: BoardTask[] = [];
  for (const item of r.tasks) {
    const task = ensureBoardTask(item);
    if (task) tasks.push(task);
  }
  if (!tasks.length) return undefined;
  const waves: BoardWave[] = [];
  for (const item of r.waves) {
    if (!item || typeof item !== 'object') continue;
    const w = item as Record<string, unknown>;
    const id = ensureBoardWaveId(w.id);
    const statusRaw = typeof w.status === 'string' ? w.status : 'planned';
    const status = BOARD_TASK_STATUSES.has(statusRaw as BoardTaskStatus)
      ? (statusRaw as BoardTaskStatus)
      : 'planned';
    if (id === null) continue;
    waves.push({
      id,
      status,
      ...(typeof w.taskCount === 'number' ? { taskCount: w.taskCount } : {}),
      ...(typeof w.completeCount === 'number' ? { completeCount: w.completeCount } : {}),
    });
  }
  if (!waves.length) return undefined;
  const startedAt = typeof r.startedAt === 'number' ? r.startedAt : Date.now();
  const lastUpdatedAt = typeof r.lastUpdatedAt === 'number' ? r.lastUpdatedAt : startedAt;
  const activeParentTurnId =
    typeof r.activeParentTurnId === 'string' && r.activeParentTurnId.trim()
      ? r.activeParentTurnId.trim()
      : undefined;
  return {
    planPath,
    tasks,
    waves,
    startedAt,
    lastUpdatedAt,
    ...(activeParentTurnId ? { activeParentTurnId } : {}),
  };
}

function ensureViewMode(raw: unknown): 'chat' | 'board' | undefined {
  return raw === 'chat' || raw === 'board' ? raw : undefined;
}

function ensurePersistedSubAgentRuns(
  raw: unknown,
): PersistedSubAgentRun[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PersistedSubAgentRun[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const runId = typeof r.runId === 'string' ? r.runId.trim() : '';
    const parentTurnId = typeof r.parentTurnId === 'string' ? r.parentTurnId : '';
    const type = typeof r.type === 'string' ? r.type : '';
    const task = typeof r.task === 'string' ? r.task : '';
    const statusRaw = typeof r.status === 'string' ? r.status : '';
    if (!runId || !PERSISTED_SUB_AGENT_STATUSES.has(statusRaw as PersistedSubAgentStatus)) {
      continue;
    }
    const status = statusRaw as PersistedSubAgentStatus;
    const messages = Array.isArray(r.messages) ? r.messages : [];
    const parentToolCallId =
      typeof r.parentToolCallId === 'string' && r.parentToolCallId.trim()
        ? r.parentToolCallId.trim()
        : undefined;
    const err = r.error;
    const category = ensureBoardCategory(r.category);
    const boardTaskId =
      r.boardTaskId === null || typeof r.boardTaskId === 'string'
        ? (r.boardTaskId as string | null)
        : undefined;
    out.push({
      runId,
      parentTurnId,
      ...(parentToolCallId ? { parentToolCallId } : {}),
      type,
      task,
      status,
      summary: typeof r.summary === 'string' ? r.summary : '',
      ...(err === null || typeof err === 'string' ? { error: err as string | null } : {}),
      startedAt: typeof r.startedAt === 'string' ? r.startedAt : null,
      endedAt: typeof r.endedAt === 'string' ? r.endedAt : null,
      toolTurns: typeof r.toolTurns === 'number' ? r.toolTurns : 0,
      messages,
      ...(category ? { category } : {}),
      ...(boardTaskId !== undefined ? { boardTaskId } : {}),
    });
  }
  return out.length ? out : undefined;
}

export function ensureChatShape(raw: Partial<Chat> | null | undefined): Chat {
  if (!raw || typeof raw !== 'object') return createEmptyChatObject('');
  const history = Array.isArray(raw.history)
    ? raw.history.map(ensureMessageEntry).filter((x): x is Message => Boolean(x))
    : [];
  const subAgentRuns = ensurePersistedSubAgentRuns(raw.subAgentRuns);
  const pendingTurn = ensurePendingTurn(raw.pendingTurn);
  const workspacePath =
    typeof raw.workspacePath === 'string'
      ? normalizeWorkspacePath(raw.workspacePath)
      : '';
  const orchestratePlanPath = normalizeOrchestratePlanPath(raw.orchestratePlanPath);
  const orchestrateBoard = ensureOrchestrateBoard(raw.orchestrateBoard);
  const viewMode = ensureViewMode(raw.viewMode);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newChatId(),
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : PLACEHOLDER_CHAT_NAME,
    workspacePath,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : '',
    providerId: typeof raw.providerId === 'string' ? raw.providerId : undefined,
    modeId: normalizeModeId(raw.modeId),
    reefWidgetProviderId:
      typeof raw.reefWidgetProviderId === 'string' ? raw.reefWidgetProviderId : undefined,
    reefWidgetModelId:
      typeof raw.reefWidgetModelId === 'string' ? raw.reefWidgetModelId : undefined,
    expertSelection: ensureExpertSelection(raw.expertSelection),
    lastResolvedExpertId:
      typeof raw.lastResolvedExpertId === 'string' ? raw.lastResolvedExpertId : null,
    workAgentId:
      typeof raw.workAgentId === 'string' && raw.workAgentId.trim()
        ? raw.workAgentId.trim()
        : null,
    workAgentAuto: raw.workAgentAuto !== false,
    ...(orchestratePlanPath ? { orchestratePlanPath } : {}),
    ...(orchestrateBoard ? { orchestrateBoard } : {}),
    ...(viewMode ? { viewMode } : {}),
    terminalHistory: ensureTerminalHistory(raw.terminalHistory),
    ...(subAgentRuns ? { subAgentRuns } : {}),
    ...(pendingTurn ? { pendingTurn } : {}),
    ...(raw.unread === true ? { unread: true } : {}),
    ...(typeof raw.lastAssistantAt === 'number' &&
    Number.isFinite(raw.lastAssistantAt) &&
    raw.lastAssistantAt > 0
      ? { lastAssistantAt: raw.lastAssistantAt }
      : {}),
    history,
    lastStats: raw.lastStats && typeof raw.lastStats === 'object' ? raw.lastStats : null,
    modelInfo: raw.modelInfo && typeof raw.modelInfo === 'object' ? raw.modelInfo : {},
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

/** Read expert selection for a chat (defaults to Auto). */
export function getExpertSelection(chat: Chat): ExpertSelection {
  return chat.expertSelection ?? defaultExpertSelection();
}

/** Upgrade v1/v2 session JSON to canonical schema v2 in memory. */
export function migrateSessionStateV1ToV2(parsed: RawSessionJson): SessionState {
  const state = migrateSessionJsonToV2(
    parsed,
    (c) => ensureChatShape(c as Partial<Chat>),
    () => createEmptyChatObject(''),
  );
  clearStalePendingTurnsOnLoad(state.chats);
  return state;
}

function parseSessionStateFromJson(parsed: RawSessionJson | null): SessionState {
  if (!parsed || !Array.isArray(parsed.chats)) {
    return defaultSessionState();
  }
  const ver = parsed.version;
  if (ver !== 1 && ver !== 2) {
    return defaultSessionState();
  }
  return migrateSessionStateV1ToV2(parsed);
}

/** Remember the active chat under the current workspace key before switching scope. */
function rememberActiveChatForWorkspaceKey(workspaceKey: string): void {
  const state = sessionState;
  if (!state?.activeId) return;
  if (!state.lastActiveChatIdByWorkspace) {
    state.lastActiveChatIdByWorkspace = {};
  }
  state.lastActiveChatIdByWorkspace[workspaceKey] = state.activeId;
}

/** Chats for the given workspace (newest first); empty workspace key returns none. */
export function getChatsForWorkspace(
  workspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterChatsForWorkspace(workspacePath, state);
}

/** Legacy or unscoped chats (`workspacePath === ''`), newest first. */
export function getUnassignedChats(state: SessionState = requireSessionState()): Chat[] {
  return filterUnassignedChats(state);
}

/**
 * Pick the active chat id for a workspace: remembered id, else newest scoped chat,
 * else create a new empty chat bound to that workspace.
 */
export function resolveActiveChatIdForWorkspace(
  workspacePath: string,
  state: SessionState = requireSessionState(),
  fallbackModelId = '',
): string {
  return pickActiveChatIdForWorkspace(
    workspacePath,
    state,
    fallbackModelId,
    (modelId, workspaceKey) => {
      const fresh = createEmptyChatObject(modelId, workspaceKey);
      touchChat(fresh);
      return fresh;
    },
  );
}

export interface WorkspaceChangeResult {
  activeChat: Chat;
  activeChanged: boolean;
}

/**
 * After the workspace folder changes: persist per-workspace active chat and switch
 * to the best chat for the new path.
 */
export function onWorkspaceChanged(
  newPath: string,
  previousPath?: string,
): WorkspaceChangeResult {
  const state = requireSessionState();
  const prevKey = normalizeWorkspacePath(previousPath ?? '');
  rememberActiveChatForWorkspaceKey(prevKey);

  const fallbackModelId =
    state.chats.find((c) => c.id === state.activeId)?.modelId ?? '';
  const nextId = resolveActiveChatIdForWorkspace(newPath, state, fallbackModelId);
  const activeChanged = state.activeId !== nextId;
  state.activeId = nextId;
  rememberActiveChatForWorkspaceKey(normalizeWorkspacePath(newPath));
  scheduleSaveSessions();
  return { activeChat: getActiveChat(), activeChanged };
}

/** Load sessions from API or localStorage (after detectConfigServer). */
export async function loadSessionsFromStorage(): Promise<void> {
  if (isServerStorageMode()) {
    try {
      const remote = await getSessions();
      sessionState = parseSessionStateFromJson(remote);
      return;
    } catch {
      setStatus('err', 'Could not load sessions from ~/.minnow');
    }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      sessionState = defaultSessionState();
      return;
    }
    sessionState = parseSessionStateFromJson(JSON.parse(raw) as Partial<SessionState>);
  } catch {
    sessionState = defaultSessionState();
  }
}

export function findChatById(chatId: string): Chat | undefined {
  return requireSessionState().chats.find((c) => c.id === chatId);
}

/** Chats ordered newest-first for sidebar display. */
export function getChatsSortedByUpdatedDesc(): Chat[] {
  return [...requireSessionState().chats].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getActiveChat(): Chat {
  const state = requireSessionState();
  const c = state.chats.find((x) => x.id === state.activeId);
  return c || state.chats[0];
}

export function touchChat(chat: Chat): void {
  chat.updatedAt = Date.now();
}

function trimChatsIfNeeded(): void {
  const state = sessionState;
  if (!state || state.chats.length <= MAX_CHATS) return;
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

export function saveSessionsNow(): SaveSessionsResult {
  trimChatsIfNeeded();
  if (!sessionState) return 'ok';

  if (isServerStorageMode()) {
    void putSessions(sessionState).catch(() => {
      setStatus('err', 'Could not save sessions to ~/.minnow');
    });
    return 'ok';
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));
    return 'ok';
  } catch (e) {
    const err = e as { name?: string };
    if (err && err.name === 'QuotaExceededError') {
      return 'quota_exceeded';
    }
    return 'ok';
  }
}

export function scheduleSaveSessions(): void {
  if (saveTimer) clearTimeout(saveTimer);
  setSaveTimer(
    setTimeout(() => {
      setSaveTimer(null);
      saveSessionsNow();
    }, SAVE_DEBOUNCE_MS)
  );
}

/** Create a chat, make it active, and persist (debounced). */
export function createAndActivateChat(modelId: string): Chat {
  const state = requireSessionState();
  const chat = createEmptyChatObject(modelId);
  state.chats.unshift(chat);
  state.activeId = chat.id;
  touchChat(chat);
  rememberActiveChatForWorkspaceKey(normalizeWorkspacePath(chat.workspacePath));
  scheduleSaveSessions();
  return chat;
}

/**
 * Switch active chat by id. Returns the chat when switched, or null if id is missing / already active.
 */
export function switchActiveChat(id: string): Chat | null {
  const state = requireSessionState();
  if (id === state.activeId) return null;
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return null;
  state.activeId = id;
  rememberActiveChatForWorkspaceKey(normalizeWorkspacePath(chat.workspacePath ?? ''));
  scheduleSaveSessions();
  return chat;
}

/** Update display title after rename UI commits. */
export function renameChatTitle(chatId: string, name: string): boolean {
  const chat = findChatById(chatId);
  if (!chat) return false;
  const trimmed = name.trim();
  if (trimmed) chat.name = trimmed;
  touchChat(chat);
  scheduleSaveSessions();
  return true;
}

/** Sync model id on the active chat (e.g. when the top-bar model select changes). */
export function setActiveChatModelId(modelId: string): void {
  const chat = getActiveChat();
  chat.modelId = modelId || '';
  touchChat(chat);
  scheduleSaveSessions();
}

export function toggleSidebarCollapsedState(): boolean {
  const state = requireSessionState();
  state.sidebarCollapsed = !state.sidebarCollapsed;
  scheduleSaveSessions();
  return state.sidebarCollapsed;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  const state = requireSessionState();
  state.sidebarCollapsed = collapsed;
  scheduleSaveSessions();
}

/**
 * Remove a chat by id. If the list becomes empty, inserts a new empty chat using fallbackModelId.
 * Does not show confirm dialogs — callers in UI handle that.
 */
export function removeChatById(chatId: string, fallbackModelId: string): RemoveChatResult {
  const state = requireSessionState();
  const idx = state.chats.findIndex((c) => c.id === chatId);
  if (idx < 0) {
    return { ok: false, activeChanged: false, activeChat: getActiveChat() };
  }

  const victim = state.chats[idx];
  abortChatTitleGeneration(chatId);
  const wasActive = state.activeId === chatId;
  state.chats.splice(idx, 1);

  const victimWorkspace = normalizeWorkspacePath(victim.workspacePath ?? '');
  let activeChanged = wasActive;
  if (state.chats.length === 0) {
    const fresh = createEmptyChatObject(fallbackModelId, victimWorkspace);
    state.chats.push(fresh);
    state.activeId = fresh.id;
    touchChat(fresh);
    activeChanged = true;
  } else if (wasActive) {
    const inWorkspace = getChatsForWorkspace(victimWorkspace, state);
    if (inWorkspace.length) {
      state.activeId = inWorkspace[0].id;
    } else {
      const fresh = createEmptyChatObject(fallbackModelId, victimWorkspace);
      state.chats.push(fresh);
      state.activeId = fresh.id;
      touchChat(fresh);
    }
    activeChanged = true;
  }

  scheduleSaveSessions();
  return {
    ok: true,
    removed: victim,
    activeChanged,
    activeChat: getActiveChat(),
  };
}

/**
 * Apply a model-generated title when the chat still uses the placeholder name.
 * Returns false if the chat is missing or was renamed.
 */
export function applyGeneratedChatTitle(chatId: string, title: string): boolean {
  const chat = findChatById(chatId);
  if (!chat || !isPlaceholderChatName(chat.name)) return false;
  const trimmed = title.trim();
  if (!trimmed) return false;
  chat.name = trimmed;
  return true;
}
