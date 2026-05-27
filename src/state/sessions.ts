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
import { decodeModelSelectKey } from '../lib/model-select-key';
import {
  getChatLastMessageAt,
  getChatsForWorkspace as filterChatsForWorkspace,
  getUnassignedChats as filterUnassignedChats,
  migrateSessionStateV1ToV2 as migrateSessionJsonToV2,
  resolveActiveChatIdForWorkspace as pickActiveChatIdForWorkspace,
  type RawSessionJson,
} from './session-workspace-scope';
import { setStatus } from '../ui/status';
import { ensureTokenLedger } from '../usage/token-ledger';
import { getWorkspacePath } from './workspace';
const GENERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Normalize persisted backend generation id (invalid values are dropped). */
function ensureCurrentGenerationId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim();
  return GENERATION_ID_RE.test(id) ? id : undefined;
}

/**
 * Drop generation ids that cannot still be in-flight (finished assistant already saved).
 */
export function clearStaleGenerationIdsOnLoad(chats: Chat[]): void {
  for (const chat of chats) {
    const id = ensureCurrentGenerationId(chat.currentGenerationId);
    if (!id) {
      if (chat.currentGenerationId != null) {
        delete chat.currentGenerationId;
      }
      continue;
    }
    chat.currentGenerationId = id;
    const last = chat.history[chat.history.length - 1];
    if (last?.role === 'assistant') {
      const text = typeof last.content === 'string' ? last.content.trim() : '';
      if (text.length > 0) {
        delete chat.currentGenerationId;
      }
    }
  }
}
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
  TurnRunRecord,
  TurnRunStatus,
  TurnSnapshot,
} from '../types';

const TURN_RUN_STATUSES = new Set<TurnRunStatus>([
  'running',
  'completed',
  'stopped',
  'failed',
  'superseded',
]);

function ensureTurnSnapshot(raw: unknown): TurnSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<TurnSnapshot>;
  if (typeof row.forkHistoryIndex !== 'number' || !Number.isFinite(row.forkHistoryIndex)) {
    return null;
  }
  if (typeof row.userContent !== 'string') return null;
  if (typeof row.providerId !== 'string' || typeof row.modelId !== 'string') return null;
  if (typeof row.composedSystemPrompt !== 'string') return null;
  if (!Array.isArray(row.enabledToolNames)) return null;
  return {
    forkHistoryIndex: row.forkHistoryIndex,
    userContent: row.userContent,
    skillId: typeof row.skillId === 'string' ? row.skillId : null,
    providerId: row.providerId,
    modelId: row.modelId,
    temperature: typeof row.temperature === 'number' ? row.temperature : 0.7,
    maxTokens: typeof row.maxTokens === 'number' ? row.maxTokens : 4096,
    modeId: normalizeModeId(row.modeId),
    workAgentId:
      typeof row.workAgentId === 'string' && row.workAgentId.trim()
        ? row.workAgentId.trim()
        : null,
    workAgentAuto: row.workAgentAuto !== false,
    ...(row.expertSelection && typeof row.expertSelection === 'object'
      ? { expertSelection: ensureExpertSelection(row.expertSelection) }
      : {}),
    ...(row.uiDesignerMode === 'plan' || row.uiDesignerMode === 'implement'
      ? { uiDesignerMode: row.uiDesignerMode }
      : {}),
    composedSystemPrompt: row.composedSystemPrompt,
    ...(typeof row.userRulesContent === 'string'
      ? { userRulesContent: row.userRulesContent }
      : {}),
    enabledToolNames: row.enabledToolNames.filter((n) => typeof n === 'string'),
    maxToolTurns: typeof row.maxToolTurns === 'number' ? row.maxToolTurns : 25,
    historyPrefixHash:
      typeof row.historyPrefixHash === 'string' ? row.historyPrefixHash : '',
    ...(typeof row.orchestratePlanPath === 'string'
      ? { orchestratePlanPath: row.orchestratePlanPath }
      : {}),
  };
}

function ensureTurnRuns(raw: unknown): TurnRunRecord[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: TurnRunRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<TurnRunRecord>;
    const snapshot = ensureTurnSnapshot(row.snapshot);
    const runId = typeof row.runId === 'string' ? row.runId.trim() : '';
    const branchId = typeof row.branchId === 'string' ? row.branchId.trim() : '';
    const status =
      typeof row.status === 'string' && TURN_RUN_STATUSES.has(row.status as TurnRunStatus)
        ? (row.status as TurnRunStatus)
        : null;
    if (!runId || !branchId || !snapshot || !status) continue;
    out.push({
      runId,
      branchId,
      forkHistoryIndex: snapshot.forkHistoryIndex,
      ...(typeof row.parentRunId === 'string' ? { parentRunId: row.parentRunId } : {}),
      status,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      ...(typeof row.endedAt === 'number' ? { endedAt: row.endedAt } : {}),
      snapshot,
      ...(typeof row.outputHistoryStart === 'number'
        ? { outputHistoryStart: row.outputHistoryStart }
        : {}),
      ...(typeof row.outputHistoryEnd === 'number'
        ? { outputHistoryEnd: row.outputHistoryEnd }
        : {}),
      ...(Array.isArray(row.outputMessages)
        ? {
            outputMessages: row.outputMessages
              .map((m) => ensureMessageEntry(m))
              .filter((m): m is Message => Boolean(m)),
          }
        : {}),
      ...(Array.isArray(row.generationIds)
        ? { generationIds: row.generationIds.filter((g) => typeof g === 'string') }
        : {}),
      ...(typeof row.parentTurnId === 'string' ? { parentTurnId: row.parentTurnId } : {}),
    });
  }
  return out.length ? out : undefined;
}

function ensureActiveBranchByFork(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === 'string' && typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  }
  return Object.keys(out).length ? out : undefined;
}

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
    lastMessageAt: Date.now(),
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
  const lastRunId =
    typeof r.lastRunId === 'string' && r.lastRunId.trim()
      ? r.lastRunId.trim()
      : undefined;
  const runHistory: string[] = [];
  if (Array.isArray(r.runHistory)) {
    for (const item of r.runHistory) {
      if (typeof item === 'string' && item.trim()) {
        const id = item.trim();
        if (!runHistory.includes(id)) runHistory.push(id);
      }
    }
  }
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
    ...(lastRunId ? { lastRunId } : {}),
    ...(runHistory.length ? { runHistory } : {}),
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
  const timerAccumulatedMs =
    typeof r.timerAccumulatedMs === 'number' ? r.timerAccumulatedMs : undefined;
  const timerSegmentStartedAt =
    typeof r.timerSegmentStartedAt === 'number' ? r.timerSegmentStartedAt : undefined;
  return {
    planPath,
    tasks,
    waves,
    startedAt,
    lastUpdatedAt,
    ...(activeParentTurnId ? { activeParentTurnId } : {}),
    ...(timerAccumulatedMs !== undefined ? { timerAccumulatedMs } : {}),
    ...(timerSegmentStartedAt !== undefined ? { timerSegmentStartedAt } : {}),
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
  const currentGenerationId = ensureCurrentGenerationId(raw.currentGenerationId);
  const workspacePath =
    typeof raw.workspacePath === 'string'
      ? normalizeWorkspacePath(raw.workspacePath)
      : '';
  const orchestratePlanPath = normalizeOrchestratePlanPath(raw.orchestratePlanPath);
  const orchestrateBoard = ensureOrchestrateBoard(raw.orchestrateBoard);
  const runs = ensureTurnRuns(raw.runs);
  const activeBranchByFork = ensureActiveBranchByFork(raw.activeBranchByFork);
  let viewMode = ensureViewMode(raw.viewMode);
  if (raw.modeId === 'debug' && viewMode === 'board') {
    viewMode = 'chat';
  }
  const chat: Chat = {
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
    ...(runs ? { runs } : {}),
    ...(activeBranchByFork ? { activeBranchByFork } : {}),
    ...(currentGenerationId ? { currentGenerationId } : {}),
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
    lastMessageAt:
      typeof raw.lastMessageAt === 'number'
        ? raw.lastMessageAt
        : typeof raw.updatedAt === 'number'
          ? raw.updatedAt
          : Date.now(),
    ...(raw.tokenLedger && typeof raw.tokenLedger === 'object'
      ? { tokenLedger: raw.tokenLedger }
      : {}),
    ...(raw.kind === 'expert-lab' ? { kind: 'expert-lab' as const } : {}),
  };
  ensureTokenLedger(chat);
  return chat;
}

/** Stable id for the hidden Expert Lab session chat. */
export const EXPERT_LAB_CHAT_ID = 'minnow-expert-lab';

export function isExpertLabChat(chat: Chat): boolean {
  return chat.kind === 'expert-lab' || chat.id === EXPERT_LAB_CHAT_ID;
}

/** Ensure the persistent hidden Expert Lab chat exists in session state. */
export function ensureExpertLabChat(modelId = ''): Chat {
  const state = requireSessionState();
  let chat = state.chats.find((c) => isExpertLabChat(c));
  if (!chat) {
    const rawModel =
      modelId ||
      (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value ||
      state.chats.find((c) => !isExpertLabChat(c))?.modelId ||
      '';
    const parsed = decodeModelSelectKey(rawModel);
    const resolvedModel = (parsed?.modelId ?? rawModel).trim();
    chat = createEmptyChatObject(resolvedModel, getWorkspacePath());
    if (parsed?.providerId) chat.providerId = parsed.providerId;
    chat.id = EXPERT_LAB_CHAT_ID;
    chat.kind = 'expert-lab';
    chat.name = 'Expert Lab';
    chat.expertSelection = defaultExpertSelection();
    state.chats.push(chat);
    touchChat(chat);
  }
  return chat;
}

/** Clear Expert Lab chat history before a new run. */
export function resetExpertLabChatHistory(): void {
  const chat = ensureExpertLabChat();
  chat.history = [];
  chat.lastStats = null;
  chat.modelInfo = {};
  chat.currentGenerationId = undefined;
  chat.lastResolvedExpertId = null;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Switch active chat to Expert Lab; returns the previous active id for restore. */
export function activateExpertLabChat(): string {
  const state = requireSessionState();
  const previousId = state.activeId;
  const chat = ensureExpertLabChat();
  state.activeId = chat.id;
  scheduleSaveSessions();
  return previousId;
}

/** Restore sidebar active chat after leaving Expert Lab. */
export function restoreActiveChatAfterExpertLab(previousId: string): void {
  const state = requireSessionState();
  const fallback = state.chats.find((c) => !isExpertLabChat(c))?.id;
  const nextId =
    previousId && state.chats.some((c) => c.id === previousId && !isExpertLabChat(c))
      ? previousId
      : fallback;
  if (nextId) {
    state.activeId = nextId;
    scheduleSaveSessions();
  }
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
  clearStaleGenerationIdsOnLoad(state.chats);
  return state;
}

function parseSessionStateFromJson(parsed: RawSessionJson | null): SessionState {
  if (!parsed || !Array.isArray(parsed.chats)) {
    return defaultSessionState();
  }
  const ver = parsed.version;
  if (ver !== 1 && ver !== 2 && ver !== 3) {
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

/**
 * Resolve a chat by id when session state is available.
 * Returns undefined when sessions are not loaded yet (e.g. tests, early boot) so callers
 * can fall back instead of throwing from requireSessionState().
 */
export function findChatById(chatId: string): Chat | undefined {
  if (!sessionState) return undefined;
  return sessionState.chats.find((c) => c.id === chatId);
}

/** Chats ordered newest-first for sidebar display (by last committed message). */
export function getChatsSortedByUpdatedDesc(): Chat[] {
  return [...requireSessionState().chats].sort(
    (a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a),
  );
}

export function getActiveChat(): Chat {
  const state = requireSessionState();
  const c = state.chats.find((x) => x.id === state.activeId);
  return c || state.chats[0];
}

export function touchChat(chat: Chat): void {
  chat.updatedAt = Date.now();
}

/** Bump sidebar sort time when user or assistant history is committed. */
export function recordChatMessage(chat: Chat): void {
  const now = Date.now();
  chat.lastMessageAt = now;
  chat.updatedAt = now;
}

function trimChatsIfNeeded(): void {
  const state = sessionState;
  if (!state || state.chats.length <= MAX_CHATS) return;
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

/** Run any debounced session save immediately (unit tests only). */
export function flushScheduledSessionSaveForTests(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  setSaveTimer(null);
  saveSessionsNow();
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
