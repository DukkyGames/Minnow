import { PLACEHOLDER_CHAT_NAME, SAVE_DEBOUNCE_MS, STORAGE_KEY } from '../constants';
import { abortChatTitleGeneration } from '../chat/titles/inflight';
import { cleanupChatWorktreeOnDelete } from './chat-worktree';
import { isPlaceholderChatName } from '../chat/titles/placeholder';
import { setSaveTimer, saveTimer } from '../app-state';
import { getSessions, putSessions, putSessionsKeepalive } from '../config/api-client';
import { defaultSessionState } from '../config/defaults';
import { randomUUID } from '../lib/random-id.ts';
import { isServerStorageMode } from '../config/storage-mode';
import { DEFAULT_MODE_ID, isModeId, normalizeModeId } from '../chat/modes/types';
import { normalizeThinkingTriState } from '../agents/thinking-types';
import { normalizeOrchestratePlanPath } from '../chat/orchestrate/plan-path';
import { syncOrchestratorPlannerChatTitle } from '../chat/orchestrate/planner-chat-title';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import { ensurePendingMessageQueue } from '../chat/message-queue';
import { notifySessionCreated } from '../webhooks/client';
import { decodeModelSelectKey } from '../lib/model-select-key';
import { isSuperPlanStageId, type SuperPlanStageId, type SuperPlanState } from '../chat/super-plan/types';
import {
  CHAT_APP_ID,
  DESKTOP_APP_ID,
  EMAIL_APP_ID,
  createAssistantChat,
  createDesktopChat,
  createEmailAssistantChat,
  getAssistantChats as filterAssistantChats,
  getChatsForChatsWorkspace as filterChatsForChatsWorkspace,
  getEmailAssistantChats as filterEmailAssistantChats,
  getListedEmailAssistantChats as filterListedEmailAssistantChats,
  getChatLastMessageAt,
  getChatsForWorkspace as filterChatsForWorkspace,
  getSidebarListedChatsForWorkspace as filterSidebarListedChatsForWorkspace,
  getLastActiveChatIdForApp,
  getUnassignedChats as filterUnassignedChats,
  isEphemeralEmptyChat,
  isSidebarListedChat,
  pruneEphemeralEmptyChats,
  formatDraftChatSidebarName,
  migrateSessionStateV1ToV2 as migrateSessionJsonToV2,
  rememberActiveChatForApp as rememberActiveChatForAppInState,
  resolveActiveAssistantChatId,
  resolveActiveEmailAssistantChatId,
  resolveActiveChatIdForWorkspace as pickActiveChatIdForWorkspace,
  type RawSessionJson,
} from './session-workspace-scope';
import { getForegroundAppId } from '../os/instances';
import { isChatAppForeground, shouldPaintDesktopChatSurface } from '../ui/chat-mount';
import { setStatus } from '../ui/status';
import { ensureTokenLedger } from '../usage/token-ledger';
import { getWorkspacePath } from './workspace';
import { MAX_GOAL_CONDITION_CHARS } from '../chat/goal/parse-command';
import {
  INITIAL_LOOP_AUTO_DELAY_MS,
  MAX_LOOP_PROMPT_CHARS,
  MIN_LOOP_INTERVAL_MS,
} from '../chat/loop/parse-command';
import { ensurePinnedSkill } from '../skills/pinned-skill';
import { resolveActiveWorkAgent } from '../agents/resolve-work-agent';
import { cleanupChatArchiveOnDelete } from '../chat/archive/cleanup';
import { normalizeCodeChangePayload } from '../usage/code-change-payload';
import { resolveChatWorktreeRoot } from './worktree-isolation';
import {
  ensureChatCodeChangeBackfillOnSwitch,
  runSessionCodeChangeBackfill,
} from '../usage/code-change-backfill';
import type { ExpertChatSeed } from '../chat/experts/runtime-profile';
import type { ExpertRuntimeSnapshot } from '../chat/experts/types';
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
  BoardLogDetail,
  BoardLogEvent,
  BoardLogEventType,
  BoardLogLevel,
  BoardTask,
  BoardTaskStatus,
  BoardWave,
  ActiveGoalState,
  ActiveLoopState,
  Chat,
  ChatGroup,
  ChatTodo,
  ExpertSelection,
  Message,
  OrchestrateBoardState,
  PersistedSubAgentRun,
  PersistedSubAgentStatus,
  ReasoningEffortOption,
  SessionState,
  TerminalRunRecord,
  ToolCall,
  ToolResultMessage,
  TurnRunRecord,
  TurnRunStatus,
  TurnSnapshot,
  UserMessage,
} from '../types';

const REASONING_EFFORT_OPTIONS = new Set<ReasoningEffortOption>([
  'off',
  'on',
  'low',
  'medium',
  'high',
]);

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
    thinkingMode:
      row.thinkingMode === 'on' || row.thinkingMode === 'off' ? row.thinkingMode : 'on',
    ...(row.reasoningEffort === 'off' ||
    row.reasoningEffort === 'on' ||
    row.reasoningEffort === 'low' ||
    row.reasoningEffort === 'medium' ||
    row.reasoningEffort === 'high'
      ? { reasoningEffort: row.reasoningEffort }
      : {}),
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
      ...(row.stopReason === 'user' ||
      row.stopReason === 'timeout' ||
      row.stopReason === 'system'
        ? { stopReason: row.stopReason }
        : {}),
      ...(row.endReason === 'max_tool_turns' ? { endReason: row.endReason } : {}),
      ...(typeof row.errorMessage === 'string' && row.errorMessage.trim()
        ? { errorMessage: row.errorMessage.trim() }
        : {}),
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

/** @deprecated Legacy default — expert chats use chat.expertId directly. */
export function defaultExpertSelection(): ExpertSelection {
  return { mode: 'manual', expertId: null };
}

function ensureExpertSelection(raw: unknown): ExpertSelection | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Partial<ExpertSelection>;
  const mode = row.mode === 'manual' ? 'manual' : 'auto';
  const expertId =
    mode === 'manual' && typeof row.expertId === 'string' && row.expertId.trim()
      ? row.expertId.trim()
      : null;
  return { mode, expertId };
}

function ensureExpertRuntime(raw: unknown): ExpertRuntimeSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Partial<ExpertRuntimeSnapshot>;
  const modelId = typeof row.modelId === 'string' ? row.modelId : '';
  const modeId = normalizeModeId(row.modeId);
  const toolDenylist = Array.isArray(row.toolDenylist)
    ? row.toolDenylist.filter((t): t is string => typeof t === 'string')
    : [];
  const enabledToolNames = Array.isArray(row.enabledToolNames)
    ? row.enabledToolNames.filter((t): t is string => typeof t === 'string')
    : [];
  const warnings = Array.isArray(row.warnings)
    ? row.warnings.filter((t): t is string => typeof t === 'string')
    : [];
  const toolAllowlist =
    row.toolAllowlist === null
      ? null
      : Array.isArray(row.toolAllowlist)
        ? row.toolAllowlist.filter((t): t is string => typeof t === 'string')
        : null;
  return {
    ...(typeof row.providerId === 'string' && row.providerId.trim()
      ? { providerId: row.providerId.trim() }
      : {}),
    modelId,
    modeId,
    toolAllowlist,
    toolDenylist,
    enabledToolNames,
    memoryEnabled: row.memoryEnabled !== false,
    warnings,
    profileSource: row.profileSource === 'override' ? 'override' : 'inherit',
  };
}

/** In-memory session blob mirrored to ~/.minnow or localStorage fallback. */
export let sessionState: SessionState | null = null;

/**
 * Set after a successful GET from ~/.minnow. Blocks PUT until hydration so a boot-time
 * localStorage fallback cannot clobber on-disk sessions (MIN-408).
 */
let sessionsHydratedFromServer = false;

let sessionPersistenceShutdownRegistered = false;

/** Resolves once `loadSessionsFromStorage()` has populated `sessionState`. */
let resolveSessionsReady: () => void = () => undefined;
export const sessionsReady: Promise<void> = new Promise((resolve) => {
  resolveSessionsReady = resolve;
});

/** No-op when sessions are already loaded; otherwise waits for boot `initApp`. */
export async function ensureSessionsReady(): Promise<void> {
  if (sessionState) return;
  await sessionsReady;
}

function markSessionsReady(): void {
  resolveSessionsReady();
}

/** Replace in-memory session blob (unit tests). */
export function setSessionStateForTests(state: SessionState | null): void {
  sessionState = state;
  if (state) {
    markSessionsReady();
    sessionsHydratedFromServer = true;
  } else {
    sessionsHydratedFromServer = false;
  }
}

/** Reset persistence guards between unit tests. */
export function resetSessionPersistenceForTests(): void {
  sessionsHydratedFromServer = false;
  sessionPersistenceShutdownRegistered = false;
}

/** Expose hydration guard for persistence unit tests. */
export function isSessionsHydratedFromServerForTests(): boolean {
  return sessionsHydratedFromServer;
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
  return randomUUID();
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
    const codeChange = normalizeCodeChangePayload(toolMsg.codeChange);
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      content,
      ...(attachments?.length ? { attachments } : {}),
      ...(codeChange ? { codeChange } : {}),
    };
  }

  if (m.role === 'user') {
    const content = m.content != null ? String(m.content) : '';
    const user = m as Partial<UserMessage>;
    let superPlanStage: SuperPlanStageId | undefined;
    if (typeof user.superPlanStage === 'string') {
      const candidate = user.superPlanStage.trim();
      if (isSuperPlanStageId(candidate)) {
        superPlanStage = candidate;
      }
    }
    return {
      role: 'user',
      content,
      ...(user.steer === true ? { steer: true } : {}),
      ...(user.goalAchieved === true ? { goalAchieved: true } : {}),
      ...(superPlanStage ? { superPlanStage } : {}),
    };
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
  'merging',
  'complete',
  'failed',
  'blocked',
  'quarantined',
]);

const BOARD_CATEGORIES = new Set<BoardCategory>(['build', 'fix', 'test', 'research']);

/** Keep in sync with {@link BOARD_LOG_MAX} in orchestrate-board-store and server validators. */
const BOARD_LOG_MAX = 100;
const BOARD_LOG_LEVELS = new Set<BoardLogLevel>(['info', 'warn', 'error']);
const BOARD_LOG_TYPES = new Set<BoardLogEventType>([
  'board_init',
  'mode_change',
  'auto_start',
  'auto_stop',
  'task_status',
  'task_started',
  'build_verdict',
  'test_verdict',
  'merge_result',
  'worktree_allocated',
  'task_retry',
  'task_error',
  'tool_call',
  'terminal_run',
  'dev_server',
  'final_test_started',
  'final_test_verdict',
]);
const BOARD_LOG_DETAIL_STRING_KEYS = new Set<keyof BoardLogDetail>([
  'branch',
  'toolName',
  'argsPreview',
  'resultPreview',
  'command',
  'runId',
  'chatId',
  'error',
  'summary',
]);
const BOARD_LOG_DETAIL_NUMBER_KEYS = new Set<keyof BoardLogDetail>([
  'attempt',
  'devPort',
  'apiPort',
  'exitCode',
]);
const BOARD_LOG_DETAIL_STATUS_KEYS = new Set<keyof BoardLogDetail>(['from', 'to']);
const BOARD_LOG_DETAIL_ENUMS: Record<string, Set<string>> = {
  verdict: new Set(['pass', 'fail']),
  attemptKind: new Set(['build', 'test', 'fixer']),
  mode: new Set(['manual', 'auto', 'sequential', 'afk']),
  outcome: new Set(['merged', 'conflict', 'error', 'skipped']),
};
const BOARD_LOG_STRING_MAX = 2000;

function truncateBoardLogString(value: string, max = BOARD_LOG_STRING_MAX): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function ensureBoardLogDetail(raw: unknown): BoardLogDetail | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: BoardLogDetail = {};
  for (const key of BOARD_LOG_DETAIL_STRING_KEYS) {
    if (typeof r[key] === 'string' && (r[key] as string).trim()) {
      (out as Record<string, string>)[key] = truncateBoardLogString(r[key] as string);
    }
  }
  for (const key of BOARD_LOG_DETAIL_NUMBER_KEYS) {
    if (typeof r[key] === 'number' && Number.isFinite(r[key])) {
      (out as Record<string, number>)[key] = r[key] as number;
    }
  }
  for (const key of BOARD_LOG_DETAIL_STATUS_KEYS) {
    const val = typeof r[key] === 'string' ? r[key] : '';
    if (BOARD_TASK_STATUSES.has(val as BoardTaskStatus)) {
      (out as Record<string, BoardTaskStatus>)[key] = val as BoardTaskStatus;
    }
  }
  for (const [key, allowed] of Object.entries(BOARD_LOG_DETAIL_ENUMS)) {
    if (typeof r[key] === 'string' && allowed.has(r[key] as string)) {
      (out as Record<string, string>)[key] = r[key] as string;
    }
  }
  if (Array.isArray(r.failingTaskIds)) {
    const failingTaskIds: string[] = [];
    for (const item of r.failingTaskIds) {
      if (typeof item === 'string' && item.trim()) failingTaskIds.push(item.trim());
    }
    if (failingTaskIds.length) out.failingTaskIds = failingTaskIds;
  }
  return Object.keys(out).length ? out : undefined;
}

function ensureBoardLogEvent(raw: unknown): BoardLogEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const ts = typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : null;
  const typeRaw = typeof r.type === 'string' ? r.type.trim() : '';
  if (!id || ts === null || !BOARD_LOG_TYPES.has(typeRaw as BoardLogEventType)) return null;
  const levelRaw = typeof r.level === 'string' ? r.level.trim() : 'info';
  const level = BOARD_LOG_LEVELS.has(levelRaw as BoardLogLevel)
    ? (levelRaw as BoardLogLevel)
    : 'info';
  const message =
    typeof r.message === 'string' ? truncateBoardLogString(r.message, BOARD_LOG_STRING_MAX) : '';
  const out: BoardLogEvent = {
    id,
    ts,
    type: typeRaw as BoardLogEventType,
    level,
    message,
  };
  if (typeof r.taskId === 'string' && r.taskId.trim()) {
    out.taskId = r.taskId.trim();
  }
  const detail = ensureBoardLogDetail(r.detail);
  if (detail) out.detail = detail;
  return out;
}

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
  const chatId =
    typeof r.chatId === 'string' && r.chatId.trim() ? r.chatId.trim() : undefined;
  const testChatId =
    typeof r.testChatId === 'string' && r.testChatId.trim() ? r.testChatId.trim() : undefined;
  const fixerChatId =
    typeof r.fixerChatId === 'string' && r.fixerChatId.trim() ? r.fixerChatId.trim() : undefined;
  const buildSpec =
    typeof r.buildSpec === 'string' && r.buildSpec.trim() ? r.buildSpec.trim() : undefined;
  const testSpec =
    typeof r.testSpec === 'string' && r.testSpec.trim() ? r.testSpec.trim() : undefined;
  const dependsOn: string[] = [];
  if (Array.isArray(r.dependsOn)) {
    for (const item of r.dependsOn) {
      if (typeof item === 'string' && item.trim()) dependsOn.push(item.trim());
    }
  }
  const testAttempts =
    typeof r.testAttempts === 'number' && Number.isFinite(r.testAttempts)
      ? r.testAttempts
      : undefined;
  const buildAttempts =
    typeof r.buildAttempts === 'number' && Number.isFinite(r.buildAttempts)
      ? r.buildAttempts
      : undefined;
  const fixerAttempts =
    typeof r.fixerAttempts === 'number' && Number.isFinite(r.fixerAttempts)
      ? r.fixerAttempts
      : undefined;
  const mergePreSha =
    typeof r.mergePreSha === 'string' && r.mergePreSha.trim() ? r.mergePreSha.trim() : undefined;
  const testVerdict =
    r.testVerdict === 'pass' || r.testVerdict === 'fail' ? r.testVerdict : undefined;
  const testSummary =
    typeof r.testSummary === 'string' && r.testSummary.trim()
      ? r.testSummary.trim()
      : undefined;
  let prevFailure: BoardTask['prevFailure'];
  if (r.prevFailure && typeof r.prevFailure === 'object') {
    const pf = r.prevFailure as Record<string, unknown>;
    const at = typeof pf.at === 'number' && Number.isFinite(pf.at) ? pf.at : undefined;
    if (at != null) {
      const pfError =
        typeof pf.error === 'string' && pf.error.trim() ? pf.error.trim() : undefined;
      const pfSummary =
        typeof pf.testSummary === 'string' && pf.testSummary.trim()
          ? pf.testSummary.trim()
          : undefined;
      const pfVerdict =
        pf.testVerdict === 'pass' || pf.testVerdict === 'fail' ? pf.testVerdict : undefined;
      prevFailure = {
        at,
        ...(pfError ? { error: pfError } : {}),
        ...(pfSummary ? { testSummary: pfSummary } : {}),
        ...(pfVerdict ? { testVerdict: pfVerdict } : {}),
      };
    }
  }
  const pendingBuildSeed =
    typeof r.pendingBuildSeed === 'string' && r.pendingBuildSeed.trim()
      ? r.pendingBuildSeed.trim()
      : undefined;
  const worktreePath =
    typeof r.worktreePath === 'string' && r.worktreePath.trim()
      ? r.worktreePath.trim()
      : undefined;
  const worktreeBranch =
    typeof r.worktreeBranch === 'string' && r.worktreeBranch.trim()
      ? r.worktreeBranch.trim()
      : undefined;
  const devPort =
    typeof r.devPort === 'number' && Number.isFinite(r.devPort) ? r.devPort : undefined;
  const apiPort =
    typeof r.apiPort === 'number' && Number.isFinite(r.apiPort) ? r.apiPort : undefined;
  const stopRetries =
    typeof r.stopRetries === 'number' && Number.isFinite(r.stopRetries)
      ? r.stopRetries
      : undefined;
  const lifecycleRun =
    typeof r.lifecycleRun === 'number' && Number.isFinite(r.lifecycleRun) && r.lifecycleRun >= 0
      ? r.lifecycleRun
      : undefined;
  let quarantine: BoardTask['quarantine'];
  if (r.quarantine && typeof r.quarantine === 'object') {
    const q = r.quarantine as Record<string, unknown>;
    const QUARANTINE_CATEGORIES = new Set(['infra', 'code', 'merge', 'stall', 'unknown']);
    const qCategory =
      typeof q.category === 'string' && QUARANTINE_CATEGORIES.has(q.category)
        ? (q.category as NonNullable<BoardTask['quarantine']>['category'])
        : null;
    const summary = typeof q.summary === 'string' ? q.summary : null;
    const at = typeof q.at === 'number' && Number.isFinite(q.at) ? q.at : null;
    if (qCategory && summary !== null && at !== null) {
      const resolutionSteps: string[] = [];
      if (Array.isArray(q.resolutionSteps)) {
        for (const step of q.resolutionSteps) {
          if (typeof step === 'string') resolutionSteps.push(step);
        }
      }
      quarantine = {
        category: qCategory,
        summary,
        resolutionSteps,
        at,
        ...(typeof q.logRef === 'string' && q.logRef.trim() ? { logRef: q.logRef.trim() } : {}),
      };
    }
  }
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
    ...(chatId ? { chatId } : {}),
    ...(testChatId ? { testChatId } : {}),
    ...(fixerChatId ? { fixerChatId } : {}),
    ...(buildSpec ? { buildSpec } : {}),
    ...(testSpec ? { testSpec } : {}),
    ...(dependsOn.length ? { dependsOn } : {}),
    ...(testAttempts !== undefined ? { testAttempts } : {}),
    ...(buildAttempts !== undefined ? { buildAttempts } : {}),
    ...(fixerAttempts !== undefined ? { fixerAttempts } : {}),
    ...(mergePreSha ? { mergePreSha } : {}),
    ...(testVerdict ? { testVerdict } : {}),
    ...(testSummary ? { testSummary } : {}),
    ...(prevFailure ? { prevFailure } : {}),
    ...(pendingBuildSeed ? { pendingBuildSeed } : {}),
    ...(worktreePath ? { worktreePath } : {}),
    ...(worktreeBranch ? { worktreeBranch } : {}),
    ...(devPort !== undefined ? { devPort } : {}),
    ...(apiPort !== undefined ? { apiPort } : {}),
    ...(stopRetries !== undefined ? { stopRetries } : {}),
    ...(lifecycleRun !== undefined ? { lifecycleRun } : {}),
    ...(quarantine ? { quarantine } : {}),
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
      ...(w.collapsed === true ? { collapsed: true } : {}),
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
  const maxConcurrentTasks =
    typeof r.maxConcurrentTasks === 'number' && r.maxConcurrentTasks > 0
      ? r.maxConcurrentTasks
      : undefined;
  const completionShownAt =
    typeof r.completionShownAt === 'number' ? r.completionShownAt : undefined;
  const terminalBlocked = r.terminalBlocked === true ? true : undefined;
  const executionModeRaw =
    typeof r.executionMode === 'string' ? r.executionMode.trim() : '';
  const executionMode =
    executionModeRaw === 'auto' ||
    executionModeRaw === 'manual' ||
    executionModeRaw === 'sequential' ||
    executionModeRaw === 'afk'
      ? executionModeRaw
      : 'manual';
  const finalTest = ensureOrchestrateFinalTest(r.finalTest);
  let log: BoardLogEvent[] | undefined;
  if (Array.isArray(r.log)) {
    const parsed: BoardLogEvent[] = [];
    for (const item of r.log) {
      const event = ensureBoardLogEvent(item);
      if (event) parsed.push(event);
    }
    if (parsed.length) log = parsed.slice(-BOARD_LOG_MAX);
  }
  return {
    planPath,
    tasks,
    waves,
    startedAt,
    lastUpdatedAt,
    executionMode,
    ...(r.autoRunning === true ? { autoRunning: true } : {}),
    ...(r.pendingAfk === true ? { pendingAfk: true } : {}),
    ...(activeParentTurnId ? { activeParentTurnId } : {}),
    ...(timerAccumulatedMs !== undefined ? { timerAccumulatedMs } : {}),
    ...(timerSegmentStartedAt !== undefined ? { timerSegmentStartedAt } : {}),
    ...(maxConcurrentTasks !== undefined ? { maxConcurrentTasks } : {}),
    ...(completionShownAt !== undefined ? { completionShownAt } : {}),
    ...(terminalBlocked ? { terminalBlocked } : {}),
    ...(r.dashboardDismissed === true ? { dashboardDismissed: true } : {}),
    ...(typeof r.integrationLandedAt === 'number' ? { integrationLandedAt: r.integrationLandedAt } : {}),
    ...(typeof r.worktreesClearedAt === 'number' ? { worktreesClearedAt: r.worktreesClearedAt } : {}),
    ...(typeof r.finishReport === 'string' && r.finishReport.trim()
      ? { finishReport: r.finishReport.trim() }
      : {}),
    ...(finalTest ? { finalTest } : {}),
    ...(typeof r.isolationMode === 'string' &&
    (r.isolationMode === 'off' ||
      r.isolationMode === 'per-task' ||
      r.isolationMode === 'per-wave')
      ? { isolationMode: r.isolationMode }
      : {}),
    ...(typeof r.integrationBranch === 'string' && r.integrationBranch.trim()
      ? { integrationBranch: r.integrationBranch.trim() }
      : {}),
    ...(r.userStopped === true ? { userStopped: true } : {}),
    ...(r.systemPaused === true ? { systemPaused: true } : {}),
    ...(typeof r.isolationBaseRef === 'string' && r.isolationBaseRef.trim()
      ? { isolationBaseRef: r.isolationBaseRef.trim() }
      : {}),
    ...(log ? { log } : {}),
    ...(() => {
      if (!Array.isArray(r.unresolvedIssues)) return {};
      const UNRESOLVED_ISSUES_MAX = 200;
      const issues = [];
      for (const item of r.unresolvedIssues) {
        if (!item || typeof item !== 'object') continue;
        const u = item as Record<string, unknown>;
        if (
          typeof u.taskId === 'string' && u.taskId.trim() &&
          typeof u.title === 'string' &&
          typeof u.category === 'string' &&
          typeof u.summary === 'string' &&
          Array.isArray(u.resolutionSteps) &&
          typeof u.createdAt === 'number'
        ) {
          issues.push({
            taskId: u.taskId.trim(),
            title: typeof u.title === 'string' ? u.title : '',
            category: u.category as 'infra' | 'code' | 'merge' | 'stall',
            summary: typeof u.summary === 'string' ? u.summary : '',
            resolutionSteps: (u.resolutionSteps as unknown[]).filter((s): s is string => typeof s === 'string'),
            ...(typeof u.logRef === 'string' && u.logRef.trim() ? { logRef: u.logRef.trim() } : {}),
            createdAt: u.createdAt as number,
            ...(typeof u.attempts === 'number' ? { attempts: u.attempts } : {}),
          });
        }
      }
      if (!issues.length) return {};
      return { unresolvedIssues: issues.slice(-UNRESOLVED_ISSUES_MAX) };
    })(),
  };
}

function ensureOrchestrateFinalTest(
  raw: unknown,
): OrchestrateBoardState['finalTest'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const statusRaw = typeof r.status === 'string' ? r.status.trim() : '';
  const status =
    statusRaw === 'pending' ||
    statusRaw === 'in_progress' ||
    statusRaw === 'passed' ||
    statusRaw === 'failed'
      ? statusRaw
      : undefined;
  if (!status) return undefined;
  const chatId =
    typeof r.chatId === 'string' && r.chatId.trim() ? r.chatId.trim() : undefined;
  const attempts = typeof r.attempts === 'number' ? r.attempts : undefined;
  const recordedVerdict =
    r.recordedVerdict === 'pass' || r.recordedVerdict === 'fail'
      ? r.recordedVerdict
      : undefined;
  const failingTaskIds: string[] = [];
  if (Array.isArray(r.failingTaskIds)) {
    for (const item of r.failingTaskIds) {
      if (typeof item === 'string' && item.trim()) failingTaskIds.push(item.trim());
    }
  }
  const summary = typeof r.summary === 'string' ? r.summary : undefined;
  return {
    status,
    ...(chatId ? { chatId } : {}),
    ...(attempts !== undefined ? { attempts } : {}),
    ...(recordedVerdict ? { recordedVerdict } : {}),
    ...(failingTaskIds.length ? { failingTaskIds } : {}),
    ...(summary ? { summary } : {}),
  };
}

function ensureChatGroup(raw: unknown): ChatGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  const workspacePath =
    typeof r.workspacePath === 'string'
      ? normalizeWorkspacePath(r.workspacePath)
      : '';
  if (!id || !name) return null;
  const orchestrateBoard = ensureOrchestrateBoard(r.orchestrateBoard);
  const orchestratePlanPath = normalizeOrchestratePlanPath(r.orchestratePlanPath);
  const viewMode = ensureViewMode(r.viewMode);
  const plannerChatId =
    typeof r.plannerChatId === 'string' && r.plannerChatId.trim()
      ? r.plannerChatId.trim()
      : undefined;
  return {
    id,
    name,
    workspacePath,
    collapsed: r.collapsed === true,
    order: typeof r.order === 'number' ? r.order : 0,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    ...(orchestrateBoard ? { orchestrateBoard } : {}),
    ...(orchestratePlanPath ? { orchestratePlanPath } : {}),
    ...(viewMode ? { viewMode } : {}),
    ...(plannerChatId ? { plannerChatId } : {}),
  };
}

function ensureGroupsFromRaw(raw: unknown): ChatGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatGroup[] = [];
  for (const item of raw) {
    const group = ensureChatGroup(item);
    if (group) out.push(group);
  }
  return out;
}

/** Test helper: hydrate sidebar groups from persisted session JSON. */
export function hydrateSessionGroupsForTests(raw: unknown): ChatGroup[] {
  return ensureGroupsFromRaw(raw);
}

/** Move legacy chat-owned boards onto sidebar folders (schema v4 → v5). */
export function migrateSessionV4ToV5(state: SessionState): void {
  if (!state.groups) state.groups = [];

  for (const chat of state.chats) {
    const legacyBoard = chat.orchestrateBoard;
    if (!legacyBoard) continue;

    const legacyGroupId =
      typeof (legacyBoard as { groupId?: string }).groupId === 'string'
        ? (legacyBoard as { groupId?: string }).groupId!.trim()
        : '';
    let group = legacyGroupId
      ? state.groups.find((g) => g.id === legacyGroupId)
      : undefined;

    if (!group) {
      const planLabel =
        chat.orchestratePlanPath?.split('/').pop()?.replace(/\.md$/i, '') ||
        legacyBoard.planPath.split('/').pop()?.replace(/\.md$/i, '') ||
        'Orchestrate';
      const ws = normalizeWorkspacePath(chat.workspacePath);
      const siblings = state.groups.filter(
        (g) => normalizeWorkspacePath(g.workspacePath) === ws,
      );
      group = {
        id: `grp_${newChatId().slice(5)}`,
        name: planLabel,
        workspacePath: ws,
        collapsed: false,
        order: siblings.length,
        createdAt: Date.now(),
      };
      state.groups.push(group);
    }

    const boardCopy = { ...legacyBoard };
    delete (boardCopy as { groupId?: string }).groupId;
    group.orchestrateBoard = boardCopy;
    group.orchestratePlanPath =
      chat.orchestratePlanPath ?? group.orchestratePlanPath ?? legacyBoard.planPath;
    group.plannerChatId = chat.id;
    if (chat.viewMode === 'board') {
      group.viewMode = 'board';
      state.activeBoardGroupId = group.id;
    }

    chat.boardGroupId = group.id;
    chat.groupId = group.id;

    for (const task of legacyBoard.tasks) {
      const taskChatId = task.chatId?.trim();
      if (!taskChatId) continue;
      const taskChat = state.chats.find((c) => c.id === taskChatId);
      if (!taskChat) continue;
      taskChat.groupId = group.id;
      taskChat.boardGroupId = group.id;
    }

    delete chat.orchestrateBoard;
    delete chat.viewMode;
  }

  (state as { version: number }).version = 5;
}

/** Experts overhaul: expertId as sole identity, runtime snapshots, drop Auto picker state. */
export function migrateSessionV5ToV6(state: SessionState): void {
  for (const chat of state.chats) {
    const selection = chat.expertSelection;
    if (chat.kind === 'expert') {
      if (!chat.expertId?.trim() && selection?.mode === 'manual' && selection.expertId?.trim()) {
        chat.expertId = selection.expertId.trim();
      }
      if (!chat.expertRuntime) {
        chat.expertRuntime = {
          ...(chat.providerId?.trim() ? { providerId: chat.providerId.trim() } : {}),
          modelId: chat.modelId ?? '',
          modeId: normalizeModeId(chat.modeId),
          toolAllowlist: null,
          toolDenylist: [],
          enabledToolNames: [],
          memoryEnabled: true,
          warnings: [],
          profileSource: 'inherit',
        };
      }
    }
    delete chat.expertSelection;
  }
  state.version = 6;
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
    const structuredOutcome =
      r.structuredOutcome &&
      typeof r.structuredOutcome === 'object' &&
      !Array.isArray(r.structuredOutcome)
        ? (r.structuredOutcome as PersistedSubAgentRun['structuredOutcome'])
        : undefined;
    const budgetEvents = Array.isArray(r.budgetEvents)
      ? (r.budgetEvents as PersistedSubAgentRun['budgetEvents'])
      : undefined;
    out.push({
      runId,
      parentTurnId,
      ...(parentToolCallId ? { parentToolCallId } : {}),
      type,
      task,
      status,
      summary: typeof r.summary === 'string' ? r.summary : '',
      ...(structuredOutcome ? { structuredOutcome } : {}),
      ...(budgetEvents?.length ? { budgetEvents } : {}),
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

const MAX_CHAT_TODO_ITEMS = 20;
const MAX_CHAT_TODO_TEXT_CHARS = 140;

function normalizeChatTodoStatus(raw: unknown): ChatTodo['status'] {
  if (raw === 'completed' || raw === 'in_progress' || raw === 'pending') return raw;
  return 'pending';
}

/** Sanitize persisted todos — drop malformed rows and cap length. */
function ensureChatTodos(raw: unknown): ChatTodo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ChatTodo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const text = typeof row.text === 'string' ? row.text.trim().slice(0, MAX_CHAT_TODO_TEXT_CHARS) : '';
    if (!text) continue;
    out.push({
      text,
      status: normalizeChatTodoStatus(row.status),
    });
    if (out.length >= MAX_CHAT_TODO_ITEMS) break;
  }
  return out.length ? out : undefined;
}

function ensureActiveGoal(raw: unknown): ActiveGoalState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const goal = raw as Record<string, unknown>;
  const conditionText =
    typeof goal.conditionText === 'string' ? goal.conditionText.trim() : '';
  if (!conditionText) return undefined;
  return {
    conditionText: conditionText.slice(0, MAX_GOAL_CONDITION_CHARS),
    startedAt:
      typeof goal.startedAt === 'number' && Number.isFinite(goal.startedAt)
        ? goal.startedAt
        : Date.now(),
    turnCount:
      typeof goal.turnCount === 'number' && Number.isFinite(goal.turnCount)
        ? Math.max(0, Math.floor(goal.turnCount))
        : 0,
    tokenBaseline:
      typeof goal.tokenBaseline === 'number' && Number.isFinite(goal.tokenBaseline)
        ? Math.max(0, Math.floor(goal.tokenBaseline))
        : 0,
    ...(typeof goal.lastReason === 'string' && goal.lastReason.trim()
      ? { lastReason: goal.lastReason.trim() }
      : {}),
    ...(goal.achieved === true ? { achieved: true } : {}),
  };
}

function ensureActiveLoopRow(raw: unknown): ActiveLoopState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const id =
    typeof row.id === 'number' && Number.isFinite(row.id)
      ? Math.max(1, Math.floor(row.id))
      : 0;
  if (id < 1) return undefined;

  const kind = row.kind === 'interval' || row.kind === 'auto' ? row.kind : null;
  if (!kind) return undefined;

  const promptText =
    typeof row.promptText === 'string'
      ? row.promptText.slice(0, MAX_LOOP_PROMPT_CHARS)
      : '';

  const dueAt =
    typeof row.dueAt === 'number' && Number.isFinite(row.dueAt)
      ? row.dueAt
      : Date.now();
  const createdAt =
    typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
      ? row.createdAt
      : Date.now();
  const expiresAt =
    typeof row.expiresAt === 'number' && Number.isFinite(row.expiresAt)
      ? row.expiresAt
      : createdAt + 7 * 24 * 60 * 60 * 1000;
  const runCount =
    typeof row.runCount === 'number' && Number.isFinite(row.runCount)
      ? Math.max(0, Math.floor(row.runCount))
      : 0;

  const loop: ActiveLoopState = {
    id,
    promptText,
    kind,
    dueAt,
    createdAt,
    expiresAt,
    runCount,
  };

  if (kind === 'interval') {
    const intervalMs =
      typeof row.intervalMs === 'number' && Number.isFinite(row.intervalMs)
        ? Math.max(MIN_LOOP_INTERVAL_MS, Math.floor(row.intervalMs))
        : MIN_LOOP_INTERVAL_MS;
    loop.intervalMs = intervalMs;
  } else {
    const currentDelayMs =
      typeof row.currentDelayMs === 'number' && Number.isFinite(row.currentDelayMs)
        ? Math.min(
            3_600_000,
            Math.max(MIN_LOOP_INTERVAL_MS, Math.floor(row.currentDelayMs)),
          )
        : INITIAL_LOOP_AUTO_DELAY_MS;
    loop.currentDelayMs = currentDelayMs;
  }

  if (typeof row.lastOutputDigest === 'string' && row.lastOutputDigest.trim()) {
    loop.lastOutputDigest = row.lastOutputDigest.trim();
  }

  if (row.paused === true) {
    loop.paused = true;
    if (
      typeof row.pausedRemainingMs === 'number' &&
      Number.isFinite(row.pausedRemainingMs)
    ) {
      loop.pausedRemainingMs = Math.max(0, Math.floor(row.pausedRemainingMs));
    }
  }

  return loop;
}

function ensureActiveLoops(raw: unknown): ActiveLoopState[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ActiveLoopState[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    const loop = ensureActiveLoopRow(entry);
    if (!loop || seen.has(loop.id)) continue;
    seen.add(loop.id);
    out.push(loop);
  }
  return out.length ? out : undefined;
}

function ensureSuperPlanPersisted(raw: unknown): SuperPlanState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const sp = raw as Partial<SuperPlanState>;
  if (typeof sp.slug !== 'string' || !sp.slug.trim()) return undefined;
  if (typeof sp.prompt !== 'string') return undefined;
  if (typeof sp.activeStage !== 'string' || !sp.activeStage.trim()) return undefined;
  if (!sp.stages || typeof sp.stages !== 'object') return undefined;
  return sp as SuperPlanState;
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
  const pinnedSkill = ensurePinnedSkill(raw.pinnedSkill);
  const activeGoal = ensureActiveGoal(raw.activeGoal);
  const activeLoops = ensureActiveLoops(raw.activeLoops);
  const nextLoopId =
    typeof raw.nextLoopId === 'number' && Number.isFinite(raw.nextLoopId)
      ? Math.max(1, Math.floor(raw.nextLoopId))
      : activeLoops?.length
        ? Math.max(...activeLoops.map((loop) => loop.id)) + 1
        : undefined;
  const superPlan = ensureSuperPlanPersisted(raw.superPlan);
  const todos = ensureChatTodos(raw.todos);
  const todosUpdatedAt =
    typeof raw.todosUpdatedAt === 'number' &&
    Number.isFinite(raw.todosUpdatedAt) &&
    raw.todosUpdatedAt > 0
      ? raw.todosUpdatedAt
      : undefined;
  const pendingMessageQueue = ensurePendingMessageQueue(raw.pendingMessageQueue);
  const pendingSteerMessage =
    typeof raw.pendingSteerMessage === 'string' && raw.pendingSteerMessage.trim()
      ? raw.pendingSteerMessage.trim()
      : undefined;
  const chat: Chat = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newChatId(),
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : PLACEHOLDER_CHAT_NAME,
    ...(raw.appScope === 'email' ? { appScope: 'email' as const } : {}),
    workspacePath,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : '',
    providerId: typeof raw.providerId === 'string' ? raw.providerId : undefined,
    modeId: normalizeModeId(raw.modeId),
    ...(raw.expertSelection && typeof raw.expertSelection === 'object'
      ? { expertSelection: ensureExpertSelection(raw.expertSelection) }
      : {}),
    workAgentId:
      typeof raw.workAgentId === 'string' && raw.workAgentId.trim()
        ? raw.workAgentId.trim()
        : null,
    workAgentAuto: raw.workAgentAuto !== false,
    ...(raw.thinkingMode !== undefined
      ? { thinkingMode: normalizeThinkingTriState(raw.thinkingMode) }
      : {}),
    ...(typeof raw.reasoningEffort === 'string' &&
    REASONING_EFFORT_OPTIONS.has(raw.reasoningEffort as ReasoningEffortOption)
      ? { reasoningEffort: raw.reasoningEffort as ReasoningEffortOption }
      : {}),
    ...(raw.uiDesignerMode === 'plan' || raw.uiDesignerMode === 'implement'
      ? { uiDesignerMode: raw.uiDesignerMode }
      : {}),
    ...(typeof raw.pendingModeId === 'string' && isModeId(raw.pendingModeId)
      ? { pendingModeId: raw.pendingModeId }
      : {}),
    ...(orchestratePlanPath ? { orchestratePlanPath } : {}),
    ...(typeof raw.groupId === 'string' && raw.groupId.trim()
      ? { groupId: raw.groupId.trim() }
      : {}),
    ...(typeof raw.boardGroupId === 'string' && raw.boardGroupId.trim()
      ? { boardGroupId: raw.boardGroupId.trim() }
      : {}),
    ...(typeof raw.boardTaskId === 'string' && raw.boardTaskId.trim()
      ? { boardTaskId: raw.boardTaskId.trim() }
      : {}),
    ...(typeof raw.worktreeRoot === 'string' && raw.worktreeRoot.trim()
      ? { worktreeRoot: raw.worktreeRoot.trim() }
      : {}),
    ...(typeof raw.gitBranch === 'string' && raw.gitBranch.trim()
      ? { gitBranch: raw.gitBranch.trim() }
      : {}),
    ...(raw.chatWorktreeManaged === true ? { chatWorktreeManaged: true } : {}),
    ...(orchestrateBoard ? { orchestrateBoard } : {}),
    ...(viewMode ? { viewMode } : {}),
    terminalHistory: ensureTerminalHistory(raw.terminalHistory),
    ...(subAgentRuns ? { subAgentRuns } : {}),
    ...(runs ? { runs } : {}),
    ...(activeBranchByFork ? { activeBranchByFork } : {}),
    ...(currentGenerationId ? { currentGenerationId } : {}),
    ...(raw.unread === true ? { unread: true } : {}),
    ...(raw.turnError === true ? { turnError: true } : {}),
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
    ...(raw.kind === 'expert' ? { kind: 'expert' as const } : {}),
    ...(raw.codeChangeTotals &&
    typeof raw.codeChangeTotals === 'object' &&
    Number.isFinite(Number(raw.codeChangeTotals.additions)) &&
    Number.isFinite(Number(raw.codeChangeTotals.deletions))
      ? {
          codeChangeTotals: {
            additions: Number(raw.codeChangeTotals.additions),
            deletions: Number(raw.codeChangeTotals.deletions),
          },
        }
      : {}),
    ...(typeof raw.codeChangeBackfillAt === 'number' &&
    Number.isFinite(raw.codeChangeBackfillAt)
      ? { codeChangeBackfillAt: raw.codeChangeBackfillAt }
      : {}),
    ...(raw.kind === 'expert-lab' ? { kind: 'expert-lab' as const } : {}),
    ...(typeof raw.expertId === 'string' && raw.expertId.trim()
      ? { expertId: raw.expertId.trim() }
      : {}),
    ...(raw.expertRuntime && typeof raw.expertRuntime === 'object'
      ? { expertRuntime: ensureExpertRuntime(raw.expertRuntime) }
      : {}),
    ...(pinnedSkill ? { pinnedSkill } : {}),
    ...(activeGoal ? { activeGoal } : {}),
    ...(activeLoops ? { activeLoops } : {}),
    ...(nextLoopId ? { nextLoopId } : {}),
    ...(superPlan ? { superPlan } : {}),
    ...(todos ? { todos } : {}),
    ...(todos && todosUpdatedAt ? { todosUpdatedAt } : {}),
    ...(pendingMessageQueue ? { pendingMessageQueue } : {}),
    ...(pendingSteerMessage ? { pendingSteerMessage } : {}),
    ...(typeof raw.composerDraft === 'string' && raw.composerDraft
      ? { composerDraft: raw.composerDraft }
      : {}),
    ...(raw.lastContextTrim && typeof raw.lastContextTrim === 'object'
      ? { lastContextTrim: raw.lastContextTrim as Chat['lastContextTrim'] }
      : {}),
  };
  ensureTokenLedger(chat);
  return chat;
}

export function isExpertChat(chat: Chat): boolean {
  return chat.kind === 'expert';
}

/** Legacy Expert Lab sessions are omitted from the main sidebar. */
export function isHiddenFromMainSidebar(chat: Chat): boolean {
  return chat.kind === 'expert-lab';
}

/** Create a new expert-scoped chat from a resolved seed (runtime + greeting). */
export function createExpertChatFromSeed(seed: ExpertChatSeed): Chat {
  const state = requireSessionState();
  const chat = createEmptyChatObject(seed.modelId, seed.workspacePath);
  chat.kind = 'expert';
  chat.expertId = seed.expertId;
  if (seed.providerId?.trim()) chat.providerId = seed.providerId.trim();
  chat.modeId = seed.modeId;
  chat.expertRuntime = { ...seed.runtimeSnapshot };
  chat.name = PLACEHOLDER_CHAT_NAME;
  chat.history.push({ role: 'assistant', content: seed.greeting });
  state.chats.push(chat);
  touchChat(chat);
  scheduleSaveSessions();
  return chat;
}

/** @deprecated Use createExpertChatFromSeed with resolveExpertChatSeed. */
export function createExpertChat(
  expertId: string,
  modelId = '',
  workspacePath?: string,
): Chat {
  const state = requireSessionState();
  const trimmedId = expertId.trim();
  const chat = createEmptyChatObject(
    modelId,
    workspacePath?.trim() || getWorkspacePath(),
  );
  chat.kind = 'expert';
  chat.expertId = trimmedId;
  chat.modeId = 'general';
  chat.expertRuntime = {
    modelId: modelId || '',
    modeId: 'general',
    toolAllowlist: null,
    toolDenylist: [],
    enabledToolNames: [],
    memoryEnabled: true,
    warnings: [],
    profileSource: 'inherit',
  };
  chat.name = PLACEHOLDER_CHAT_NAME;
  state.chats.push(chat);
  touchChat(chat);
  scheduleSaveSessions();
  return chat;
}

/** Expert threads for one specialist, newest activity first. */
export function getExpertChats(expertId: string): Chat[] {
  const state = requireSessionState();
  const id = expertId.trim();
  return state.chats
    .filter((c) => c.kind === 'expert' && c.expertId === id)
    .sort((a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a));
}

/** Set the active chat id and schedule a session save. */
export function activateChatById(id: string): void {
  const state = requireSessionState();
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return;
  state.activeId = id;
  maybeRememberActiveChatForForegroundApp(state, chat);
  scheduleSaveSessions();
}

/** Read legacy expert selection when still present on disk (pre-v6). */
export function getExpertSelection(chat: Chat): ExpertSelection {
  if (chat.expertSelection) return chat.expertSelection;
  const expertId = chat.expertId?.trim();
  if (expertId) return { mode: 'manual', expertId };
  return defaultExpertSelection();
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

/** Parse persisted session JSON (client load path; parity with server validateSessionState). */
export function parseSessionStateFromJson(parsed: RawSessionJson | null): SessionState {
  if (!parsed || !Array.isArray(parsed.chats)) {
    return defaultSessionState();
  }
  const ver = parsed.version;
  if (ver !== 1 && ver !== 2 && ver !== 3 && ver !== 4 && ver !== 5 && ver !== 6) {
    return defaultSessionState();
  }
  const state = migrateSessionStateV1ToV2(parsed);
  const rawSession = parsed as Partial<SessionState>;
  state.groups = ensureGroupsFromRaw(rawSession.groups);
  if (
    typeof rawSession.activeBoardGroupId === 'string' &&
    rawSession.activeBoardGroupId.trim()
  ) {
    state.activeBoardGroupId = rawSession.activeBoardGroupId.trim();
  }
  if (ver < 5 || state.chats.some((c) => c.orchestrateBoard)) {
    migrateSessionV4ToV5(state);
  } else if (ver >= 5) {
    (state as { version: number }).version = ver;
  }
  if (ver < 6) {
    migrateSessionV5ToV6(state);
  } else {
    state.version = 6;
  }
  repairPlannerChatFolderMembership(state);
  repairBoardChatWorktreeRoots(state);
  if (
    rawSession.codeChangeTotalsByWorkspace &&
    typeof rawSession.codeChangeTotalsByWorkspace === 'object'
  ) {
    state.codeChangeTotalsByWorkspace = rawSession.codeChangeTotalsByWorkspace;
  }
  if (!state.lastActiveChatIdByApp) {
    state.lastActiveChatIdByApp = {};
  }
  if (typeof rawSession.sidebarWidth === 'number' && Number.isFinite(rawSession.sidebarWidth)) {
    state.sidebarWidth = Math.min(520, Math.max(200, Math.round(rawSession.sidebarWidth)));
  }
  return state;
}

/** Backfill chat.worktreeRoot from the linked board task after session load. */
function repairBoardChatWorktreeRoots(state: SessionState): void {
  for (const chat of state.chats) {
    if (chat.worktreeRoot?.trim()) continue;
    const root = resolveChatWorktreeRoot(chat, state.groups);
    if (root) chat.worktreeRoot = root;
  }
}

/** Planners linked via boardGroupId appear under their board folder in the sidebar. */
function repairPlannerChatFolderMembership(state: SessionState): void {
  let titleChanged = false;
  for (const group of state.groups ?? []) {
    const plannerId = group.plannerChatId?.trim();
    if (!plannerId) continue;
    const planner = state.chats.find((c) => c.id === plannerId);
    if (!planner) continue;
    if (planner.boardGroupId === group.id && planner.groupId !== group.id) {
      planner.groupId = group.id;
    }
    if (
      syncOrchestratorPlannerChatTitle(
        planner,
        planner.orchestratePlanPath ?? group.orchestratePlanPath,
      )
    ) {
      touchChat(planner);
      titleChanged = true;
    }
  }
  if (titleChanged) {
    scheduleSaveSessions();
  }
}

/** When a foreground chat surface is active, persist its last active chat id per app. */
function maybeRememberActiveChatForForegroundApp(
  state: SessionState,
  chat: Chat,
): void {
  if (shouldPaintDesktopChatSurface()) {
    rememberActiveChatForAppInState(state, DESKTOP_APP_ID, chat.id);
    return;
  }
  if (getForegroundAppId() === EMAIL_APP_ID && chat.appScope === 'email') {
    rememberActiveChatForAppInState(state, EMAIL_APP_ID, chat.id);
    return;
  }
  if (getForegroundAppId() !== CHAT_APP_ID && !isChatAppForeground()) return;
  rememberActiveChatForAppInState(state, CHAT_APP_ID, chat.id);
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

/** Persist the active chat when it belongs to the given project workspace (before desktop chat). */
export function rememberWorkspaceActiveChat(workspacePath: string): void {
  const state = sessionState;
  if (!state?.activeId) return;
  const key = normalizeWorkspacePath(workspacePath);
  if (!key) return;
  const active = getActiveChat();
  if (normalizeWorkspacePath(active.workspacePath ?? '') !== key) return;
  rememberActiveChatForWorkspaceKey(key);
  scheduleSaveSessions();
}

/** Chats for the given workspace (newest first); empty workspace key returns none. */
export function getChatsForWorkspace(
  workspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterChatsForWorkspace(workspacePath, state);
}

/** Sidebar session rows for a workspace (excludes ephemeral empty chats). */
export function getSidebarListedChatsForWorkspace(
  workspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterSidebarListedChatsForWorkspace(workspacePath, state);
}

export {
  isEphemeralEmptyChat,
  isSidebarListedChat,
  pruneEphemeralEmptyChats,
  formatDraftChatSidebarName,
};

/** Legacy or unscoped chats (`workspacePath === ''`), newest first. */
export function getUnassignedChats(state: SessionState = requireSessionState()): Chat[] {
  return filterUnassignedChats(state);
}

/** Assistant chats for the chats workspace sandbox (sidebar-visible, newest first). */
export function getAssistantChats(
  chatsWorkspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterAssistantChats(state, chatsWorkspacePath);
}

/** All chats bound to the chats workspace (newest first). */
export function getChatsForChatsWorkspace(
  chatsWorkspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterChatsForChatsWorkspace(state, chatsWorkspacePath);
}

/** All Email-scoped chats for the chats workspace sandbox. */
export function getEmailAssistantChats(
  chatsWorkspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterEmailAssistantChats(state, chatsWorkspacePath);
}

/** Email history rows with a committed turn or unsent draft. */
export function getListedEmailAssistantChats(
  chatsWorkspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterListedEmailAssistantChats(state, chatsWorkspacePath);
}

/** Persist last active chat id for a MinnowOS app. */
export function rememberActiveChatForApp(appId: string, chatId: string): void {
  const state = requireSessionState();
  rememberActiveChatForAppInState(state, appId, chatId);
  scheduleSaveSessions();
}

/** Read remembered active chat id for a MinnowOS app. */
export function getLastActiveChatIdForAppFromSession(appId: string): string | undefined {
  return getLastActiveChatIdForApp(requireSessionState(), appId);
}

/**
 * Activate the last assistant chat for the Chat app or create one (general mode).
 * Requires the absolute chats workspace path from `getChatsWorkspacePath()`.
 */
export function activateAssistantChatForApp(chatsWorkspacePath: string): Chat {
  const state = requireSessionState();
  const nextId = resolveActiveAssistantChatId(chatsWorkspacePath, state, (workspaceKey) => {
    const fresh = createAssistantChat(workspaceKey, newChatId());
    touchChat(fresh);
    return fresh;
  });
  state.activeId = nextId;
  rememberActiveChatForAppInState(state, CHAT_APP_ID, nextId);
  scheduleSaveSessions();
  return getActiveChat();
}

/** Activate the remembered Email assistant chat or create one in Email mode. */
export function activateEmailAssistantChatForApp(chatsWorkspacePath: string): Chat {
  const state = requireSessionState();
  const nextId = resolveActiveEmailAssistantChatId(
    chatsWorkspacePath,
    state,
    (workspaceKey) => createEmailAssistantChat(workspaceKey, newChatId()),
  );
  state.activeId = nextId;
  rememberActiveChatForAppInState(state, EMAIL_APP_ID, nextId);
  scheduleSaveSessions();
  return getActiveChat();
}

/** Create, activate, and persist a fresh Email-scoped assistant chat. */
export function createEmailAssistantChatForApp(
  chatsWorkspacePath: string,
  fallbackModelId = '',
): Chat {
  const state = requireSessionState();
  const chat = createEmailAssistantChat(
    chatsWorkspacePath,
    newChatId(),
    fallbackModelId,
  );
  state.chats.unshift(chat);
  state.activeId = chat.id;
  pruneEphemeralEmptyChats(state, chat.id);
  rememberActiveChatForAppInState(state, EMAIL_APP_ID, chat.id);
  scheduleSaveSessions();
  notifySessionCreated(chat.id, chat.workspacePath);
  return chat;
}

/**
 * Activate the last desktop chat or create one (desktop mode).
 * Requires the absolute desktop workspace path from `getDesktopWorkspacePath()`.
 */
export function activateDesktopAssistantChatForApp(desktopWorkspacePath: string): Chat {
  const state = requireSessionState();
  const key = normalizeWorkspacePath(desktopWorkspacePath);
  const nextId = resolveActiveAssistantChatId(
    desktopWorkspacePath,
    state,
    (workspaceKey) => {
      const fresh = createDesktopChat(workspaceKey, newChatId());
      touchChat(fresh);
      return fresh;
    },
    DESKTOP_APP_ID,
  );
  // Migrate legacy `lastActiveChatIdByApp.chat` entries that pointed at desktop threads.
  if (
    key &&
    !getLastActiveChatIdForApp(state, DESKTOP_APP_ID) &&
    getLastActiveChatIdForApp(state, CHAT_APP_ID)
  ) {
    const legacy = state.chats.find(
      (c) =>
        c.id === getLastActiveChatIdForApp(state, CHAT_APP_ID) &&
        normalizeWorkspacePath(c.workspacePath ?? '') === key,
    );
    if (legacy) {
      rememberActiveChatForAppInState(state, DESKTOP_APP_ID, legacy.id);
    }
  }
  state.activeId = nextId;
  rememberActiveChatForAppInState(state, DESKTOP_APP_ID, nextId);
  scheduleSaveSessions();
  return getActiveChat();
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

export interface LoadSessionsOptions {
  /** Re-fetch from server/localStorage even when sessionState is already populated. */
  force?: boolean;
}

/** Load sessions from API or localStorage (after detectConfigServer). */
export async function loadSessionsFromStorage(options?: LoadSessionsOptions): Promise<void> {
  if (sessionState && !options?.force) {
    return;
  }
  try {
    if (isServerStorageMode()) {
      try {
        const remote = await getSessions();
        sessionState = parseSessionStateFromJson(remote);
        await runSessionCodeChangeBackfill(sessionState);
        sessionsHydratedFromServer = true;
        return;
      } catch {
        if (typeof document !== 'undefined') {
          setStatus('err', 'Could not load sessions from ~/.minnow');
        }
        // Never fall through to localStorage when file-backed storage is active — that
        // empty blob would later overwrite ~/.minnow on save (MIN-408).
        if (!sessionState) {
          sessionState = defaultSessionState();
        }
        return;
      }
    }

    sessionsHydratedFromServer = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        sessionState = defaultSessionState();
        return;
      }
      sessionState = parseSessionStateFromJson(JSON.parse(raw) as Partial<SessionState>);
      await runSessionCodeChangeBackfill(sessionState);
    } catch {
      sessionState = defaultSessionState();
    }
  } finally {
    markSessionsReady();
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

/** Store a new /goal completion condition on the chat. */
export function setActiveGoal(chat: Chat, conditionText: string): void {
  const trimmed = conditionText.trim().slice(0, MAX_GOAL_CONDITION_CHARS);
  if (!trimmed) return;
  ensureTokenLedger(chat);
  chat.activeGoal = {
    conditionText: trimmed,
    startedAt: Date.now(),
    turnCount: 0,
    tokenBaseline: chat.tokenLedger?.totals.totalTokens ?? 0,
  };
  touchChat(chat);
  scheduleSaveSessions();
}

/** Remove goal state from the chat (/goal clear, /clear, etc.). */
export function clearActiveGoal(chat: Chat): void {
  if (!chat.activeGoal) return;
  chat.activeGoal = undefined;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Replace the build-agent progress checklist on a chat (todo_write). */
export function setChatTodos(chat: Chat, todos: ChatTodo[]): void {
  chat.todos = todos.slice(0, MAX_CHAT_TODO_ITEMS).map((item) => ({
    text: item.text.trim().slice(0, MAX_CHAT_TODO_TEXT_CHARS),
    status: normalizeChatTodoStatus(item.status),
  }));
  chat.todosUpdatedAt = Date.now();
  touchChat(chat);
  scheduleSaveSessions();
}

/** Clear build-agent todos (/clear or empty todo_write). */
export function clearChatTodos(chat: Chat): void {
  if (!chat.todos?.length && chat.todosUpdatedAt === undefined) return;
  chat.todos = undefined;
  chat.todosUpdatedAt = undefined;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Read persisted build-agent todos. */
export function getChatTodos(chat: Chat): ChatTodo[] | undefined {
  return chat.todos?.length ? chat.todos : undefined;
}

/** Read persisted goal state (may be achieved but still visible until cleared). */
export function getActiveGoal(chat: Chat): ActiveGoalState | undefined {
  return chat.activeGoal;
}

/** True while the evaluator loop should auto-continue and auto-approve tools. */
export function isGoalLoopActive(chat: Chat): boolean {
  const goal = chat.activeGoal;
  return Boolean(goal && !goal.achieved);
}

export interface AddActiveLoopInput {
  promptText: string;
  kind: 'interval' | 'auto';
  intervalMs?: number;
  currentDelayMs?: number;
  dueAt: number;
  createdAt: number;
  expiresAt: number;
}

/** Ask loop ticker to reschedule its next wake after dueAt changes. */
function notifyLoopTickerScheduleChanged(): void {
  void import('../chat/loop/ticker')
    .then((mod) => mod.notifyLoopScheduleChanged())
    .catch(() => {
      // Ticker not started yet (tests / headless) — ignore.
    });
}

/** Arm a new /loop on the chat; returns the stored row. */
export function addActiveLoop(chat: Chat, input: AddActiveLoopInput): ActiveLoopState {
  const id = chat.nextLoopId && chat.nextLoopId > 0
    ? chat.nextLoopId
    : (chat.activeLoops?.reduce((max, loop) => Math.max(max, loop.id), 0) ?? 0) + 1;

  const loop: ActiveLoopState = {
    id,
    promptText: input.promptText.slice(0, MAX_LOOP_PROMPT_CHARS),
    kind: input.kind,
    dueAt: input.dueAt,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    runCount: 0,
  };

  if (input.kind === 'interval') {
    loop.intervalMs = Math.max(
      MIN_LOOP_INTERVAL_MS,
      Math.floor(input.intervalMs ?? MIN_LOOP_INTERVAL_MS),
    );
  } else {
    loop.currentDelayMs = Math.min(
      3_600_000,
      Math.max(
        MIN_LOOP_INTERVAL_MS,
        Math.floor(input.currentDelayMs ?? INITIAL_LOOP_AUTO_DELAY_MS),
      ),
    );
  }

  chat.activeLoops = [...(chat.activeLoops ?? []), loop];
  chat.nextLoopId = id + 1;
  touchChat(chat);
  scheduleSaveSessions();
  notifyLoopTickerScheduleChanged();
  return loop;
}

/** Remove one loop by id, or all loops when target is `all`. */
export function removeActiveLoop(chat: Chat, target: number | 'all'): void {
  if (!chat.activeLoops?.length) return;
  if (target === 'all') {
    chat.activeLoops = undefined;
    touchChat(chat);
    scheduleSaveSessions();
    notifyLoopTickerScheduleChanged();
    return;
  }
  const next = chat.activeLoops.filter((loop) => loop.id !== target);
  if (next.length === chat.activeLoops.length) return;
  chat.activeLoops = next.length ? next : undefined;
  touchChat(chat);
  scheduleSaveSessions();
  notifyLoopTickerScheduleChanged();
}

/** Patch fields on a single active loop (schedule / pacing). */
export function updateActiveLoop(
  chat: Chat,
  id: number,
  patch: Partial<ActiveLoopState>,
): void {
  if (!chat.activeLoops?.length) return;
  const index = chat.activeLoops.findIndex((loop) => loop.id === id);
  if (index < 0) return;
  chat.activeLoops[index] = { ...chat.activeLoops[index], ...patch, id };
  touchChat(chat);
  scheduleSaveSessions();
  notifyLoopTickerScheduleChanged();
}

/** Persist after in-place loop mutations that already updated the array. */
export function touchActiveLoops(chat: Chat): void {
  touchChat(chat);
  scheduleSaveSessions();
  notifyLoopTickerScheduleChanged();
}

/** Read active loops (empty array when none). */
export function getActiveLoops(chat: Chat): ActiveLoopState[] {
  return chat.activeLoops?.length ? [...chat.activeLoops] : [];
}

/** True when the chat has at least one armed loop. */
export function hasActiveLoops(chat: Chat): boolean {
  return Boolean(chat.activeLoops?.length);
}

/** Clear all loops (/clear, etc.). */
export function clearActiveLoops(chat: Chat): void {
  if (!chat.activeLoops?.length && chat.nextLoopId == null) return;
  chat.activeLoops = undefined;
  // Keep nextLoopId so ids stay unique across clear/re-arm in the same chat
  touchChat(chat);
  scheduleSaveSessions();
}

/** Bump sidebar sort time when user or assistant history is committed. */
export function recordChatMessage(chat: Chat): void {
  const now = Date.now();
  chat.lastMessageAt = now;
  chat.updatedAt = now;
}

export type SaveSessionsOptions = {
  /** Use fetch keepalive for unload handlers (fire-and-forget). */
  keepalive?: boolean;
};

export function saveSessionsNow(options?: SaveSessionsOptions): SaveSessionsResult {
  if (!sessionState) return 'ok';

  if (isServerStorageMode()) {
    if (!sessionsHydratedFromServer) {
      return 'ok';
    }
    if (options?.keepalive) {
      putSessionsKeepalive(sessionState);
    } else {
      void putSessions(sessionState).catch(() => {
        setStatus('err', 'Could not save sessions to ~/.minnow');
      });
    }
    void import('../ui/hub').then((m) => m.refreshHubLiveData());
    return 'ok';
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));
    void import('../ui/hub').then((m) => m.refreshHubLiveData());
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

/** Flush debounced saves and persist immediately (pagehide / abrupt quit). */
export function flushPendingSessionSaveOnShutdown(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    setSaveTimer(null);
  }
  saveSessionsNow({ keepalive: true });
}

/** Register a one-time pagehide handler so debounced saves are not lost on quit. */
export function registerSessionPersistenceShutdownHandler(): void {
  if (sessionPersistenceShutdownRegistered || typeof window === 'undefined') return;
  sessionPersistenceShutdownRegistered = true;
  window.addEventListener('pagehide', () => {
    flushPendingSessionSaveOnShutdown();
  });
}

/** Create a chat, make it active, and persist (debounced). */
export function createAndActivateChat(modelId: string): Chat {
  const state = requireSessionState();
  const chat = createEmptyChatObject(modelId);
  state.chats.unshift(chat);
  state.activeId = chat.id;
  touchChat(chat);
  rememberActiveChatForWorkspaceKey(normalizeWorkspacePath(chat.workspacePath));
  maybeRememberActiveChatForForegroundApp(state, chat);
  scheduleSaveSessions();
  notifySessionCreated(chat.id, chat.workspacePath);
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
  maybeRememberActiveChatForForegroundApp(state, chat);
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
  const victimAgent = resolveActiveWorkAgent(victim);
  cleanupChatArchiveOnDelete(
    victim.id,
    victim.workspacePath ?? '',
    victimAgent?.contextEnforcementPolicy,
  );
  void cleanupChatWorktreeOnDelete(victim);
  abortChatTitleGeneration(chatId);
  const wasActive = state.activeId === chatId;

  // Planner deletion: keep plan path on the board folder so hub/sidebar boards survive.
  const boardGroup = (state.groups ?? []).find((g) => g.plannerChatId === chatId);
  if (boardGroup) {
    const planPath = normalizeOrchestratePlanPath(victim.orchestratePlanPath);
    if (planPath) {
      boardGroup.orchestratePlanPath = planPath;
    }
    delete boardGroup.plannerChatId;
  }

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
    const inWorkspace = getSidebarListedChatsForWorkspace(victimWorkspace, state);
    if (inWorkspace.length) {
      state.activeId = inWorkspace[0]!.id;
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
