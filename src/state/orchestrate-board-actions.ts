/**
 * Manual orchestrate board operations — shared by UI buttons and LLM tools.
 */

import { stopGeneration } from '../chat/stop-generation.ts';
import { decodeModelSelectKey } from '../lib/model-select-key.ts';
import { isOrchestratePlanComplete } from '../chat/orchestrate/plan-complete.ts';
import { maybeEmitOrchestratePlanComplete } from '../chat/orchestrate/plan-complete-ui.ts';
import {
  isChatStreaming,
  subscribeChatStreamActivity,
  subscribeChatStreamEnd,
} from '../chat/streaming-state.ts';
import { isChatTurnSetupPending } from '../chat/chat-turn-guard.ts';
import {
  getAutopilotMetaSync,
  resolveAutoProvisionInfra,
  resolveAfkAutoRestartStalls,
  resolveInfraProvisionTimeoutMs,
  resolveMaxFinalTestAttempts,
  resolveMaxTaskBuildAttempts,
  resolveMaxTaskTestAttempts,
  resolveSelfHealMaxRounds,
} from '../config/autopilot-meta.ts';
import { classifyTaskFailure, resolveTaskChatStreamFailure } from './orchestrate-failure-classify.ts';
import { runSelfHeal, type SelfHealDeps } from './orchestrate-self-heal.ts';
import { isLocalServerAvailable } from '../tools/config.ts';
import {
  bindRunSupervision,
  bumpProgress,
  chatTaskRunId,
  createRunSupervision,
  getRunSupervision,
  setHeartbeatConfig,
  startHeartbeat,
  stopHeartbeat,
} from '../agents/controller/wrapper.ts';
import { runChatTurn } from '../tools/loop.ts';
import { reportBackgroundError } from '../boot/report-background-error.ts';
import { normalizeVerdict } from '../tools/board-tools.ts';
import { schedulePostTurnSynthesis } from '../synthesis/client.ts';
import { buildSynthesisMessages, buildSynthesisExcerpt } from '../synthesis/post-turn.ts';
import type { BoardTask, BoardTaskStatus, Chat, ChatGroup, OrchestrateBoardState, SessionState } from '../types.ts';
import {
  assignChatToGroup,
  getBoardGroupForChat,
  getOrCreateBoardGroup,
  getPlannerChatForGroup,
} from './chat-groups.ts';
import { emitBoardChange } from './orchestrate-board-events.ts';
import { isTaskReadyForAuto, isTaskStalledForRestart, isBoardAutoMode, isBoardRunning, getBoardExecutionMode, syncOrchestrateBoardTimer, updateTask, logTaskStatus, logBuildVerdict, logTestVerdict, logMergeResult, logWorktreeAllocated, logTaskRetry, logModeChange, logAutoStart, logAutoStop, logFinalTestStarted, logFinalTestVerdict, quarantineTaskAndDependents } from './orchestrate-board-store.ts';
import {
  isIsolationActive,
  resolveIsolationMode,
  worktreeBranchFor,
  worktreeSlotId,
  boardIntegrationBranch,
  allocateTaskPorts,
  usedDevPorts,
  DEFAULT_BOARD_PORT_BASE,
} from './worktree-isolation.ts';
import { teardownBoardTaskChatResources } from './board-task-teardown.ts';
import {
  ensureIntegration as ensureIntegrationWorktree,
  createWorktree as createTaskWorktreeOp,
  mergeIntoIntegration as mergeTaskIntoIntegration,
  commitWorktree as commitTaskWorktree,
  checkWorktreeDirty as checkTaskWorktreeDirty,
  checkMerged as checkTaskBranchMerged,
  restoreIntegration as restoreIntegrationWorktree,
  verifyIntegrationMerge as verifyIntegrationMergeOp,
  refreshIntegrationDeps as refreshIntegrationDepsOp,
  cleanupBoardWorktrees as cleanupBoardWorktreesOp,
} from './worktree-service.ts';

const MAX_MERGE_FIXER_ATTEMPTS = 2;

export { getBoardExecutionMode, isBoardAutoMode, isBoardRunning };

/**
 * Provision infra for a task's worktree (MIN-285 Phase 2, §3).
 *
 * GAP-4: shared services (docker compose) use a content-hash signature stored
 * in board.provisionedSignatures and are only provisioned once across concurrent
 * tasks. Per-task deps (node_modules, venv) are provisioned per worktree.
 *
 * Returns { wasAlreadyProvisioned } so runSelfHeal can implement the GAP-2 guard.
 */
export async function ensureBoardInfraProvisioned(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<{ wasAlreadyProvisioned: boolean; signatures: string[]; ok: boolean }> {
  if (!resolveAutoProvisionInfra()) {
    return { wasAlreadyProvisioned: false, signatures: [], ok: true };
  }
  const worktreeRoot = task.worktreePath?.trim() || undefined;
  const board = group.orchestrateBoard;

  // GAP-4: use the worktree path as a cheap per-worktree key.
  const taskSig = `worktree:${worktreeRoot ?? task.id}`;
  const existing = board?.provisionedSignatures ?? [];
  if (existing.includes(taskSig)) {
    return { wasAlreadyProvisioned: true, signatures: [], ok: true };
  }

  if (!isLocalServerAvailable() || !worktreeRoot) {
    return { wasAlreadyProvisioned: false, signatures: [], ok: false };
  }

  // Set provisioning state for UI feedback.
  if (board) {
    board.provisionState = 'provisioning';
    scheduleSaveSessions();
    emitBoardChange(group.id);
  }

  try {
    const body: Record<string, unknown> = {
      name: 'board_provision_infra',
      args: {
        services: task.testSpec
          ? extractServiceNames(task.testSpec)
          : [],
        timeoutMs: resolveInfraProvisionTimeoutMs(),
      },
      workspaceRoot: worktreeRoot,
    };
    const res = await fetch('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (board) { board.provisionState = 'failed'; scheduleSaveSessions(); emitBoardChange(group.id); }
      return { wasAlreadyProvisioned: false, signatures: [], ok: false };
    }
    const json = await res.json() as { result?: string };
    const result = json.result ? (JSON.parse(json.result) as { ok: boolean; signatures?: string[] }) : { ok: false };
    const serverSigs: string[] = result.signatures ?? [];
    const allSigs = [taskSig, ...serverSigs.map((s) => `shared:${s}`)];

    // Deduplicate and add new signatures to board.
    if (board) {
      const merged = [...new Set([...existing, ...allSigs])];
      board.provisionedSignatures = merged;
      board.provisionState = result.ok ? 'ready' : 'failed';
      scheduleSaveSessions();
      emitBoardChange(group.id);
    }

    updateTask(group, task.id, { lastHealCategory: undefined }, plannerChat);
    return { wasAlreadyProvisioned: false, signatures: allSigs, ok: result.ok };
  } catch (err) {
    reportBackgroundError('ensure-board-infra-provisioned', err);
    if (board) { board.provisionState = 'failed'; scheduleSaveSessions(); emitBoardChange(group.id); }
    return { wasAlreadyProvisioned: false, signatures: [], ok: false };
  }
}

/** Cheap heuristic: extract docker service names mentioned in testSpec text. */
function extractServiceNames(testSpec: string): string[] {
  const matches = testSpec.match(/(?:service|container|docker)[:\s]+([a-z0-9_-]+)/gi);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.split(/[:\s]+/).pop()!.toLowerCase()))];
}
import {
  createEmptyChatObject,
  findChatById,
  saveSessionsNow,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from './sessions.ts';

function requireSession(): NonNullable<typeof sessionState> {
  if (!sessionState) throw new Error('Session not loaded');
  return sessionState;
}

const DEFAULT_MAX_CONCURRENT = 3;
const FULL_BOARD_TEST_ID = 'FULL_BOARD';

/** Task columns that may still have linked chats or worktrees after reload. */
const WORKTREE_REHYDRATE_STATUSES = new Set<BoardTaskStatus>([
  'in_progress',
  'testing',
  'merging',
]);

/** Bind an absolute worktree path onto every chat linked to a board task. */
function bindTaskWorktreeToLinkedChats(task: BoardTask, worktreeRoot: string): void {
  const wt = worktreeRoot.trim();
  if (!wt) return;
  for (const chatId of [task.chatId, task.testChatId, task.fixerChatId]) {
    const id = chatId?.trim();
    if (!id) continue;
    const chat = findChatById(id);
    if (chat) chat.worktreeRoot = wt;
  }
}

/**
 * Re-attach isolated worktrees after reload: server ops plus persisted paths on
 * tasks/chats. Runs before generation or board boot resume so tools stay scoped.
 */
export async function rehydrateBoardWorktreeRoots(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board || !isIsolationActive(board)) return;

  let changed = false;
  for (const task of board.tasks) {
    if (!WORKTREE_REHYDRATE_STATUSES.has(task.status)) continue;

    const ensured =
      (await ensureTaskWorktree(group, task, plannerChat)) ||
      task.worktreePath?.trim() ||
      undefined;
    if (!ensured) continue;

    bindTaskWorktreeToLinkedChats(task, ensured);
    changed = true;
  }

  if (changed) scheduleSaveSessions();
}

/** Rehydrate worktrees for every board with active isolated tasks (boot). */
export async function rehydrateAllBoardWorktreeRoots(state: SessionState): Promise<void> {
  for (const group of state.groups ?? []) {
    if (!group.orchestrateBoard) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    await rehydrateBoardWorktreeRoots(group, planner);
  }
}

/** Per-board folder id → queued task ids waiting for a concurrency slot. */
const taskQueueByGroupId = new Map<string, string[]>();

/** Per-board serialized integration merges (keyed by group id). */
const mergeQueueByGroupId = new Map<string, Promise<unknown>>();

export type MergeTaskWorktreeResult =
  | { outcome: 'merged' }
  | { outcome: 'conflict'; conflictedFiles: string[]; integrationSha?: string }
  | { outcome: 'skipped' }
  | { outcome: 'error'; message: string };

function boardHasActiveFixer(board: OrchestrateBoardState): boolean {
  return board.tasks.some(
    (t) => t.status === 'merging' && Boolean(t.fixerChatId?.trim()),
  );
}

/** Block new merges while a fixer chat is resolving a conflict in integration. */
async function waitForNoActiveFixer(group: ChatGroup): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  while (boardHasActiveFixer(board)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function enqueueBoardMerge<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
  const prev = mergeQueueByGroupId.get(groupId) ?? Promise.resolve();
  const run = prev.then(() => fn());
  mergeQueueByGroupId.set(
    groupId,
    run.then(() => undefined).catch(() => undefined),
  );
  return run;
}

/** Chat ids holding a launch slot until runChatTurn registers streaming/setup. */
const reservedLaunchChatIds = new Set<string>();

function reserveLaunchSlot(chatId: string): void {
  reservedLaunchChatIds.add(chatId);
}

function releaseLaunchSlot(chatId: string): void {
  reservedLaunchChatIds.delete(chatId);
}

/** Release a task-chat launch slot, then re-drain the board now that capacity is free. */
function releaseLaunchSlotAndDrive(
  group: ChatGroup,
  plannerChat: Chat,
  chatId: string,
): void {
  releaseLaunchSlot(chatId);
  const chat = findChatById(chatId);
  if (chat) {
    teardownBoardTaskChatResources(chat, sessionState?.groups);
  }
  void drainTaskQueue(group, plannerChat).catch((err) =>
    reportBackgroundError('drain-after-slot-release', err),
  );
}

function isLaunchReserved(chatId: string): boolean {
  return reservedLaunchChatIds.has(chatId);
}

let streamEndSubscribed = false;
let streamActivitySubscribed = false;
let autoDriveSubscribed = false;

/** Generous multiplier over progressStallMs before killing a stuck task-chat turn. */
const TASK_CHAT_STALL_MULTIPLIER = 3;
/** Max bounded restarts per task-chat before giving up. */
const TASK_CHAT_STALL_RESTART_CAP = 2;

/** Per-chatId count of stall-triggered restarts this session. Cleared on stream end. */
const taskChatStallRestarts = new Map<string, number>();

function refreshHeartbeatThresholds(): void {
  const meta = getAutopilotMetaSync();
  setHeartbeatConfig({
    heartbeatIntervalMs: meta.heartbeatIntervalMs,
    progressStallMs: meta.progressStallMs,
    heartbeatDeadMs: meta.heartbeatDeadMs,
  });
}

/** How a linked task chat ended its latest assistant turn. */
export type TaskChatStreamOutcome = 'completed' | 'stopped' | 'failed';

/** Commit orphaned task worktree changes when a build fails terminally. */
async function commitOrphanedWorkOnTerminalFailure(
  group: ChatGroup,
  task: BoardTask,
  baseError: string,
): Promise<string> {
  const board = group.orchestrateBoard;
  if (!board) return baseError;
  const mode = resolveIsolationMode(board);
  if (mode !== 'per-task') return baseError;

  const boardId = group.id;
  const slotId = worktreeSlotId(mode, task);
  const branch = task.worktreeBranch ?? worktreeBranchFor(mode, boardId, task);
  if (!slotId || !branch) return baseError;

  try {
    const dirtyRes = await checkTaskWorktreeDirty({ boardId, slotId });
    if (!dirtyRes.ok || !dirtyRes.dirty) return baseError;

    const fileCount = dirtyRes.files?.length ?? 0;
    await commitTaskWorktree({
      boardId,
      slotId,
      message: `Board task ${task.id} (partial): ${task.title}`,
    });
    return `${baseError} Partial work committed to \`${branch}\` (${fileCount} files) — recoverable.`;
  } catch (err) {
    reportBackgroundError('worktree-commit-terminal-failure', err);
    return baseError;
  }
}

async function finalizeTerminalBuildFailure(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  chat: Chat,
  errorSummary: string,
): Promise<void> {
  const error = await commitOrphanedWorkOnTerminalFailure(group, task, errorSummary);
  updateTask(
    group,
    task.id,
    {
      endedAt: Date.now(),
      error,
    },
    plannerChat,
  );
  teardownBoardTaskChatResources(chat, sessionState?.groups);
}

/** Infer stream outcome from run status and the task chat transcript. */
export function resolveTaskChatStreamOutcome(chat: Chat): TaskChatStreamOutcome {
  const runs = chat.runs ?? [];
  if (runs.length > 0) {
    let latest = runs[0]!;
    for (const run of runs) {
      if (run.createdAt > latest.createdAt) latest = run;
    }
    if (latest.status === 'failed') return 'failed';
    if (latest.status === 'stopped') return 'stopped';
  }
  for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];
    if (msg.role === 'assistant') {
      if ('stopped' in msg && msg.stopped) return 'stopped';
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content == null
            ? ''
            : JSON.stringify(msg.content);
      if (
        content.includes('Maximum tool turns reached') ||
        content.includes('Could not complete this reply')
      ) {
        return 'failed';
      }
      return 'completed';
    }
    if (msg.role === 'user') break;
  }
  return 'failed';
}

/** Build a SelfHealDeps bag wiring all board-action callbacks. Lazy-built per call. */
function makeSelfHealDeps(): SelfHealDeps {
  return {
    ensureBoardInfraProvisioned,
    applyTaskBuildFailureState,
    applyTaskTestFailureState,
    buildBuildRetrySeedMessage,
    buildRetryBuilderSeedMessage,
    startTask,
    startTaskTesting,
    startMergeConflictFixer,
    runTaskChatNudge,
    autoDelegateNext,
    quarantineTaskAndDependents,
    resolveSelfHealMaxRounds,
    resolveAfkAutoRestartStalls,
    resolveMaxMergeFixerAttempts: () => MAX_MERGE_FIXER_ATTEMPTS,
  };
}

/**
 * Advance board task status when its linked **Builder** chat finishes streaming.
 * Successful builds move to testing; auto-pilot launches the Tester.
 */
export function finalizeBoardTaskOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): void {
  if (task.status !== 'in_progress') return;

  const chatId = task.chatId?.trim();
  if (!chatId) return;
  const chat = findChatById(chatId);
  if (!chat) return;

  const outcome = resolveTaskChatStreamOutcome(chat);

  if (outcome === 'stopped') {
    logBuildVerdict(group, task.id, 'stopped');
    updateTask(group, task.id, { endedAt: Date.now() }, plannerChat);
    return;
  }

  if (outcome === 'failed') {
    const errorSummary = 'Task chat ended without completing successfully';
    logBuildVerdict(group, task.id, 'fail', { summary: errorSummary });
    updateTask(group, task.id, { endedAt: Date.now() }, plannerChat);
    if (isBoardRunning(group)) {
      const freshTask = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
      const { category } = resolveTaskChatStreamFailure(chat);
      void runSelfHeal(
        group,
        freshTask,
        plannerChat,
        { phase: 'build', category, summary: errorSummary },
        makeSelfHealDeps(),
      ).catch((err) => reportBackgroundError('self-heal-build', err));
      return;
    }
    moveTaskStatus(group, task.id, 'failed', plannerChat);
    void finalizeTerminalBuildFailure(group, task, plannerChat, chat, errorSummary);
    return;
  }

  updateTask(
    group,
    task.id,
    { endedAt: Date.now(), error: undefined, testVerdict: undefined, testSummary: undefined },
    plannerChat,
  );
  teardownBoardTaskChatResources(chat, sessionState?.groups);
  logBuildVerdict(group, task.id, 'pass');
  moveTaskStatus(group, task.id, 'testing', plannerChat);

  const builderChat = findChatById(chatId);
  if (builderChat) {
    const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
    const lastAssistant = [...builderChat.history].reverse().find((m) => m.role === 'assistant');
    const assistantText = lastAssistant && typeof lastAssistant.content === 'string'
      ? lastAssistant.content
      : '';
    schedulePostTurnSynthesis({
      chatId: builderChat.id,
      messages: buildSynthesisMessages(builderChat),
      roundCount: builderChat.history.filter((m) => m.role === 'assistant').length,
      toolCount: 0,
      sourceExcerpt: buildSynthesisExcerpt(builderChat),
      assistantText,
      force: true,
      providerId: providerId || undefined,
      modelId: modelId || undefined,
    });
  }

  if (isBoardRunning(group)) {
    void startTaskTesting(group, task.id, plannerChat).catch((err) =>
      reportBackgroundError('start-task-testing', err),
    );
  }
}

function startTaskChatSupervision(chatId: string): void {
  const runId = chatTaskRunId(chatId);
  const supervision = createRunSupervision();
  bindRunSupervision(runId, supervision);
  startHeartbeat(runId, () => {
    const chat = findChatById(chatId);
    if (!chat?.boardGroupId) return;
    emitBoardChange(chat.boardGroupId);

    const group = getBoardGroupForChat(chat);
    if (!group?.orchestrateBoard) return;

    const mode = getBoardExecutionMode(group.orchestrateBoard);
    if (mode !== 'afk' && mode !== 'auto') return;
    if (!isBoardRunning(group)) return;

    const sup = getRunSupervision(runId);
    if (!sup) return;
    const meta = getAutopilotMetaSync();
    const stallMs = meta.progressStallMs * TASK_CHAT_STALL_MULTIPLIER;
    if (sup.lastProgressAt == null) return;
    const progressAge = performance.now() - sup.lastProgressAt;
    if (progressAge < stallMs) return;

    const restarts = taskChatStallRestarts.get(chatId) ?? 0;
    if (restarts >= TASK_CHAT_STALL_RESTART_CAP) return;

    const taskId = chat.boardTaskId;
    if (!taskId) return;

    taskChatStallRestarts.set(chatId, restarts + 1);
    // Stop the heartbeat timer only — do NOT call stopTaskChatSupervision here, as that
    // would delete the counter we just set. The counter is cleared on stream end.
    stopHeartbeat(chatTaskRunId(chatId));
    stopGeneration(chatId);

    const planner = getPlannerChatForGroup(group);
    if (!planner) return;

    const stallReason = `task-chat-stall (${progressAge}ms no output)`;
    if (restarts === 0) {
      void runTaskChatNudge(group, taskId, planner, stallReason).catch((err) =>
        reportBackgroundError('task-chat-stall-nudge', err),
      );
    } else {
      const stallTask = group.orchestrateBoard.tasks.find((t) => t.id === taskId);
      if (stallTask) {
        void runSelfHeal(group, stallTask, planner, { phase: 'build', category: 'stall', summary: stallReason }, makeSelfHealDeps())
          .catch((err) => reportBackgroundError('task-chat-stall-selfheal', err));
      }
    }
  });
}

function stopTaskChatSupervision(chatId: string): void {
  taskChatStallRestarts.delete(chatId);
  stopHeartbeat(chatTaskRunId(chatId));
}

function isTaskChatStreaming(chatId: string): boolean {
  return (
    isChatStreaming(chatId) ||
    isChatTurnSetupPending(chatId) ||
    isLaunchReserved(chatId)
  );
}

/** Provider/model for a board task chat — planner binding, then top-bar model select. */
function resolvePlannerModelBinding(plannerChat: Chat): {
  providerId: string;
  modelId: string;
} {
  let providerId = plannerChat.providerId?.trim() ?? '';
  let modelId = plannerChat.modelId?.trim() ?? '';
  if (!modelId) {
    const domRaw =
      (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value?.trim() ??
      '';
    if (domRaw) {
      const parsed = decodeModelSelectKey(domRaw);
      if (parsed) {
        providerId = providerId || parsed.providerId;
        modelId = parsed.modelId;
      } else {
        modelId = domRaw;
      }
    }
  }
  if (!modelId) {
    const meta = getAutopilotMetaSync();
    providerId = providerId || meta.plannerProviderId?.trim() || '';
    modelId = meta.plannerModelId?.trim() || '';
  }
  return { providerId, modelId };
}

/** Keep task/test/final chats aligned with the planner model before launching a turn. */
function syncTaskChatModelFromPlanner(taskChat: Chat, plannerChat: Chat): void {
  const binding = resolvePlannerModelBinding(plannerChat);
  if (binding.providerId) taskChat.providerId = binding.providerId;
  if (binding.modelId) taskChat.modelId = binding.modelId;
}

type BoardChatRole = 'build' | 'tester' | 'fixer';

function getOrCreateBoardChat(input: {
  group: ChatGroup;
  plannerChat: Chat;
  existingId?: string;
  role: BoardChatRole;
  name: string;
  taskId?: string;
  taskChatField?: 'chatId' | 'testChatId' | 'fixerChatId';
}): Chat {
  const { providerId, modelId } = resolvePlannerModelBinding(input.plannerChat);
  const folderId = input.group.id;
  const existingId = input.existingId?.trim();

  if (existingId) {
    const existing = findChatById(existingId);
    if (existing) {
      if (input.taskId) existing.boardTaskId = input.taskId;
      if (input.role === 'tester') existing.workAgentId = 'tester';
      if (input.role === 'fixer') existing.workAgentId = null;
      syncTaskChatModelFromPlanner(existing, input.plannerChat);
      return existing;
    }
  }

  const chat = createEmptyChatObject(modelId, input.plannerChat.workspacePath);
  chat.providerId = providerId;
  chat.modeId = 'build';
  chat.workAgentId = input.role === 'tester' ? 'tester' : null;
  chat.name = input.name;
  chat.groupId = folderId;
  chat.boardGroupId = folderId;
  if (input.taskId) chat.boardTaskId = input.taskId;
  requireSession().chats.unshift(chat);
  if (input.taskId && input.taskChatField) {
    updateTask(
      input.group,
      input.taskId,
      { [input.taskChatField]: chat.id },
      input.plannerChat,
    );
  }
  assignChatToGroup(chat.id, folderId);
  return chat;
}

function ensureStreamEndSubscription(): void {
  if (!streamEndSubscribed) {
    streamEndSubscribed = true;
    subscribeChatStreamEnd((endedChatId) => {
      stopTaskChatSupervision(endedChatId);
      if (!sessionState) return;
      // Drain now, then again after a microtask: notifyChatStreamEnded fires
      // before setStreaming(false) clears the ended chat, so in sequential mode
      // the concurrency check sees count=1 and enqueues instead of starting.
      // Re-drain after the flag clears. Rejections are logged, never swallowed.
      const safeDrain = (g: ChatGroup, p: Chat): void => {
        void drainTaskQueue(g, p).catch((err) =>
          reportBackgroundError('drain-task-queue', err),
        );
        queueMicrotask(() =>
          void drainTaskQueue(g, p).catch((err) =>
            reportBackgroundError('drain-task-queue', err),
          ),
        );
      };
      for (const group of sessionState.groups ?? []) {
        const board = group.orchestrateBoard;
        if (!board) continue;
        const planner = getPlannerChatForGroup(group);
        if (!planner) continue;

        const finalChatId = board.finalTest?.chatId?.trim();
        if (finalChatId && endedChatId === finalChatId) {
          finalizeFinalTestOnStreamEnd(group, planner);
          safeDrain(group, planner);
          continue;
        }

        const taskByBuild = board.tasks.find((t) => t.chatId === endedChatId);
        if (taskByBuild) {
          finalizeBoardTaskOnStreamEnd(group, taskByBuild, planner);
          safeDrain(group, planner);
          continue;
        }

        const taskByTest = board.tasks.find((t) => t.testChatId === endedChatId);
        if (taskByTest) {
          const testChat = findChatById(endedChatId);
          if (testChat) {
            teardownBoardTaskChatResources(testChat, sessionState?.groups);
          }
          void finalizeTaskTestingOnStreamEnd(group, taskByTest, planner)
            .then(() => safeDrain(group, planner))
            .catch((err) => reportBackgroundError('finalize-task-testing', err));
          continue;
        }

        const taskByFixer = board.tasks.find((t) => t.fixerChatId === endedChatId);
        if (taskByFixer) {
          void finalizeMergeFixerOnStreamEnd(group, taskByFixer, planner)
            .then(() => safeDrain(group, planner))
            .catch((err) => reportBackgroundError('finalize-merge-fixer', err));
        }
      }
    });
  }
  if (!streamActivitySubscribed) {
    streamActivitySubscribed = true;
    subscribeChatStreamActivity((chatId) => {
      const chat = findChatById(chatId);
      if (!chat?.boardTaskId) return;
      bumpProgress(chatTaskRunId(chatId));
      if (chat.boardGroupId) emitBoardChange(chat.boardGroupId);
    });
  }
}

/** Resolved max concurrent tasks: sequential → 1; else board ?? global ?? fallback. */
export function resolveBoardMaxConcurrent(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): number {
  if (board.executionMode === 'sequential') return 1;
  const boardVal = board.maxConcurrentTasks;
  if (typeof boardVal === 'number' && boardVal > 0) return boardVal;
  return getAutopilotMetaSync().maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT;
}

function maxConcurrent(board: NonNullable<ChatGroup['orchestrateBoard']>): number {
  return resolveBoardMaxConcurrent(board);
}

/** Skip launching background chat turns under node:test (avoids open handles). */
function skipBackgroundBoardChatLaunch(): boolean {
  return (
    typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.MINNOW_TEST === '1'
  );
}

/** Phase label for a running board task slot (build / test / fix / final integration). */
export type RunningBoardTaskPhase = 'build' | 'test' | 'fix' | 'final';

/** One concurrency slot occupied by a streaming or launching task chat. */
export interface RunningBoardTaskSlot {
  taskId: string;
  title: string;
  chatId: string;
  phase: RunningBoardTaskPhase;
  task?: BoardTask;
  isFinalTest?: boolean;
}

function runningSlotPhaseForTask(
  task: BoardTask,
  chatId: string,
): RunningBoardTaskPhase {
  if (task.fixerChatId?.trim() === chatId) return 'fix';
  if (task.testChatId?.trim() === chatId) return 'test';
  if ((task.testAttempts ?? 0) > 0 && task.status === 'in_progress') return 'fix';
  return 'build';
}

/** Running task / tester / final-integration chats occupying a concurrency slot. */
export function countRunningTaskChats(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): number {
  return listRunningBoardTaskSlots(board).length;
}

/** Enumerate active board task chats (build, test, fixer, final integration). */
export function listRunningBoardTaskSlots(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): RunningBoardTaskSlot[] {
  const seen = new Set<string>();
  const slots: RunningBoardTaskSlot[] = [];
  const push = (
    chatId: string | undefined,
    slot: Omit<RunningBoardTaskSlot, 'chatId'>,
  ): void => {
    const id = chatId?.trim();
    if (!id || seen.has(id)) return;
    if (!isTaskChatStreaming(id)) return;
    seen.add(id);
    slots.push({ ...slot, chatId: id });
  };
  for (const task of board.tasks) {
    const buildId = task.chatId?.trim();
    if (buildId) {
      push(buildId, {
        taskId: task.id,
        title: task.title,
        phase: runningSlotPhaseForTask(task, buildId),
        task,
      });
    }
    const testId = task.testChatId?.trim();
    if (testId) {
      push(testId, {
        taskId: task.id,
        title: task.title,
        phase: 'test',
        task,
      });
    }
    const fixerId = task.fixerChatId?.trim();
    if (fixerId) {
      push(fixerId, {
        taskId: task.id,
        title: task.title,
        phase: 'fix',
        task,
      });
    }
  }
  push(board.finalTest?.chatId, {
    taskId: FULL_BOARD_TEST_ID,
    title: 'Final integration test',
    phase: 'final',
    isFinalTest: true,
  });
  return slots;
}

/** True when a task-linked chat is starting or streaming (occupies a concurrency slot). */
export function isTaskChatActive(chatId: string): boolean {
  return isTaskChatStreaming(chatId);
}

function resolveBoardContext(plannerOrMemberChat: Chat): {
  group: ChatGroup;
  planner: Chat;
} | null {
  const group = getBoardGroupForChat(plannerOrMemberChat);
  if (!group?.orchestrateBoard) return null;
  const planner =
    getPlannerChatForGroup(group) ??
    (plannerOrMemberChat.boardGroupId === group.id ? plannerOrMemberChat : null);
  if (!planner) return null;
  return { group, planner };
}

export function buildTaskSeedMessage(
  group: ChatGroup,
  plannerChat: Chat,
  task: BoardTask,
): string {
  const board = group.orchestrateBoard!;
  const planPath =
    group.orchestratePlanPath?.trim() ||
    plannerChat.orchestratePlanPath?.trim() ||
    board.planPath;
  const build = task.buildSpec?.trim() || '(see plan)';
  const test = task.testSpec?.trim() || '(see plan)';
  const lines = [
    'Execute this orchestrate task.',
    '',
    `Plan: ${planPath}`,
    `Task: ${task.id} — ${task.title}`,
    `Wave: ${task.wave}`,
    '',
    'Build:',
    build,
    '',
    'Test:',
    test,
    '',
    'Read the plan file for full context if needed. Report what you changed.',
    `When done, call board_report_build_result({ task_id: "${task.id}", status: "ok"|"env_blocked"|"failed", summary: "..." }).`,
    'Use env_blocked (with blockers) if services/commands were missing; never report ok unless verification actually ran.',
  ];
  if (task.worktreePath?.trim()) {
    lines.push('', `Working directory: ${task.worktreePath.trim()}. Keep all file/terminal ops inside it; don't cd to the original repo or any absolute path — use relative paths.`);
  }
  return lines.join('\n');
}

/** Compact Builder seed after a per-task test failure (fresh chat, no history bloat). */
export function buildRetryBuilderSeedMessage(task: BoardTask, attempt: number, testSummary: string): string {
  const build = task.buildSpec?.trim() || '(see plan)';
  const lines = [
    'Fix this orchestrate task after a failed test.',
    '',
    `Task: ${task.id} — ${task.title}`,
    '',
    'Build:',
    build,
    '',
    `Previous attempt failed testing (${attempt}/${resolveMaxTaskTestAttempts()}): ${testSummary}`,
    '',
    'Fix the issues and report what you changed.',
  ];
  if (task.worktreePath?.trim()) {
    lines.push('', `Working directory: ${task.worktreePath.trim()}. Keep all file/terminal ops inside it; don't cd to the original repo or any absolute path — use relative paths.`);
  }
  return lines.join('\n');
}

/** Compact Builder seed after a failed build chat (auto/afk retry). */
export function buildBuildRetrySeedMessage(
  task: BoardTask,
  attempt: number,
  errorSummary: string,
): string {
  const build = task.buildSpec?.trim() || '(see plan)';
  const lines = [
    'Fix this orchestrate task after a failed build attempt.',
    '',
    `Task: ${task.id} — ${task.title}`,
    '',
    'Build:',
    build,
    '',
    `Previous build attempt failed (${attempt}/${resolveMaxTaskBuildAttempts()}): ${errorSummary}`,
    '',
    'Fix the issues and report what you changed.',
    `Call board_report_build_result({ task_id: "${task.id}", status: "ok"|"env_blocked"|"failed", summary: "..." }) when done.`,
    'Use env_blocked (with blockers) if services were unavailable; never report ok unless verification actually ran.',
  ];
  if (task.worktreePath?.trim()) {
    lines.push('', `Working directory: ${task.worktreePath.trim()}. Keep all file/terminal ops inside it; don't cd to the original repo or any absolute path — use relative paths.`);
  }
  return lines.join('\n');
}

/** Seed for per-task Tester (headless — no browser). */
export function buildTaskTestSeedMessage(
  group: ChatGroup,
  plannerChat: Chat,
  task: BoardTask,
): string {
  const board = group.orchestrateBoard!;
  const planPath =
    group.orchestratePlanPath?.trim() ||
    plannerChat.orchestratePlanPath?.trim() ||
    board.planPath;
  const test = task.testSpec?.trim() || '(derive checks from build spec and changed files)';
  const build = task.buildSpec?.trim() || '(see plan)';
  return [
    'Run per-task testing (headless — no browser, no dev server).',
    '',
    `Plan: ${planPath}`,
    `Task: ${task.id} — ${task.title}`,
    '',
    'Build (what the Builder implemented):',
    build,
    '',
    'Test spec:',
    test,
    '',
    'Verify with git_diff, static integration review, and project scripts (typecheck → lint → unit → build).',
    'If setup/services fail (DB connection refused, missing binary, port unavailable), report fail with the service name — do not blame the code for an env problem.',
    `Report exactly once via board_report_test_result({ task_id: "${task.id}", verdict: "pass" | "fail", summary: "..." }).`,
  ].join('\n');
}

/** Seed for full-board final integration test (includes browser smoke). */
export function buildFinalIntegrationTestSeedMessage(
  group: ChatGroup,
  plannerChat: Chat,
): string {
  const board = group.orchestrateBoard!;
  const planPath =
    group.orchestratePlanPath?.trim() ||
    plannerChat.orchestratePlanPath?.trim() ||
    board.planPath;
  const taskList = board.tasks
    .map((t) => `- ${t.id}: ${t.title} (${t.status})`)
    .join('\n');
  return [
    'Run final full-board integration testing (includes browser smoke when available).',
    '',
    `Plan: ${planPath}`,
    '',
    'Board tasks:',
    taskList,
    '',
    'Exercise the whole app end-to-end. On failure, identify responsible task ids via board_get_state.',
    `Report exactly once via board_report_test_result({ task_id: "${FULL_BOARD_TEST_ID}", verdict: "pass" | "fail", summary: "...", failing_tasks: [...] }).`,
  ].join('\n');
}

/** Resume a queued or stalled board task (Builder vs Tester by column). */
async function resumeBoardTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  const task = board?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.status === 'testing') {
    await startTaskTesting(group, taskId, plannerChat);
    return;
  }
  await startTask(group, taskId, plannerChat);
}

/** Count assistant turns in a task chat transcript. */
function countChatAssistantTurns(chat: Chat): number {
  return chat.history.filter((m) => m.role === 'assistant').length;
}

/** Sum usage tokens from a task chat transcript (best-effort). */
function sumChatHistoryTokens(chat: Chat): number {
  let total = 0;
  for (const msg of chat.history) {
    if (msg.role === 'assistant' && msg.usage?.total_tokens) {
      total += msg.usage.total_tokens;
    }
  }
  const lastTotal = chat.lastStats?.total_tokens;
  if (typeof lastTotal === 'number' && Number.isFinite(lastTotal)) {
    total = Math.max(total, lastTotal);
  }
  return total;
}

const CONSERVATIVE_CONTINUE_ASSISTANT_TURNS = 24;
const CONSERVATIVE_CONTINUE_TOKEN_THRESHOLD = 120_000;
const AGGRESSIVE_CONTINUE_ASSISTANT_TURNS = 10;
const AGGRESSIVE_CONTINUE_TOKEN_THRESHOLD = 50_000;

/** True when Continue should hand off to a fresh summarized chat instead of nudging. */
export function shouldRouteContinueToNewChat(chat: Chat, task: BoardTask): boolean {
  const mode = getAutopilotMetaSync().continueSmartRoute ?? 'conservative';
  if (mode === 'off') return false;
  const hasAssistant = chat.history.some((m) => m.role === 'assistant');
  if (hasAssistant && resolveTaskChatStreamOutcome(chat) === 'failed') return true;
  const assistantTurns = countChatAssistantTurns(chat);
  const tokens = sumChatHistoryTokens(chat);
  if (mode === 'aggressive') {
    return (
      assistantTurns > AGGRESSIVE_CONTINUE_ASSISTANT_TURNS ||
      tokens > AGGRESSIVE_CONTINUE_TOKEN_THRESHOLD
    );
  }
  return (
    assistantTurns > CONSERVATIVE_CONTINUE_ASSISTANT_TURNS ||
    tokens > CONSERVATIVE_CONTINUE_TOKEN_THRESHOLD
  );
}

/** Short nudge appended to an existing build chat — no full task reseed. */
export function buildContinueNudgeMessage(task: BoardTask, priorError?: string): string {
  const lines = [
    `Continue the orchestrate task ${task.id} — ${task.title} where you left off.`,
    "Pick up from your last step; don't restart from scratch.",
  ];
  const err = priorError?.trim();
  if (err) {
    lines.push(`The prior attempt errored mid-way: ${err}`);
  }
  lines.push('Report what you changed.');
  return lines.join(' ');
}

/** Compact digest of build-chat progress for summary handoff. */
export function buildTaskProgressSummary(chat: Chat, task: BoardTask): string {
  const excerpt = buildSynthesisExcerpt(chat).trim();
  const messages = buildSynthesisMessages(chat);
  const digest = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n')
    .trim();
  const parts: string[] = [];
  if (excerpt) parts.push(`Recent excerpt:\n${excerpt}`);
  if (digest) parts.push(`Conversation digest:\n${digest}`);
  const testSummary = task.testSummary?.trim();
  if (testSummary) parts.push(`Last test summary: ${testSummary}`);
  return parts.join('\n\n') || '(no prior chat history)';
}

/** Seed for explicit move-to-new-chat handoff (summary + remaining work). */
export function buildMoveToNewChatSeed(
  group: ChatGroup,
  plannerChat: Chat,
  task: BoardTask,
  summary: string,
): string {
  const board = group.orchestrateBoard!;
  const planPath =
    group.orchestratePlanPath?.trim() ||
    plannerChat.orchestratePlanPath?.trim() ||
    board.planPath;
  const build = task.buildSpec?.trim() || '(see plan)';
  const test = task.testSpec?.trim() || '(see plan)';
  return [
    'Continue this orchestrate task in a fresh chat.',
    '',
    `Plan: ${planPath}`,
    `Task: ${task.id} — ${task.title}`,
    '',
    'Progress so far:',
    summary.trim() || '(no prior chat history)',
    '',
    'Remaining work — Build:',
    build,
    '',
    'Test:',
    test,
    '',
    'Pick up where the previous chat left off. Do not restart from scratch unless necessary.',
    'Report what you changed.',
  ].join('\n');
}

type ClearTaskFailureOptions = { resetAttempts: boolean };

/** Snapshot and clear stale failure UI fields (shared by all recovery actions). */
export function clearTaskFailureState(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  opts: ClearTaskFailureOptions,
): BoardTask {
  const hasFailure = Boolean(
    task.error?.trim() || task.testSummary?.trim() || task.testVerdict,
  );
  const patch: Parameters<typeof updateTask>[2] = {
    error: undefined,
    testVerdict: undefined,
    testSummary: undefined,
  };
  if (hasFailure) {
    patch.prevFailure = {
      ...(task.error?.trim() ? { error: task.error.trim() } : {}),
      ...(task.testSummary?.trim() ? { testSummary: task.testSummary.trim() } : {}),
      ...(task.testVerdict ? { testVerdict: task.testVerdict } : {}),
      at: Date.now(),
    };
  }
  if (opts.resetAttempts) {
    patch.testAttempts = undefined;
    patch.buildAttempts = undefined;
  }
  if (task.status === 'merging') {
    patch.status = 'in_progress';
    patch.fixerChatId = undefined;
    patch.mergePreSha = undefined;
    patch.fixerAttempts = undefined;
  }
  return updateTask(group, task.id, patch, plannerChat);
}

/** Run a continue nudge on the existing build chat (no original-prompt reseed). */
export async function runTaskChatNudge(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
  priorError?: string,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const existingChatId = task.chatId?.trim();
  if (!existingChatId) {
    await startTask(group, taskId, plannerChat);
    return;
  }
  if (isTaskChatActive(existingChatId)) return;

  if (countRunningTaskChats(board) >= maxConcurrent(board)) {
    enqueueTask(group.id, taskId);
    return;
  }

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();

  const { modelId } = resolvePlannerModelBinding(plannerChat);
  if (!modelId) {
    updateTask(
      group,
      taskId,
      { error: 'Select a model for the orchestrate planner before starting tasks' },
      plannerChat,
    );
    return;
  }

  const taskChat = findChatById(existingChatId);
  if (!taskChat) {
    await startTask(group, taskId, plannerChat);
    return;
  }

  reserveLaunchSlot(taskChat.id);
  try {
    const { renderSidebar } = await import('../ui/sidebar.ts');
    renderSidebar();

    const worktreeRoot = await ensureTaskWorktree(group, task, plannerChat);
    if (worktreeRoot) {
      taskChat.worktreeRoot = worktreeRoot;
      scheduleSaveSessions();
    }

    const nudge = buildContinueNudgeMessage(task, priorError);
    refreshHeartbeatThresholds();
    startTaskChatSupervision(taskChat.id);

    void runChatTurn({
      chat: taskChat,
      pushUser: true,
      rawText: nudge,
      userText: nudge,
      displayText: nudge,
      historyContent: nudge,
      skillId: null,
      validAttachments: [],
      titleSeed: task.title,
      ownsGlobalStreaming: true,
    }).catch((err) => {
      const message =
        err instanceof Error ? err.message : 'Task chat failed to continue';
      updateTask(
        group,
        taskId,
        { error: message || 'Task chat failed to continue' },
        plannerChat,
      );
    }).finally(() => releaseLaunchSlotAndDrive(group, plannerChat, taskChat.id));
  } catch (err) {
    releaseLaunchSlotAndDrive(group, plannerChat, taskChat.id);
    throw err;
  }
}

/** Continue without reseeding the original build prompt (MIN-222). */
export async function continueBoardTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  const task = board?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.status === 'testing') {
    await startTaskTesting(group, taskId, plannerChat);
    return;
  }
  clearTaskFailureState(group, task, plannerChat, { resetAttempts: false });
  const fresh = board!.tasks.find((t) => t.id === taskId)!;
  const chatId = fresh.chatId?.trim();
  const chat = chatId ? findChatById(chatId) : undefined;
  if (chat && shouldRouteContinueToNewChat(chat, fresh)) {
    await moveTaskToNewChat(group, taskId, plannerChat);
    return;
  }
  await runTaskChatNudge(group, taskId, plannerChat);
}

/** Re-seed the original build prompt in a fresh chat (MIN-222). */
export async function restartBoardTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  const task = board?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const buildId = task.chatId?.trim();
  const testId = task.testChatId?.trim();
  if (
    (buildId && isTaskChatActive(buildId)) ||
    (testId && isTaskChatActive(testId))
  ) {
    await stopTask(group, taskId, plannerChat);
  }
  const stopped = board!.tasks.find((t) => t.id === taskId)!;
  clearTaskFailureState(group, stopped, plannerChat, { resetAttempts: true });
  const seed = buildTaskSeedMessage(group, plannerChat, stopped);
  updateTask(group, taskId, { pendingBuildSeed: seed }, plannerChat);
  await startTask(group, taskId, plannerChat);
}

/** Summarize progress and seed a fresh build chat (MIN-222). */
export async function moveTaskToNewChat(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  const task = board?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  clearTaskFailureState(group, task, plannerChat, { resetAttempts: false });
  const fresh = board!.tasks.find((t) => t.id === taskId)!;
  const chat = fresh.chatId?.trim() ? findChatById(fresh.chatId.trim()) : undefined;
  const summary = chat ? buildTaskProgressSummary(chat, fresh) : '';
  const seed = buildMoveToNewChatSeed(group, plannerChat, fresh, summary);
  updateTask(group, taskId, { pendingBuildSeed: seed }, plannerChat);
  await startTask(group, taskId, plannerChat);
}

/** Stop one running board slot (task build/test/fixer or final integration chat). */
export async function stopRunningBoardSlot(
  group: ChatGroup,
  slot: RunningBoardTaskSlot,
  plannerChat: Chat,
): Promise<void> {
  if (slot.isFinalTest) {
    const chatId = slot.chatId?.trim();
    if (chatId) {
      stopTaskChatSupervision(chatId);
      stopGeneration(chatId);
    }
    await drainTaskQueue(group, plannerChat);
    return;
  }
  await stopTask(group, slot.taskId, plannerChat);
}

async function drainTaskQueue(group: ChatGroup, plannerChat: Chat): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const queue = taskQueueByGroupId.get(group.id);
  if (!queue?.length) return;
  // Promote tasks already in testing ahead of queued builds so each task keeps
  // its single slot across build→test→complete. Needed because
  // notifyChatStreamEnded fires before setStreaming(false), causing
  // startTaskTesting to enqueue at the back while the build chat still appears
  // active; the deferred microtask drain then needs the correct order.
  if (queue.length > 1) {
    queue.sort((a, b) => {
      const sa = board.tasks.find((t) => t.id === a)?.status;
      const sb = board.tasks.find((t) => t.id === b)?.status;
      return (sa === 'testing' ? 0 : 1) - (sb === 'testing' ? 0 : 1);
    });
  }
  while (queue.length > 0 && countRunningTaskChats(board) < maxConcurrent(board)) {
    const nextId = queue.shift()!;
    await resumeBoardTask(group, nextId, plannerChat);
  }
  if (!queue.length) {
    taskQueueByGroupId.delete(group.id);
  }
}

function enqueueTask(groupId: string, taskId: string): void {
  const q = taskQueueByGroupId.get(groupId) ?? [];
  if (!q.includes(taskId)) q.push(taskId);
  taskQueueByGroupId.set(groupId, q);
}

/**
 * Ensure an isolated git worktree for a task when board isolation is active, and
 * return its absolute path (also persisted on the task). Best-effort: returns null
 * when isolation is off or any git/server step fails, so the task falls back to the
 * shared workspace and execution is never blocked (MIN-275).
 */
async function ensureTaskWorktree(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<string | null> {
  const board = group.orchestrateBoard;
  if (!board) return null;
  const mode = resolveIsolationMode(board);
  if (mode === 'off') return null;

  const boardId = group.id;
  const branch = worktreeBranchFor(mode, boardId, task);
  const slotId = worktreeSlotId(mode, task);
  if (!branch || !slotId) return null;

  // Mint the integration branch + its worktree once per board (lazy).
  const integrationBranch = board.integrationBranch ?? boardIntegrationBranch(boardId);
  if (!board.integrationBranch) {
    const ensured = await ensureIntegrationWorktree({ boardId, branch: integrationBranch });
    if (!ensured.ok) return null;
    board.integrationBranch = integrationBranch;
    scheduleSaveSessions();
  }

  // Per-wave mode: reuse a sibling task's already-created worktree for this wave.
  const shared = board.tasks.find(
    (t) => t.id !== task.id && t.worktreeBranch === branch && Boolean(t.worktreePath),
  );
  if (shared?.worktreePath) {
    const synced = await createTaskWorktreeOp({
      boardId,
      slotId,
      branch,
      baseRef: integrationBranch,
    });
    const path = synced.ok && synced.path ? synced.path : shared.worktreePath;
    updateTask(
      group,
      task.id,
      {
        worktreePath: path,
        worktreeBranch: branch,
        devPort: shared.devPort,
        apiPort: shared.apiPort,
      },
      plannerChat,
    );
    if (
      typeof shared.devPort === 'number' &&
      typeof shared.apiPort === 'number'
    ) {
      logWorktreeAllocated(group, task.id, branch, shared.devPort, shared.apiPort);
    }
    return path;
  }

  const created = await createTaskWorktreeOp({
    boardId,
    slotId,
    branch,
    baseRef: integrationBranch,
  });
  if (!created.ok || !created.path) return null;

  const freshTask = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
  const used = usedDevPorts(board.tasks);
  const ports =
    typeof freshTask.devPort === 'number' &&
    Number.isFinite(freshTask.devPort) &&
    typeof freshTask.apiPort === 'number' &&
    Number.isFinite(freshTask.apiPort)
      ? { devPort: freshTask.devPort, apiPort: freshTask.apiPort }
      : allocateTaskPorts(DEFAULT_BOARD_PORT_BASE, used);
  const { devPort, apiPort } = ports;
  if (
    freshTask.worktreePath !== created.path ||
    freshTask.worktreeBranch !== branch ||
    freshTask.devPort !== devPort ||
    freshTask.apiPort !== apiPort
  ) {
    updateTask(
      group,
      task.id,
      { worktreePath: created.path, worktreeBranch: branch, devPort, apiPort },
      plannerChat,
    );
    logWorktreeAllocated(group, task.id, branch, devPort, apiPort);
  }
  return created.path;
}

/**
 * Fold a passed task's branch into integration. Returns whether the merge landed.
 * Auto-commits the task worktree first (per-task isolation only). Serialized per board.
 */
async function mergeCompletedTaskWorktree(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<MergeTaskWorktreeResult> {
  const board = group.orchestrateBoard;
  if (!board?.integrationBranch) {
    logMergeResult(group, task.id, 'skipped');
    return { outcome: 'skipped' };
  }
  const branch = task.worktreeBranch;
  if (!branch || branch === board.integrationBranch) {
    logMergeResult(group, task.id, 'skipped', { branch });
    return { outcome: 'skipped' };
  }

  const mode = resolveIsolationMode(board);
  const boardId = group.id;

  if (mode === 'per-task') {
    const slotId = worktreeSlotId(mode, task);
    if (slotId) {
      try {
        await commitTaskWorktree({
          boardId,
          slotId,
          message: `Board task ${task.id}: ${task.title}`,
        });
      } catch (err) {
        reportBackgroundError('worktree-commit', err);
      }
    }
  } else if (mode !== 'off') {
    reportBackgroundError(
      'worktree-commit',
      new Error(`Skipping auto-commit for task ${task.id}: isolation mode is ${mode}`),
    );
  }

  try {
    const res = await mergeTaskIntoIntegration({
      boardId,
      fromBranch: branch,
      message: `Merge ${task.id} (${task.title}) into integration`,
    });
    if (res.ok) {
      const verified = await verifyIntegrationMergeOp({ boardId, fromBranch: branch });
      if (verified.ok && verified.verified) {
        try {
          await refreshIntegrationDepsOp({ boardId, sinceSha: res.integrationSha });
        } catch (err) {
          reportBackgroundError('worktree-refresh-deps', err);
        }
        logMergeResult(group, task.id, 'merged', { branch });
        return { outcome: 'merged' };
      }
      const reasons = verified.reasons?.join('; ') || 'Integration merge verification failed';
      if (res.integrationSha) {
        await restoreIntegrationWorktree({ boardId, sha: res.integrationSha }).catch((err) =>
          reportBackgroundError('worktree-restore-integration', err),
        );
      }
      logMergeResult(group, task.id, 'error', { branch, error: reasons });
      return { outcome: 'error', message: reasons };
    }
    if (res.conflict) {
      logMergeResult(group, task.id, 'conflict', { branch });
      return {
        outcome: 'conflict',
        conflictedFiles: res.conflictedFiles ?? [],
        integrationSha: res.integrationSha,
      };
    }
    const mergeErr = res.error ?? res.output ?? 'Integration merge failed';
    logMergeResult(group, task.id, 'error', { branch, error: mergeErr });
    return {
      outcome: 'error',
      message: mergeErr,
    };
  } catch (err) {
    reportBackgroundError('worktree-merge', err);
    const message = err instanceof Error ? err.message : String(err);
    logMergeResult(group, task.id, 'error', { branch, error: message });
    return {
      outcome: 'error',
      message,
    };
  }
}

/** Run mergeCompletedTaskWorktree on the per-board merge queue (waits for fixers). */
function enqueueMergeCompletedTaskWorktree(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<MergeTaskWorktreeResult> {
  return enqueueBoardMerge(group.id, async () => {
    await waitForNoActiveFixer(group);
    return mergeCompletedTaskWorktree(group, task, plannerChat);
  });
}

/** Seed for a merge-conflict fixer chat (runs in the integration worktree). */
function buildMergeFixerSeedMessage(
  task: BoardTask,
  conflictedFiles: string[],
): string {
  const branch = task.worktreeBranch?.trim() || '(unknown branch)';
  const fileList =
    conflictedFiles.length > 0
      ? conflictedFiles.map((f) => `- ${f}`).join('\n')
      : '- (run git status to list conflicted files)';
  return [
    `Resolve the in-progress git merge of \`${branch}\` into integration.`,
    '',
    'The merge is already in progress in this integration worktree (MERGE_HEAD is set).',
    'Do not run `git merge`, `git reset`, `git checkout`, or `git merge --abort` —',
    'those commands destroy the in-progress merge state.',
    '',
    'Conflicted files:',
    fileList,
    '',
    'Steps:',
    '1. Resolve conflict markers in the listed files (and handle add/delete conflicts via `git add` / `git rm`).',
    '2. `git add` each resolved path.',
    '3. Finish with `git commit --no-edit` (uses the prepared merge message and records both parents).',
    '',
    'Touch only conflicted regions. Do not run git push.',
  ].join('\n');
}

/** Spawn a fixer chat to resolve an integration merge conflict. */
export async function startMergeConflictFixer(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  conflictedFiles: string[],
  integrationSha?: string,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board?.integrationBranch) return;

  const ensured = await ensureIntegrationWorktree({
    boardId: group.id,
    branch: board.integrationBranch,
  });
  const integrationPath = ensured.path?.trim();
  if (!integrationPath) {
    moveTaskStatus(group, task.id, 'blocked', plannerChat);
    updateTask(
      group,
      task.id,
      { error: 'Integration worktree missing; cannot spawn merge fixer' },
      plannerChat,
    );
    return;
  }

  moveTaskStatus(group, task.id, 'merging', plannerChat);

  const preSha = integrationSha?.trim() || task.mergePreSha?.trim();
  if (preSha) {
    updateTask(group, task.id, { mergePreSha: preSha }, plannerChat);
  }

  const fixerChat = getOrCreateBoardChat({
    group,
    plannerChat,
    existingId: task.fixerChatId?.trim(),
    role: 'fixer',
    name: `Fix merge ${task.id}: ${task.title}`,
    taskId: task.id,
    taskChatField: 'fixerChatId',
  });

  fixerChat.worktreeRoot = integrationPath;
  scheduleSaveSessions();

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();
  reserveLaunchSlot(fixerChat.id);
  try {
    const seed = buildMergeFixerSeedMessage(task, conflictedFiles);
    void runChatTurn({
      chat: fixerChat,
      pushUser: true,
      rawText: seed,
      userText: seed,
      displayText: seed,
      historyContent: seed,
      skillId: null,
      validAttachments: [],
      titleSeed: `Fix merge ${task.id}`,
      ownsGlobalStreaming: true,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : 'Merge fixer chat failed to start';
      updateTask(group, task.id, { error: message }, plannerChat);
    }).finally(() => releaseLaunchSlotAndDrive(group, plannerChat, fixerChat.id));
  } catch (err) {
    releaseLaunchSlotAndDrive(group, plannerChat, fixerChat.id);
    throw err;
  }
}

/** Route merge fixer stream-end: confirm merge or block the task. */
async function finalizeMergeFixerOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<void> {
  if (task.status !== 'merging') return;
  const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
  const branch = fresh.worktreeBranch?.trim();
  if (!branch) {
    moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
    return;
  }

  const boardId = group.id;
  const attempts = fresh.fixerAttempts ?? 0;

  try {
    const merged = await checkTaskBranchMerged({ boardId, fromBranch: branch });
    const verified =
      merged.ok && merged.merged
        ? await verifyIntegrationMergeOp({ boardId, fromBranch: branch })
        : null;

    if (merged.ok && merged.merged && verified?.ok && verified.verified) {
      const mergePreSha = fresh.mergePreSha?.trim();
      try {
        await refreshIntegrationDepsOp({ boardId, sinceSha: mergePreSha });
      } catch (err) {
        reportBackgroundError('worktree-refresh-deps', err);
      }
      updateTask(
        group,
        fresh.id,
        {
          fixerChatId: undefined,
          error: undefined,
          fixerAttempts: undefined,
          mergePreSha: undefined,
        },
        plannerChat,
      );
      moveTaskStatus(group, fresh.id, 'complete', plannerChat);
      return;
    }

    const preSha = fresh.mergePreSha?.trim();
    if (preSha) {
      await restoreIntegrationWorktree({ boardId, sha: preSha }).catch((err) =>
        reportBackgroundError('worktree-restore-integration', err),
      );
    }

    if (attempts < MAX_MERGE_FIXER_ATTEMPTS - 1) {
      const nextAttempts = attempts + 1;
      logTaskRetry(group, fresh.id, 'fixer', nextAttempts);
      updateTask(
        group,
        fresh.id,
        {
          fixerChatId: undefined,
          fixerAttempts: nextAttempts,
          error: undefined,
        },
        plannerChat,
      );

      const mergeResult = await enqueueMergeCompletedTaskWorktree(group, fresh, plannerChat);
      if (mergeResult.outcome === 'conflict') {
        await startMergeConflictFixer(
          group,
          fresh,
          plannerChat,
          mergeResult.conflictedFiles,
          mergeResult.integrationSha,
        );
        return;
      }

      const retryMsg =
        mergeResult.outcome === 'error'
          ? mergeResult.message
          : 'Re-merge after fixer failure did not produce a conflict for retry';
      updateTask(
        group,
        fresh.id,
        { error: retryMsg, fixerAttempts: undefined, mergePreSha: undefined },
        plannerChat,
      );
      moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
      return;
    }

    const fixerSummary =
      fresh.error?.trim() ||
      verified?.reasons?.join('; ') ||
      'Merge fixer could not produce a valid integration merge after 2 attempts';
    updateTask(
      group,
      fresh.id,
      {
        fixerChatId: undefined,
        error: fixerSummary,
        fixerAttempts: undefined,
        mergePreSha: undefined,
      },
      plannerChat,
    );
    // Terminal fixer exhaustion → route through self-heal (will quarantine).
    void runSelfHeal(
      group,
      fresh,
      plannerChat,
      { phase: 'merge', category: 'merge', summary: fixerSummary },
      makeSelfHealDeps(),
    ).catch((err) => reportBackgroundError('self-heal-fixer-terminal', err));
  } catch (err) {
    reportBackgroundError('finalize-merge-fixer', err);
    moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
  }
}

/**
 * Remove all per-task/wave worktrees for a board (keeps the integration branch +
 * worktree so MIN-208 can commit/push from it). Call on board teardown/delete.
 */
export function cleanupBoardIsolation(group: ChatGroup): void {
  const board = group.orchestrateBoard;
  if (!board?.integrationBranch) return;
  void cleanupBoardWorktreesOp({ boardId: group.id }).catch((err) =>
    reportBackgroundError('worktree-cleanup', err),
  );
}

/** Start a linked task chat (background stream; does not switch active chat). */
export async function startTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const existingChatId = task.chatId?.trim();
  if (existingChatId && isTaskChatActive(existingChatId)) {
    return;
  }

  if (countRunningTaskChats(board) >= maxConcurrent(board)) {
    enqueueTask(group.id, taskId);
    return;
  }

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();

  const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
  if (!modelId) {
    updateTask(
      group,
      taskId,
      { error: 'Select a model for the orchestrate planner before starting tasks' },
      plannerChat,
    );
    return;
  }

  // A retry/reopen seed (failed-test summary) is persisted on the task so it
  // survives being queued for a concurrency slot. When present, run a fresh
  // Builder chat (no history bloat) with the failure-aware prompt.
  const overrideSeed = task.pendingBuildSeed?.trim() || '';

  let taskChat: Chat;
  const forceNewChat = Boolean(overrideSeed);
  taskChat = getOrCreateBoardChat({
    group,
    plannerChat,
    existingId: forceNewChat ? '' : task.chatId?.trim(),
    role: 'build',
    name: `Task ${task.id}: ${task.title}`,
    taskId: task.id,
    taskChatField: 'chatId',
  });

  reserveLaunchSlot(taskChat.id);
  try {
    const { renderSidebar } = await import('../ui/sidebar.ts');
    renderSidebar();

    // Scope this task chat's tools to an isolated worktree when board isolation is on
    // (MIN-275). Best-effort: a null result leaves the chat on the shared workspace.
    const worktreeRoot = await ensureTaskWorktree(group, task, plannerChat);
    if (worktreeRoot) {
      taskChat.worktreeRoot = worktreeRoot;
      scheduleSaveSessions();
    }

    const seed = overrideSeed || buildTaskSeedMessage(group, plannerChat, task);
    // Consume the one-shot retry seed now that the build is actually launching.
    if (overrideSeed) {
      updateTask(group, taskId, { pendingBuildSeed: undefined }, plannerChat);
    }

    refreshHeartbeatThresholds();
    startTaskChatSupervision(taskChat.id);

    void runChatTurn({
      chat: taskChat,
      pushUser: true,
      rawText: seed,
      userText: seed,
      displayText: seed,
      historyContent: seed,
      skillId: null,
      validAttachments: [],
      titleSeed: task.title,
      ownsGlobalStreaming: true,
    }).catch((err) => {
      const message =
        err instanceof Error ? err.message : 'Task chat failed to start';
      updateTask(
        group,
        taskId,
        { error: message || 'Task chat failed to start' },
        plannerChat,
      );
    }).finally(() => releaseLaunchSlotAndDrive(group, plannerChat, taskChat.id));
  } catch (err) {
    releaseLaunchSlotAndDrive(group, plannerChat, taskChat.id);
    throw err;
  }
}

/** Start Tester chat for a task in the testing column. */
export async function startTaskTesting(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'testing') return;

  const existingTestId = task.testChatId?.trim();
  if (existingTestId && isTaskChatActive(existingTestId)) return;

  if (countRunningTaskChats(board) >= maxConcurrent(board)) {
    enqueueTask(group.id, taskId);
    return;
  }

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();

  const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
  if (!modelId) {
    updateTask(
      group,
      taskId,
      { error: 'Select a model for the orchestrate planner before running tests' },
      plannerChat,
    );
    return;
  }

  const testChat = getOrCreateBoardChat({
    group,
    plannerChat,
    existingId: task.testChatId?.trim(),
    role: 'tester',
    name: `Test ${task.id}: ${task.title}`,
    taskId: task.id,
    taskChatField: 'testChatId',
  });

  updateTask(
    group,
    taskId,
    { testVerdict: undefined, testSummary: undefined },
    plannerChat,
  );

  reserveLaunchSlot(testChat.id);
  try {
    const { renderSidebar } = await import('../ui/sidebar.ts');
    renderSidebar();

    // Tester runs against the same isolated worktree as the Builder (MIN-275).
    const freshTask = group.orchestrateBoard?.tasks.find((t) => t.id === taskId) ?? task;
    const buildChat = freshTask.chatId ? findChatById(freshTask.chatId) : undefined;
    const worktreeRoot =
      freshTask.worktreePath?.trim() ||
      buildChat?.worktreeRoot?.trim() ||
      (await ensureTaskWorktree(group, freshTask, plannerChat)) ||
      undefined;
    if (worktreeRoot) {
      testChat.worktreeRoot = worktreeRoot;
      scheduleSaveSessions();
    }

    // Preflight: bring up declared services before the Tester runs (§3 happy-path).
    // Guard: only if the task or its worktree signature is not already provisioned.
    await ensureBoardInfraProvisioned(group, freshTask, plannerChat).catch((err) =>
      reportBackgroundError('preflight-infra-provision', err),
    );

    const seed = buildTaskTestSeedMessage(group, plannerChat, task);

    refreshHeartbeatThresholds();
    startTaskChatSupervision(testChat.id);

    void runChatTurn({
      chat: testChat,
      pushUser: true,
      rawText: seed,
      userText: seed,
      displayText: seed,
      historyContent: seed,
      skillId: null,
      validAttachments: [],
      titleSeed: `Test ${task.id}`,
      ownsGlobalStreaming: true,
    }).catch((err) => {
      const message =
        err instanceof Error ? err.message : 'Tester chat failed to start';
      updateTask(
        group,
        taskId,
        { error: message || 'Tester chat failed to start' },
        plannerChat,
      );
    }).finally(() => releaseLaunchSlotAndDrive(group, plannerChat, testChat.id));
  } catch (err) {
    releaseLaunchSlotAndDrive(group, plannerChat, testChat.id);
    throw err;
  }
}

/** Manual entry: Run tests on a task in the testing column. */
export async function startTaskTestingForPlannerChat(
  plannerChat: Chat,
  taskId: string,
): Promise<void> {
  const ctx = resolveBoardContext(plannerChat);
  if (!ctx) return;
  await startTaskTesting(ctx.group, taskId, ctx.planner);
}

/** Apply per-task test failure bookkeeping; returns next routing step. */
export function applyTaskTestFailureState(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  summary: string,
): 'blocked' | 'retry' {
  const attempts = (task.testAttempts ?? 0) + 1;
  updateTask(
    group,
    task.id,
    { testAttempts: attempts, testSummary: summary },
    plannerChat,
  );

  if (attempts >= resolveMaxTaskTestAttempts()) {
    moveTaskStatus(group, task.id, 'blocked', plannerChat);
    updateTask(group, task.id, { error: summary }, plannerChat);
    return 'blocked';
  }

  logTaskRetry(group, task.id, 'test', attempts);
  moveTaskStatus(group, task.id, 'in_progress', plannerChat);
  return 'retry';
}

/** Apply per-task build failure bookkeeping; returns next routing step (auto/afk only). */
export function applyTaskBuildFailureState(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  errorSummary: string,
): 'failed' | 'retry' {
  const attempts = (task.buildAttempts ?? 0) + 1;
  updateTask(
    group,
    task.id,
    { buildAttempts: attempts, error: errorSummary },
    plannerChat,
  );

  if (attempts >= resolveMaxTaskBuildAttempts()) {
    moveTaskStatus(group, task.id, 'failed', plannerChat);
    return 'failed';
  }

  logTaskRetry(group, task.id, 'build', attempts);
  moveTaskStatus(group, task.id, 'in_progress', plannerChat);
  return 'retry';
}

/**
 * Fallback verdict parsed from the Tester chat transcript when the structured
 * `board_report_test_result` call never landed. Requires an explicit
 * `VERDICT: pass|fail` marker in the latest assistant message — prose alone is
 * not trusted, so an offhand "tests pass" mid-explanation is not read as the
 * final verdict. Returns null when no marker is present.
 */
function parseTesterVerdictMarker(chatId: string | undefined): {
  verdict: 'pass' | 'fail';
  summary: string;
} | null {
  const id = chatId?.trim();
  if (!id) return null;
  const chat = findChatById(id);
  if (!chat) return null;
  for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];
    if (!msg || msg.role !== 'assistant') continue;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (!content.trim()) continue;
    // Only inspect the most recent non-empty assistant message.
    const match = content.match(/^[ \t>*_-]*verdict\s*[:=]\s*([a-z]+)/im);
    const verdict = match ? normalizeVerdict(match[1]) : null;
    if (!verdict) return null;
    const line = content
      .split(/\r?\n/)
      .find((l) => /verdict\s*[:=]/i.test(l))
      ?.trim();
    return { verdict, summary: line || `Tester message verdict: ${verdict}` };
  }
  return null;
}

/** Route per-task Tester verdict after its chat stream ends. */
export async function finalizeTaskTestingOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<void> {
  if (task.status !== 'testing') return;
  const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
  let verdict = fresh.testVerdict;
  let summary = fresh.testSummary?.trim() || 'Tester did not report a verdict';

  // No structured verdict recorded: fall back to an explicit transcript marker
  // before treating the run as a failure. Do not override an explicit 'fail'.
  if (!verdict) {
    const parsed = parseTesterVerdictMarker(fresh.testChatId);
    if (parsed) {
      verdict = parsed.verdict;
      summary = parsed.summary;
      updateTask(
        group,
        fresh.id,
        { testVerdict: parsed.verdict, testSummary: parsed.summary },
        plannerChat,
      );
    }
  }

  const attemptNum = fresh.testAttempts ?? 0;
  logTestVerdict(
    group,
    fresh.id,
    verdict === 'pass' ? 'pass' : 'fail',
    summary,
    verdict === 'fail' ? attemptNum || undefined : undefined,
  );

  if (verdict === 'pass') {
    updateTask(group, fresh.id, { error: undefined }, plannerChat);
    const mergeResult = await enqueueMergeCompletedTaskWorktree(group, fresh, plannerChat);
    if (mergeResult.outcome === 'merged' || mergeResult.outcome === 'skipped') {
      moveTaskStatus(group, fresh.id, 'complete', plannerChat);
    } else if (mergeResult.outcome === 'conflict') {
      updateTask(
        group,
        fresh.id,
        {
          error: `Integration merge conflict on ${fresh.worktreeBranch ?? fresh.id}`,
        },
        plannerChat,
      );
      await startMergeConflictFixer(
        group,
        fresh,
        plannerChat,
        mergeResult.conflictedFiles,
        mergeResult.integrationSha,
      );
    } else {
      // Merge-failed (non-conflict error) → self-heal merge path.
      const mergeSummary = mergeResult.message || 'Integration merge failed';
      updateTask(group, fresh.id, { error: mergeSummary }, plannerChat);
      void runSelfHeal(
        group,
        fresh,
        plannerChat,
        { phase: 'merge', category: 'merge', summary: mergeSummary },
        makeSelfHealDeps(),
      ).catch((err) => reportBackgroundError('self-heal-merge', err));
      return;
    }

    const testChatId = fresh.testChatId?.trim();
    const testChat = testChatId ? findChatById(testChatId) : null;
    if (testChat) {
      const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
      const lastAssistant = [...testChat.history].reverse().find((m) => m.role === 'assistant');
      const assistantText = lastAssistant && typeof lastAssistant.content === 'string'
        ? lastAssistant.content
        : '';
      schedulePostTurnSynthesis({
        chatId: testChat.id,
        messages: buildSynthesisMessages(testChat),
        roundCount: testChat.history.filter((m) => m.role === 'assistant').length,
        toolCount: 0,
        sourceExcerpt: buildSynthesisExcerpt(testChat),
        assistantText,
        force: true,
        providerId: providerId || undefined,
        modelId: modelId || undefined,
      });
    }
    return;
  }

  // Test failed: route through self-heal with the Tester chat for classification.
  const testerChatObj = fresh.testChatId ? findChatById(fresh.testChatId) : null;
  const category = testerChatObj ? classifyTaskFailure(testerChatObj) : 'code';
  void runSelfHeal(
    group,
    fresh,
    plannerChat,
    { phase: 'test', category, summary },
    makeSelfHealDeps(),
  ).catch((err) => reportBackgroundError('self-heal-test', err));
}

/** True when the board is terminal and has at least one `complete` task (gates final test). */
function isBoardReadyForFinalTest(board: OrchestrateBoardState): boolean {
  if (!isOrchestratePlanComplete(board)) return false;
  return board.tasks.some((t) => t.status === 'complete');
}

/** Start full-board final integration test (Tester with browser). */
export async function startFinalIntegrationTest(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board || !isBoardReadyForFinalTest(board)) return;
  if (board.finalTest?.status === 'in_progress') return;
  if (board.finalTest?.status === 'passed') return;

  const existingFinalId = board.finalTest?.chatId?.trim();
  if (existingFinalId && isTaskChatActive(existingFinalId)) return;

  if (countRunningTaskChats(board) >= maxConcurrent(board)) return;

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();

  const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
  if (!modelId) {
    board.finalTest = {
      ...(board.finalTest ?? {}),
      status: 'failed',
      summary: 'Select a model for the orchestrate planner before running the final test',
    };
    board.lastUpdatedAt = Date.now();
    scheduleSaveSessions();
    emitBoardChange(group.id);
    return;
  }

  const finalChat = getOrCreateBoardChat({
    group,
    plannerChat,
    existingId: existingFinalId,
    role: 'tester',
    name: 'Final integration test',
  });

  // Run the final test in the integration worktree (where all task branches were
  // merged), not the main checkout. Only applies when board isolation is active.
  if (board.integrationBranch) {
    const ensured = await ensureIntegrationWorktree({
      boardId: group.id,
      branch: board.integrationBranch,
    });
    const integrationPath = ensured.path?.trim();
    if (!integrationPath) {
      // Fail fast — never silently fall back to the un-integrated main checkout.
      board.finalTest = {
        ...(board.finalTest ?? {}),
        status: 'failed',
        summary: 'Integration worktree missing; cannot run final integration test',
      };
      board.lastUpdatedAt = Date.now();
      scheduleSaveSessions();
      emitBoardChange(group.id);
      return;
    }
    finalChat.worktreeRoot = integrationPath;
  }

  board.finalTest = {
    ...(board.finalTest ?? {}),
    status: 'in_progress',
    chatId: finalChat.id,
    recordedVerdict: undefined,
    failingTaskIds: undefined,
    summary: undefined,
  };
  board.lastUpdatedAt = Date.now();
  logFinalTestStarted(group, finalChat.id);
  scheduleSaveSessions();
  emitBoardChange(group.id);

  reserveLaunchSlot(finalChat.id);
  try {
    const { renderSidebar } = await import('../ui/sidebar.ts');
    renderSidebar();

    const seed = buildFinalIntegrationTestSeedMessage(group, plannerChat);

    refreshHeartbeatThresholds();
    startTaskChatSupervision(finalChat.id);

    void runChatTurn({
      chat: finalChat,
      pushUser: true,
      rawText: seed,
      userText: seed,
      displayText: seed,
      historyContent: seed,
      skillId: null,
      validAttachments: [],
      titleSeed: 'Final integration test',
      ownsGlobalStreaming: true,
    }).catch(() => {
      /* surfaced in chat history */
    }).finally(() => releaseLaunchSlotAndDrive(group, plannerChat, finalChat.id));
  } catch (err) {
    releaseLaunchSlotAndDrive(group, plannerChat, finalChat.id);
    throw err;
  }
}

/** Manual entry: run final integration test from board header. */
export async function startFinalIntegrationTestForPlannerChat(
  plannerChat: Chat,
): Promise<void> {
  const ctx = resolveBoardContext(plannerChat);
  if (!ctx) return;
  await startFinalIntegrationTest(ctx.group, ctx.planner);
}

function postPlannerBoardMessage(plannerChat: Chat, text: string): void {
  plannerChat.history.push({ role: 'assistant', content: text });
  touchChat(plannerChat);
  scheduleSaveSessions();
}

/** When every task is terminal and ≥1 is complete, start or surface the final integration test. */
export function tryTriggerFinalIntegrationTest(
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  // All-quarantined boards skip the final test but still reach plan-complete/report path.
  if (!board || !isBoardReadyForFinalTest(board)) return;
  if (board.finalTest?.status === 'passed') {
    void maybeEmitOrchestratePlanComplete(group.id);
    return;
  }
  if (board.finalTest?.status === 'in_progress') return;

  const attempts = board.finalTest?.attempts ?? 0;
  if (board.finalTest?.status === 'failed' && attempts >= resolveMaxFinalTestAttempts()) {
    return;
  }

  if (isBoardAutoMode(group)) {
    void startFinalIntegrationTest(group, plannerChat);
    return;
  }

  board.finalTest = {
    ...(board.finalTest ?? {}),
    status: 'pending',
  };
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Reopen board tasks named by a failed final integration test (no builder start). */
export function applyFinalTestFailureReopens(
  group: ChatGroup,
  plannerChat: Chat,
  failingIds: string[],
  summary: string,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  for (const taskId of failingIds) {
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) continue;
    updateTask(group, taskId, { testAttempts: 1, testSummary: summary }, plannerChat);
    moveTaskStatus(group, taskId, 'in_progress', plannerChat);
  }
}

/** Route full-board Tester verdict after final integration chat ends. */
export function finalizeFinalTestOnStreamEnd(
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board?.finalTest) return;

  const verdict = board.finalTest.recordedVerdict;
  const summary = board.finalTest.summary?.trim() || 'Final integration test did not report a verdict';
  const failingIds = board.finalTest.failingTaskIds ?? [];

  if (verdict === 'pass') {
    logFinalTestVerdict(group, 'pass', summary);
    board.finalTest = { ...board.finalTest, status: 'passed' };
    board.lastUpdatedAt = Date.now();
    scheduleSaveSessions();
    emitBoardChange(group.id);
    void maybeEmitOrchestratePlanComplete(group.id);
    return;
  }

  const attempts = (board.finalTest.attempts ?? 0) + 1;
  logFinalTestVerdict(group, 'fail', summary, failingIds);
  board.finalTest = {
    ...board.finalTest,
    status: 'failed',
    attempts,
    summary,
  };
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);

  if (attempts >= resolveMaxFinalTestAttempts()) {
    postPlannerBoardMessage(
      plannerChat,
      [
        '**Final integration test exhausted**',
        '',
        summary,
        '',
        `${attempts}/${resolveMaxFinalTestAttempts()} rounds completed. Review failing areas manually.`,
      ].join('\n'),
    );
    return;
  }

  if (!failingIds.length) {
    postPlannerBoardMessage(
      plannerChat,
      [
        '**Final integration test failed** (no failing task ids reported)',
        '',
        summary,
        '',
        'The Tester did not name responsible tasks — reopen tasks manually or re-run the final test.',
      ].join('\n'),
    );
    return;
  }

  applyFinalTestFailureReopens(group, plannerChat, failingIds, summary);

  for (const taskId of failingIds) {
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) continue;
    const seed = buildRetryBuilderSeedMessage(task, 1, `Final integration test: ${summary}`);
    updateTask(group, taskId, { pendingBuildSeed: seed }, plannerChat);
    void startTask(group, taskId, plannerChat).catch((err) =>
      reportBackgroundError('start-task-final-reopen', err),
    );
  }

  postPlannerBoardMessage(
    plannerChat,
    [
      '**Final integration test failed** — reopened task(s) for fix',
      '',
      `Tasks: ${failingIds.join(', ')}`,
      '',
      summary,
    ].join('\n'),
  );
}

/** Start task by planner chat (UI convenience). */
export async function startTaskForPlannerChat(
  plannerChat: Chat,
  taskId: string,
): Promise<void> {
  const ctx = resolveBoardContext(plannerChat);
  if (!ctx) return;
  await startTask(ctx.group, taskId, ctx.planner);
}

export async function stopTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const task = group.orchestrateBoard?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.chatId) {
    stopTaskChatSupervision(task.chatId);
    stopGeneration(task.chatId);
  }
  if (task.testChatId) {
    stopTaskChatSupervision(task.testChatId);
    stopGeneration(task.testChatId);
  }
  if (task.fixerChatId) {
    stopTaskChatSupervision(task.fixerChatId);
    stopGeneration(task.fixerChatId);
  }
  await drainTaskQueue(group, plannerChat);
}

export function moveTaskStatus(
  group: ChatGroup,
  taskId: string,
  status: BoardTaskStatus,
  plannerChat?: Chat,
): void {
  const existing = group.orchestrateBoard?.tasks.find((t) => t.id === taskId);
  logTaskStatus(group, taskId, existing?.status, status);
  const patch: Parameters<typeof updateTask>[2] = { status };
  if (status === 'planned' && existing?.error) {
    patch.error = undefined;
  }
  updateTask(group, taskId, patch, plannerChat);
  const board = group.orchestrateBoard;
  if (board && status === 'complete') {
    const planner = plannerChat ?? getPlannerChatForGroup(group);
    if (planner) tryTriggerFinalIntegrationTest(group, planner);
  }
  if (board && status === 'quarantined' && isOrchestratePlanComplete(board) && !isBoardReadyForFinalTest(board)) {
    void maybeEmitOrchestratePlanComplete(group.id);
  }
  if (board && isBoardRunning(group) && plannerChat) {
    const reportable =
      status === 'complete' || status === 'failed' || status === 'blocked' || status === 'quarantined';
    if (reportable) {
      void import('../agents/controller/report.ts')
        .then((mod) => {
          const task = board.tasks.find((t) => t.id === taskId);
          if (!task) return;
          return mod.deliverOrchestratorTaskReport(group, plannerChat, task, status);
        })
        .catch((err) => reportBackgroundError('deliver-task-report', err));
    }
  }
}

/**
 * Reset a quarantined task to `planned`, clear its quarantine payload,
 * and re-drive the board if it is running.
 */
export async function requeueBoardTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'quarantined') return;
  logTaskStatus(group, taskId, task.status, 'planned');
  updateTask(group, taskId, { status: 'planned', quarantine: undefined }, plannerChat);
  if (isBoardRunning(group)) {
    await autoDelegateNext(group, plannerChat);
  }
}

/** Persist auto/manual/sequential execution mode. Does not start execution — use startBoardAutoRun. */
export function setBoardExecutionMode(
  group: ChatGroup,
  mode: 'manual' | 'auto' | 'sequential' | 'afk',
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const prevMode = getBoardExecutionMode(board);
  board.executionMode = mode;
  if (mode !== 'afk') delete board.pendingAfk;
  if (mode === 'manual') board.autoRunning = false;
  board.lastUpdatedAt = Date.now();
  // Flush stop state immediately so reload cannot resurrect auto execution.
  if (mode === 'manual') {
    saveSessionsNow();
  } else {
    scheduleSaveSessions();
  }
  if (prevMode !== mode) {
    logModeChange(group, mode);
  }
  emitBoardChange(group.id);
}

/** Shared AFK activation after user confirmation (slider or pending banner). Does not start execution — user presses Start like Auto. */
export function activateAfk(group: ChatGroup, plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  delete board.pendingAfk;
  setBoardExecutionMode(group, 'afk', plannerChat);
}

/** Orchestrator requested AFK — show confirmation banner; mode unchanged until accepted. */
export function requestPendingAfk(group: ChatGroup, _plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  board.pendingAfk = true;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Dismiss orchestrator AFK request without changing execution mode. */
export function cancelPendingAfk(group: ChatGroup): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  delete board.pendingAfk;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Set per-board isolation override; `auto` clears the field (global / derived). */
export function setBoardIsolationMode(
  group: ChatGroup,
  mode: 'auto' | 'off' | 'per-task' | 'per-wave',
  _plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  if (mode === 'auto') {
    if (board.isolationMode === undefined) return;
    delete board.isolationMode;
  } else if (board.isolationMode === mode) {
    return;
  } else {
    board.isolationMode = mode;
  }
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Set max concurrent tasks, clamped to [1,20]. Drains queue when in auto/sequential mode. */
export function setBoardMaxConcurrent(
  group: ChatGroup,
  value: number,
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const clamped = Math.max(1, Math.min(20, Math.floor(value)));
  if (board.maxConcurrentTasks === clamped) return;
  board.maxConcurrentTasks = clamped;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
  if (isBoardAutoMode(group)) {
    void drainTaskQueue(group, plannerChat);
  }
}

/** True when a linked task chat still has an in-flight turn after reload. */
function shouldSuperviseBoardChatOnReload(chatId?: string): boolean {
  const id = chatId?.trim();
  if (!id) return false;
  const chat = findChatById(id);
  if (!chat) return false;
  return isTaskChatStreaming(id) || Boolean(chat.currentGenerationId?.trim());
}

/**
 * Re-subscribe stream handlers, re-attach heartbeat supervision, and resume
 * auto delegation after page reload (when autoRunning was persisted).
 */
export async function resumeBoardExecutionAfterReload(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  ensureStreamEndSubscription();
  ensureAutoDriveSubscription();
  const board = group.orchestrateBoard;
  if (!board || !isBoardRunning(group)) return;

  await rehydrateBoardWorktreeRoots(group, plannerChat);
  refreshHeartbeatThresholds();

  const attachSupervision = (chatId?: string): void => {
    if (!shouldSuperviseBoardChatOnReload(chatId)) return;
    startTaskChatSupervision(chatId!.trim());
  };

  for (const task of board.tasks) {
    if (task.status === 'in_progress') {
      attachSupervision(task.chatId);
    } else if (task.status === 'testing') {
      attachSupervision(task.testChatId);
      attachSupervision(task.chatId);
    }
  }

  if (board.finalTest?.status === 'in_progress') {
    attachSupervision(board.finalTest.chatId);
  }

  await autoDelegateNext(group, plannerChat);
  emitBoardChange(group.id);
}

/**
 * Reconcile tasks stuck in `merging` after reload — supervise a live fixer or
 * re-run finalize when its stream-end handler never fired.
 */
export async function recoverInterruptedMergesAfterReload(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  ensureStreamEndSubscription();
  const board = group.orchestrateBoard;
  if (!board) return;
  const pending: Promise<void>[] = [];
  for (const task of board.tasks) {
    if (task.status !== 'merging') continue;
    const fixerId = task.fixerChatId?.trim();
    if (fixerId && shouldSuperviseBoardChatOnReload(fixerId)) {
      startTaskChatSupervision(fixerId);
      continue;
    }
    pending.push(
      finalizeMergeFixerOnStreamEnd(group, task, plannerChat).catch((err) => {
        reportBackgroundError('recover-interrupted-merge', err);
      }),
    );
  }
  await Promise.all(pending);
}

/** Begin auto/sequential execution — set running flag then kick off delegation. */
export function startBoardAutoRun(group: ChatGroup, plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board || !isBoardAutoMode(group)) return;
  board.autoRunning = true;
  // Clear any prior Stop so the timer resumes and the Stopped badge clears.
  board.userStopped = false;
  board.lastUpdatedAt = Date.now();
  logAutoStart(group);
  scheduleSaveSessions();
  emitBoardChange(group.id);
  void autoDelegateNext(group, plannerChat).catch((err) =>
    reportBackgroundError('auto-delegate-next', err),
  );
}

/** Stop all active task chats and clear the task queue. */
export function stopBoardAutoRun(group: ChatGroup, plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  board.autoRunning = false;
  // Freeze the header timer and surface the Stopped badge immediately, even if
  // task statuses lag behind the aborted streams (MIN-248).
  board.userStopped = true;
  board.lastUpdatedAt = Date.now();
  logAutoStop(group);
  taskQueueByGroupId.delete(group.id);
  for (const task of board.tasks) {
    if (task.chatId) {
      stopTaskChatSupervision(task.chatId);
      stopGeneration(task.chatId);
    }
    if (task.testChatId) {
      stopTaskChatSupervision(task.testChatId);
      stopGeneration(task.testChatId);
    }
    if (task.fixerChatId) {
      stopTaskChatSupervision(task.fixerChatId);
      stopGeneration(task.fixerChatId);
    }
  }
  if (board.finalTest?.chatId) {
    stopTaskChatSupervision(board.finalTest.chatId);
    stopGeneration(board.finalTest.chatId);
  }
  stopGeneration(plannerChat.id);
  // Freeze the header timer now (close the open segment) instead of waiting for
  // the next live tick, so the elapsed value stops the instant Stop is pressed.
  syncOrchestrateBoardTimer(group, plannerChat, {
    isStreaming: false,
    activeRunCount: 0,
    userStopped: true,
  });
  // Cancel any sub-agent runs still attributed to the planner's active parent
  // turn so background runs/heartbeats do not linger after Stop (MIN-246).
  if (board.activeParentTurnId) {
    void import('../agents/controller/controller.ts')
      .then((mod) => mod.cancelAllForParentTurn(board.activeParentTurnId!))
      .catch((err) => reportBackgroundError('stop-board-cancel-runs', err));
  }
  // Flush pending planner reports so the planner stream-end event (caused by
  // stopGeneration above) does not drain the queue and start a new planner turn.
  void import('../agents/controller/report.ts')
    .then((mod) => mod.clearPendingReportsForChat(plannerChat.id))
    .catch((err) => reportBackgroundError('stop-board-clear-reports', err));
  // Flush stop state immediately so reload cannot resurrect auto execution.
  saveSessionsNow();
  emitBoardChange(group.id);
}

/** Pause every auto/sequential board on window close (mirrors pressing Stop). */
export function pauseAllRunningBoardsForShutdown(): void {
  const state = sessionState;
  if (!state?.groups?.length) return;
  for (const group of state.groups) {
    if (!isBoardRunning(group)) continue;
    const plannerId = group.plannerChatId?.trim();
    if (!plannerId) continue;
    const planner = state.chats.find((c) => c.id === plannerId);
    if (!planner) continue;
    stopBoardAutoRun(group, planner);
  }
}

/** Start all ready planned tasks up to the concurrency cap (auto-pilot / sequential). */
export async function autoDelegateNext(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  ensureStreamEndSubscription();
  ensureAutoDriveSubscription();
  const board = group.orchestrateBoard;
  if (!board || !isBoardRunning(group)) return;

  const waveOrder = new Map(board.waves.map((w, i) => [String(w.id), i]));
  const ready = board.tasks
    .filter(
      (t) =>
        isTaskReadyForAuto(board, t) ||
        isTaskStalledForRestart(board, t, isTaskChatActive),
    )
    .sort((a, b) => {
      const wa = waveOrder.get(String(a.wave)) ?? 999;
      const wb = waveOrder.get(String(b.wave)) ?? 999;
      if (wa !== wb) return wa - wb;
      return board.tasks.indexOf(a) - board.tasks.indexOf(b);
    });
  for (const task of ready) {
    if (countRunningTaskChats(board) >= maxConcurrent(board)) {
      enqueueTask(group.id, task.id);
      continue;
    }
    await resumeBoardTask(group, task.id, plannerChat);
  }
  await drainTaskQueue(group, plannerChat);
}

function ensureAutoDriveSubscription(): void {
  if (autoDriveSubscribed) return;
  autoDriveSubscribed = true;
  void import('../agents/controller/report.ts').then((mod) => {
    mod.initOrchestratorAutoReports();
  });
}

/** Toggle kanban visibility for a wave section in board view.
 *  Expanding a wave collapses all other waves (accordion). */
export function toggleWaveCollapsed(group: ChatGroup, waveId: number | string): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const wave = board.waves.find((w) => String(w.id) === String(waveId));
  if (!wave) return;
  const expanding = wave.collapsed !== false;
  wave.collapsed = !expanding;
  if (expanding) {
    for (const other of board.waves) {
      if (String(other.id) !== String(waveId)) other.collapsed = true;
    }
  }
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Start all planned tasks in a wave up to the concurrency cap; queue the rest. */
export async function startWave(
  group: ChatGroup,
  waveId: number | string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const planned = board.tasks.filter(
    (t) => t.wave === waveId && t.status === 'planned',
  );
  for (const task of planned) {
    if (countRunningTaskChats(board) >= maxConcurrent(board)) {
      enqueueTask(group.id, task.id);
    } else {
      await startTask(group, task.id, plannerChat);
    }
  }
}

/** Ensure folder exists for a planner chat (legacy ensureBoardGroup). */
export function ensureBoardGroup(plannerChat: Chat): string {
  return getOrCreateBoardGroup(plannerChat).id;
}

/** Test hooks for launch-slot reservation and task-queue draining. */
export function reserveLaunchSlotForTests(chatId: string): void {
  reserveLaunchSlot(chatId);
}

export function releaseLaunchSlotForTests(chatId: string): void {
  releaseLaunchSlot(chatId);
}

export function enqueueTaskForTests(groupId: string, taskId: string): void {
  enqueueTask(groupId, taskId);
}

export function getTaskQueueForTests(groupId: string): string[] {
  return [...(taskQueueByGroupId.get(groupId) ?? [])];
}

export function clearTaskQueuesForTests(): void {
  taskQueueByGroupId.clear();
}

export async function drainTaskQueueForTests(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  return drainTaskQueue(group, plannerChat);
}

export function startTaskChatSupervisionForTests(chatId: string): void {
  startTaskChatSupervision(chatId);
}

export function clearTaskChatStallRestartsForTests(): void {
  taskChatStallRestarts.clear();
}
