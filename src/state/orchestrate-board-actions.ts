/**
 * Manual orchestrate board operations — shared by UI buttons and LLM tools.
 */

import { stopGeneration } from '../chat/stop-generation.ts';
import { resolveBoardModelBinding } from '../chat/orchestrate/board-model-binding.ts';
import {
  applyBoardReasoningPatch,
  applyBoardReasoningToChat,
  propagateBoardReasoningToChats,
  sanitizeBoardReasoningForModel,
  type BoardReasoningPatch,
} from '../chat/orchestrate/board-reasoning-binding.ts';
import { isOrchestratePlanComplete, hasIncompleteOrchestrateWork } from '../chat/orchestrate/plan-complete.ts';
import { isUserStoppedChat } from '../chat/orchestrate/user-stopped.ts';
import { maybeEmitOrchestratePlanComplete } from '../chat/orchestrate/plan-complete-ui.ts';
import {
  isOomPauseActive,
  OOM_SAFE_MAX_CONCURRENT,
  clearOomPauseFromElectron,
} from '../chat/orchestrate/oom-recovery.ts';
import {
  isChatStreaming,
  notifyChatStreamEnded,
  subscribeChatStreamActivity,
  subscribeChatStreamEnd,
} from '../chat/streaming-state.ts';
import { isChatTurnSetupPending, endChatTurnSetup } from '../chat/chat-turn-guard.ts';
import {
  getAutopilotMetaSync,
  resolveAutoProvisionInfra,
  resolveAfkAutoRestartStalls,
  resolveInfraProvisionTimeoutMs,
  resolveMaxFinalTestAttempts,
  resolveMaxTaskBuildAttempts,
  resolveMaxTaskTestAttempts,
  resolveSelfHealMaxRounds,
  resolveMaxEnvFixAttempts,
} from '../config/autopilot-meta.ts';
import { resolveSupervisionThresholds } from '../config/supervision-thresholds.ts';
import {
  classifyTaskFailure,
  extractChatFailureText,
  isTransientContextLengthError,
  resolveTaskChatStreamFailure,
  type FailureCategory,
} from './orchestrate-failure-classify.ts';
import { runSelfHeal, resolutionStepsForCategory, type SelfHealDeps } from './orchestrate-self-heal.ts';
import { isLocalServerAvailable } from '../tools/config.ts';
import {
  bindRunSupervision,
  bumpProgress,
  chatTaskRunId,
  createRunSupervision,
  getProgressAgeMs,
  getRunSupervision,
  isSupervisionPageHidden,
  setHeartbeatConfig,
  startHeartbeat,
  stopHeartbeat,
} from '../agents/controller/wrapper.ts';
import {
  onBoardAutoRunStarted,
  onBoardAutoRunStopped,
} from '../chat/orchestrate/board-afk-power.ts';
import { runChatTurn } from '../tools/loop.ts';
import { reportBackgroundError } from '../boot/report-background-error.ts';
import { setStreaming } from '../app-state.ts';
import { normalizeVerdict } from '../tools/board-tools.ts';
import { schedulePostTurnSynthesis } from '../synthesis/client.ts';
import { buildSynthesisMessages, buildSynthesisExcerpt } from '../synthesis/post-turn.ts';
import type {
  BoardExecutionPhase,
  BoardReport,
  BoardTask,
  BoardTaskStatus,
  Chat,
  ChatGroup,
  ChatStopReason,
  OrchestrateBoardState,
  SessionState,
  UnresolvedIssue,
} from '../types.ts';
import {
  assignChatToGroup,
  getBoardGroupForChat,
  getOrCreateBoardGroup,
  getPlannerChatForGroup,
} from './chat-groups.ts';
import { emitBoardChange } from './orchestrate-board-events.ts';
import { isTaskReadyForAuto, isTaskStalledForRestart, isBoardAutoMode, isBoardRunning, getBoardExecutionMode, syncOrchestrateBoardTimer, updateTask, logTaskStatus, logBoardReportNudge, logBuildVerdict, logTestVerdict, logMergeResult, logWorktreeAllocated, logTaskRetry, logModeChange, logAutoStart, logAutoStop, logFinalTestStarted, logFinalTestVerdict, logBoardPhase, logBoardSlot, logBoardHold, logBoardConcurrency, logBoardLifecycleOwner, quarantineTaskAndDependents, type OrchestrateBoardTimerContext } from './orchestrate-board-store.ts';
import {
  acquirePipelineHold,
  heldTaskIdsForOccupancy,
  hasPipelineHold,
  listPipelineHolds,
  releaseAllPipelineHolds,
  releasePipelineHold,
  releasePipelineHoldsForTask,
  setPipelineHoldMaxMsForTests,
  sweepExpiredPipelineHolds,
  type PipelineHoldReason,
} from './orchestrate-pipeline-holds.ts';
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
  checkMergeInProgress as checkMergeInProgressOp,
  restoreIntegration as restoreIntegrationWorktree,
  verifyIntegrationMerge as verifyIntegrationMergeOp,
  refreshIntegrationDeps as refreshIntegrationDepsOp,
  cleanupBoardWorktrees as cleanupBoardWorktreesOp,
} from './worktree-service.ts';

const MAX_MERGE_FIXER_ATTEMPTS = 2;
/** Max bounded retries when a build chat ends stopped (timeout/system) before quarantine. */
export const MAX_STOP_RETRY_ATTEMPTS = 2;

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

    // Deduplicate and add new signatures to board. Only on success: recording the
    // per-worktree signature after a failed provision (e.g. a broken node_modules link)
    // makes every later pass short-circuit to "already provisioned" and report ok.
    if (board) {
      if (result.ok) {
        board.provisionedSignatures = [...new Set([...existing, ...allSigs])];
      }
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
  markGroupDirty,
  saveSessionsNow as saveSessionsNowRaw,
  scheduleSaveSessions as scheduleSaveSessionsRaw,
  sessionState,
  touchChat,
} from './sessions.ts';

function requireSession(): NonNullable<typeof sessionState> {
  if (!sessionState) throw new Error('Session not loaded');
  return sessionState;
}

/** Board mutations mark dirtyGroupIds for B.2 PATCH. */
function scheduleSaveSessions(group?: ChatGroup | string | null): void {
  const id = typeof group === 'string' ? group : group?.id;
  if (id) markGroupDirty(id);
  scheduleSaveSessionsRaw();
}

function saveSessionsNow(group?: ChatGroup | string | null): void {
  const id = typeof group === 'string' ? group : group?.id;
  if (id) markGroupDirty(id);
  saveSessionsNowRaw();
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

/** Cap wait when a stale fixer blocks the merge queue (dead fixer chat no longer counts as active). */
const MAX_FIXER_WAIT_MS = 60_000;

/** Test override for `waitForNoActiveFixer` timeout (null restores production cap). */
let maxFixerWaitMsOverride: number | null = null;

export function setMaxFixerWaitMsForTests(ms: number | null): void {
  maxFixerWaitMsOverride = ms;
}

/** Test-only: invoke the merge-queue fixer wait (includes timeout reconcile path). */
export async function waitForNoActiveFixerForTests(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  return waitForNoActiveFixer(group, plannerChat);
}

/** Boards with an in-flight drainTaskQueue (coalesce overlapping drains). */
const drainInFlightByGroupId = new Set<string>();

export type MergeTaskWorktreeResult =
  | { outcome: 'merged' }
  | { outcome: 'conflict'; conflictedFiles: string[]; integrationSha?: string }
  | { outcome: 'skipped' }
  | { outcome: 'error'; message: string };

function boardHasActiveFixer(board: OrchestrateBoardState): boolean {
  return board.tasks.some(
    (t) =>
      t.status === 'merging' &&
      Boolean(t.fixerChatId?.trim()) &&
      isTaskChatActive(t.fixerChatId!.trim()),
  );
}

/** Block new merges while a fixer chat is resolving a conflict in integration. */
async function waitForNoActiveFixer(group: ChatGroup, plannerChat: Chat): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const start = Date.now();
  while (boardHasActiveFixer(board)) {
    const maxWaitMs = maxFixerWaitMsOverride ?? MAX_FIXER_WAIT_MS;
    if (Date.now() - start > maxWaitMs) {
      reportBackgroundError(
        'wait-for-fixer-timeout',
        new Error('Fixer wait exceeded cap; proceeding with merge'),
      );
      await reconcileMergingTasks(group, plannerChat);
      return;
    }
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

export type BoardChatTurnRunner = (
  input: Parameters<typeof runChatTurn>[0],
) => Promise<unknown>;

let boardChatTurnRunner: BoardChatTurnRunner = runChatTurn;

/** Host/test hook: substitute the board's chat-turn runner. `null` restores runChatTurn. */
export function setBoardChatTurnRunner(fn: BoardChatTurnRunner | null): void {
  boardChatTurnRunner = fn ?? runChatTurn;
}

/** Chat ids holding a launch slot until runChatTurn registers streaming/setup. */
const reservedLaunchChatIds = new Set<string>();
const pendingChatContinuations = new Map<string, () => Promise<void>>();
/** In-flight `runAfterChatRelease` work — tests must await these before teardown. */
const inFlightChatContinuations = new Set<Promise<void>>();

/**
 * Stall-kill reason keyed by chat id. Written when the heartbeat stops a turn so
 * stream-end recovery does not need `progressAge` after teardown.
 */
const stallStopReasons = new Map<string, string>();

/** Prevents stream-end + `.finally()` from double-launching stall recovery. */
const stallRecoveryScheduled = new Set<string>();

type LaunchAudit = {
  group: ChatGroup;
  slotId: string;
  phaseId: string;
  phase: BoardExecutionPhase;
  taskId?: string;
  lifecycleRun?: number;
  ownerId: string;
  startedAt: number;
};

const launchAudits = new Map<string, LaunchAudit>();
const auditedHoldsByBoard = new WeakMap<OrchestrateBoardState, Map<string, string>>();
let durableRuntimeSeq = 0;

function logConcurrencySnapshot(
  group: ChatGroup,
  reason: string,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const slots = [...launchAudits.values()].filter((audit) => audit.group === group);
  const holds = auditedHoldsByBoard.get(board) ?? new Map<string, string>();
  // A handoff can briefly own both a pipeline hold and its replacement chat.
  // That is one effective task occupant, so wait for the release edge before
  // writing a reconstructible raw-count observation.
  if (
    [...holds.values()].some((taskId) =>
      slots.some((slot) => slot.taskId && slot.taskId === taskId),
    )
  ) {
    return;
  }
  const activeSlots = slots.length;
  const activeHolds = holds.size;
  logBoardConcurrency(group, {
    activeSlots,
    activeHolds,
    activeTotal: activeSlots + activeHolds,
    concurrencyCap: maxConcurrent(board),
    reason,
  });
}

function reserveLaunchSlot(
  chatId: string,
  group?: ChatGroup,
  phase?: BoardExecutionPhase,
  taskId?: string,
): void {
  if (reservedLaunchChatIds.has(chatId)) return;
  reservedLaunchChatIds.add(chatId);
  if (!group?.orchestrateBoard || !phase) return;
  const task = taskId
    ? group.orchestrateBoard.tasks.find((candidate) => candidate.id === taskId)
    : undefined;
  const lifecycleRun = task ? task.lifecycleRun ?? 0 : undefined;
  const seq = ++durableRuntimeSeq;
  const audit: LaunchAudit = {
    group,
    slotId: `slot:${chatId}:${seq}`,
    phaseId: `phase:${phase}:${chatId}:${seq}`,
    phase,
    taskId,
    lifecycleRun,
    ownerId: chatId,
    startedAt: Date.now(),
  };
  launchAudits.set(chatId, audit);
  logBoardPhase(group, 'start', {
    phaseId: audit.phaseId,
    phase: audit.phase,
    taskId: audit.taskId,
    lifecycleRun: audit.lifecycleRun,
    ownerId: audit.ownerId,
  });
  logBoardSlot(group, 'acquire', {
    slotId: audit.slotId,
    phase: audit.phase,
    taskId: audit.taskId,
    lifecycleRun: audit.lifecycleRun,
    ownerId: audit.ownerId,
  });
  if (taskId && lifecycleRun !== undefined) {
    logBoardLifecycleOwner(group, 'set', {
      taskId,
      lifecycleRun,
      ownerId: chatId,
      ownerKind: 'chat',
      reason: `${phase} phase`,
    });
  }
  logConcurrencySnapshot(group, `slot ${audit.slotId} acquired`);
}

function releaseLaunchSlot(chatId: string): void {
  if (!reservedLaunchChatIds.has(chatId)) return;
  reservedLaunchChatIds.delete(chatId);
  const audit = launchAudits.get(chatId);
  if (!audit) return;
  launchAudits.delete(chatId);
  logBoardSlot(audit.group, 'release', {
    slotId: audit.slotId,
    phase: audit.phase,
    taskId: audit.taskId,
    lifecycleRun: audit.lifecycleRun,
    ownerId: audit.ownerId,
  });
  logBoardPhase(audit.group, 'end', {
    phaseId: audit.phaseId,
    phase: audit.phase,
    taskId: audit.taskId,
    lifecycleRun: audit.lifecycleRun,
    ownerId: audit.ownerId,
    durationMs: Math.max(0, Date.now() - audit.startedAt),
  });
  if (audit.taskId && audit.lifecycleRun !== undefined) {
    logBoardLifecycleOwner(audit.group, 'clear', {
      taskId: audit.taskId,
      lifecycleRun: audit.lifecycleRun,
      ownerId: audit.ownerId,
      ownerKind: 'chat',
      reason: `${audit.phase} phase ended`,
    });
  }
  logConcurrencySnapshot(audit.group, `slot ${audit.slotId} released`);
}

function holdKind(reason: PipelineHoldReason): 'merge' | 'fixer' | 'handoff' {
  if (reason === 'merge') return 'merge';
  if (reason === 'merge-fixer-start') return 'handoff';
  return 'fixer';
}

function acquireBoardPipelineHold(
  group: ChatGroup,
  taskId: string,
  reason: PipelineHoldReason,
) {
  const task = group.orchestrateBoard?.tasks.find((candidate) => candidate.id === taskId);
  return acquirePipelineHold(group.orchestrateBoard, taskId, reason, {
    onEvent(action, hold, activeHoldCount) {
      let auditedHolds = auditedHoldsByBoard.get(hold.board);
      if (!auditedHolds) {
        auditedHolds = new Map();
        auditedHoldsByBoard.set(hold.board, auditedHolds);
      }
      if (action === 'acquire') {
        auditedHolds.set(hold.id, hold.taskId);
      } else {
        auditedHolds.delete(hold.id);
      }
      logBoardHold(group, action, {
        holdId: hold.id,
        taskId: hold.taskId,
        holdKind: holdKind(hold.reason),
        lifecycleRun: task?.lifecycleRun ?? 0,
        ownerId: hold.id,
        reason: hold.reason,
      });
      if (auditedHolds.size !== activeHoldCount) {
        reportBackgroundError(
          'pipeline-hold-audit-count',
          new Error(
            `Pipeline hold audit count ${auditedHolds.size} != registry ${activeHoldCount}`,
          ),
        );
      }
      logConcurrencySnapshot(group, `hold ${hold.id} ${action}`);
    },
  });
}

/** Invoke a queued post-release continuation only once the chat is actually idle. */
function flushChatContinuationIfIdle(
  chatId: string,
  after?: () => void,
): boolean {
  if (isTaskChatActive(chatId)) return false;
  const continuation = pendingChatContinuations.get(chatId);
  if (!continuation) return false;
  // Consume before invoke so stream-end microtask and `.finally()` cannot double-launch.
  pendingChatContinuations.delete(chatId);
  const promise = continuation()
    .catch((err) => reportBackgroundError('board-chat-continuation', err))
    .finally(() => after?.());
  inFlightChatContinuations.add(promise);
  void promise.finally(() => {
    inFlightChatContinuations.delete(promise);
  });
  return true;
}

/** Drain queued + in-flight post-release continuations (unit tests). */
async function awaitInFlightChatContinuations(): Promise<void> {
  // A continuation may queue another `runAfterChatRelease` (slot-release drain).
  // Loop until both the pending map and in-flight set are empty.
  for (let i = 0; i < 8; i++) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    for (const id of [...pendingChatContinuations.keys()]) {
      flushChatContinuationIfIdle(id);
    }
    if (inFlightChatContinuations.size > 0) {
      await Promise.all([...inFlightChatContinuations]);
    }
    if (pendingChatContinuations.size === 0 && inFlightChatContinuations.size === 0) {
      return;
    }
  }
}

function drainAfterSlotRelease(group: ChatGroup, plannerChat: Chat): void {
  void drainTaskQueue(group, plannerChat).catch((err) =>
    reportBackgroundError('drain-after-slot-release', err),
  );
}

/** Release a task-chat launch slot, then re-drain the board now that capacity is free. */
function releaseLaunchSlotAndDrive(
  group: ChatGroup,
  plannerChat: Chat,
  chatId: string,
  retried = false,
): void {
  releaseLaunchSlot(chatId);
  const chat = findChatById(chatId);
  if (chat) {
    teardownBoardTaskChatResources(chat, sessionState?.groups);
  }
  const drain = (): void => drainAfterSlotRelease(group, plannerChat);
  // notifyChatStreamEnded runs before setStreaming(false). Leave the continuation
  // queued while the chat still occupies a slot and retry once on a microtask.
  if (isTaskChatActive(chatId)) {
    if (!retried && pendingChatContinuations.has(chatId)) {
      queueMicrotask(() => releaseLaunchSlotAndDrive(group, plannerChat, chatId, true));
    }
    return;
  }
  if (flushChatContinuationIfIdle(chatId, drain)) return;
  drain();
}

function runAfterChatRelease(chatId: string, continuation: () => Promise<void>): void {
  pendingChatContinuations.set(chatId, continuation);
  // Always defer one microtask: notifyChatStreamEnded is still inside the turn
  // teardown stack (streaming may still be true), and a sync launch would no-op.
  queueMicrotask(() => {
    flushChatContinuationIfIdle(chatId);
  });
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

/**
 * Chats whose current turn was killed by the stall heartbeat. Their stream-end
 * must NOT wipe the stall-restart counter (so the next stall escalates instead
 * of nudging forever). Consumed by the stream-end subscriber.
 */
const stallStoppedChatIds = new Set<string>();

/** Max `board_report` reminders per board chat before falling through to self-heal. */
export const MISSING_REPORT_NUDGE_CAP = 2;

/**
 * Per-chatId count of missing-report nudges. Deliberately NOT cleared by
 * `stopTaskChatSupervision`: every nudge produces another stream-end, and the
 * subscriber stops supervision before the finalizer runs — clearing there would
 * reset the budget on each pass and nudge forever. Reset only when a genuinely
 * new phase run is launched (see `getOrCreateBoardChat`).
 */
const missingReportNudges = new Map<string, number>();
const contextRetryAssistantTurns = new WeakMap<Chat, number>();
const taskTestFinalizeInFlight = new Set<string>();

/** Test-only: capture stall-path nudge/self-heal calls from heartbeat supervision. */
let taskChatNudgeCallsForTests: string[] | null = null;
let taskChatNudgeChatIdsForTests: string[] | null = null;
let stallSelfHealCallsForTests: string[] | null = null;
let fixerStallStopsForTests: { taskId: string; chatId: string }[] | null = null;

function recordTaskChatNudgeCallForTests(taskId: string, chatId: string): void {
  taskChatNudgeCallsForTests?.push(taskId);
  taskChatNudgeChatIdsForTests?.push(chatId);
}

function recordStallSelfHealCallForTests(taskId: string): void {
  stallSelfHealCallsForTests?.push(taskId);
}

function recordFixerStallStopForTests(taskId: string, chatId: string): void {
  fixerStallStopsForTests?.push({ taskId, chatId });
}

/** Per board task: coalesce concurrent merge/env fixer finalizers (stream-end races). */
const fixerFinalizeInFlight = new Map<string, Promise<void>>();

function fixerFinalizeInflightKey(groupId: string, taskId: string): string {
  return `${groupId}\u0000${taskId}`;
}

/** Run one finalize at a time per board task; parallel callers await the same work. */
async function withFixerFinalizeInflight(
  group: ChatGroup,
  taskId: string,
  run: () => Promise<void>,
): Promise<void> {
  const key = fixerFinalizeInflightKey(group.id, taskId);
  const existing = fixerFinalizeInFlight.get(key);
  if (existing) {
    await existing;
    return;
  }
  const promise = run();
  fixerFinalizeInFlight.set(key, promise);
  try {
    await promise;
  } finally {
    if (fixerFinalizeInFlight.get(key) === promise) {
      fixerFinalizeInFlight.delete(key);
    }
  }
}

function refreshHeartbeatThresholds(): void {
  // Shared singleton with the sub-agent watchdog — both sides must resolve identically.
  setHeartbeatConfig(resolveSupervisionThresholds());
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
        (content.includes('Could not complete this reply') &&
          !isTransientContextLengthError(content))
      ) {
        return 'failed';
      }
      return 'completed';
    }
    if (msg.role === 'user') break;
  }
  return 'failed';
}

/** Resolve why a task build chat ended stopped (run record wins; history marker falls back). */
export function resolveTaskChatStopReason(
  chat: Chat,
  board?: OrchestrateBoardState | null,
): ChatStopReason {
  const runs = chat.runs ?? [];
  if (runs.length > 0) {
    let latest = runs[0]!;
    for (const run of runs) {
      if (run.createdAt > latest.createdAt) latest = run;
    }
    if (latest.status === 'stopped' && latest.stopReason) {
      return latest.stopReason;
    }
  }
  if (board?.userStopped) return 'user';
  return 'system';
}

/** Clear stale structured report fields when a new phase chat starts. */
const BOARD_REPORT_RESET_PATCH = {
  boardReport: undefined,
  testVerdict: undefined,
  testSummary: undefined,
  buildOutcome: undefined,
  buildBlockers: undefined,
} as const;

function buildOutcomeToReportOutcome(
  buildOutcome: string,
): 'pass' | 'fail' | 'env_blocked' | null {
  if (buildOutcome === 'ok') return 'pass';
  if (buildOutcome === 'env_blocked') return 'env_blocked';
  if (buildOutcome === 'failed' || buildOutcome === 'failure') return 'fail';
  return null;
}

/** True when the tester chat has a user turn awaiting a VERDICT (do not reuse stale testVerdict). */
function isTesterVerdictPending(chatId: string | undefined): boolean {
  const id = chatId?.trim();
  if (!id) return false;
  const chat = findChatById(id);
  if (!chat) return false;
  let lastUserIdx = -1;
  for (let i = chat.history.length - 1; i >= 0; i--) {
    if (chat.history[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return false;
  for (let i = chat.history.length - 1; i > lastUserIdx; i--) {
    const msg = chat.history[i];
    if (msg?.role !== 'assistant') continue;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (parseLastVerdictFromContent(content)) return false;
    return true;
  }
  return true;
}

/** Tester stream-end report: transcript VERDICT first, then tester board_report only. */
function resolveTesterPhaseReport(task: BoardTask): BoardReport | null {
  const parsed = parseTesterVerdictMarker(task.testChatId);
  if (parsed) {
    return { outcome: parsed.verdict, summary: parsed.summary };
  }
  if (task.boardReport?.outcome && task.boardReport.summary?.trim()) {
    return task.boardReport;
  }
  if (task.testVerdict && !isTesterVerdictPending(task.testChatId)) {
    return {
      outcome: task.testVerdict,
      summary: task.testSummary?.trim() || `Tester verdict: ${task.testVerdict}`,
    };
  }
  return null;
}

/** Primary structured report with legacy field fallback for hydrated sessions. */
function resolveBoardReport(task: BoardTask): BoardReport | null {
  if (task.boardReport?.outcome && task.boardReport.summary?.trim()) {
    return task.boardReport;
  }
  if (task.testVerdict) {
    return {
      outcome: task.testVerdict,
      summary: task.testSummary?.trim() || `Tester verdict: ${task.testVerdict}`,
    };
  }
  const buildOutcome = task.buildOutcome?.trim();
  if (buildOutcome) {
    const outcome = buildOutcomeToReportOutcome(buildOutcome);
    if (outcome) {
      return {
        outcome,
        summary:
          task.testSummary?.trim() ||
          task.error?.trim() ||
          `Build outcome: ${buildOutcome}`,
        ...(task.buildBlockers?.length ? { blockers: task.buildBlockers } : {}),
      };
    }
  }
  return null;
}

/** Final integration test report (FULL_BOARD) with legacy recordedVerdict fallback. */
function resolveFinalBoardReport(board: OrchestrateBoardState): BoardReport | null {
  const ft = board.finalTest;
  if (!ft) return null;
  if (ft.recordedVerdict === 'pass' || ft.recordedVerdict === 'fail') {
    return {
      outcome: ft.recordedVerdict,
      summary: ft.summary?.trim() || `Final integration test: ${ft.recordedVerdict}`,
    };
  }
  return null;
}

/** Build a SelfHealDeps bag wiring all board-action callbacks. Lazy-built per call. */
function makeSelfHealDeps(): SelfHealDeps {
  return {
    startEnvFixer,
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
    resolveMaxEnvFixAttempts,
    resolveAfkAutoRestartStalls,
    resolveMaxMergeFixerAttempts: () => MAX_MERGE_FIXER_ATTEMPTS,
  };
}

/** What kind of board chat launch failed (routes self-heal category + cleanup). */
type TaskChatLaunchKind = 'build' | 'test' | 'nudge' | 'env-fixer' | 'merge-fixer';

/**
 * Recover from a rejected runChatTurn launch. A failed launch produces no
 * stream-end, so nothing re-drives the board unless we route the failure into
 * self-heal here. Bounded by the per-category attempt caps and the
 * selfHealRound ceiling → terminates in quarantine, never a silent dead board.
 */
function handleTaskChatLaunchFailure(
  group: ChatGroup,
  plannerChat: Chat,
  taskId: string,
  phase: 'build' | 'test' | 'merge',
  kind: TaskChatLaunchKind,
  message: string,
): void {
  const board = group.orchestrateBoard;
  const task = board?.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const summary = message.trim() || 'Task chat failed to launch';
  updateTask(group, taskId, { error: summary }, plannerChat);
  if (kind === 'env-fixer') {
    // A fixer that never launched must not leave stale linkage behind — it
    // would misroute later stream-ends and block builder restart sweeps.
    updateTask(
      group,
      taskId,
      { fixerChatId: undefined, fixerKind: undefined, envFixPhase: undefined },
      plannerChat,
    );
  }
  if (!isBoardRunning(group)) return;

  const category = kind === 'env-fixer' || kind === 'merge-fixer' ? 'infra' : 'code';
  // Defer past the .finally() launch-slot release: isTaskChatActive treats a
  // reserved chat as running, so re-launching synchronously would no-op.
  setTimeout(() => {
    const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === taskId);
    if (!fresh || !isBoardRunning(group)) return;
    void runSelfHeal(
      group,
      fresh,
      plannerChat,
      { phase, category, summary },
      makeSelfHealDeps(),
    ).catch((err) => reportBackgroundError('launch-failure-self-heal', err));
  }, 0);
}

/**
 * A board chat that finished its turn cleanly but never called `board_report`
 * has usually just forgotten the tool — the work itself is intact. Re-prompt the
 * same chat (context and worktree preserved) instead of treating the missing
 * report as a phase failure, which would burn an attempt and, on the test path,
 * restart the Builder from scratch.
 *
 * Bounded by {@link MISSING_REPORT_NUDGE_CAP} per chat; once exhausted the
 * caller falls through to its normal self-heal → quarantine routing.
 *
 * Returns true when a nudge was dispatched and the caller must not finalize.
 */
function tryNudgeForMissingBoardReport(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  chat: Chat,
): boolean {
  // A paused/stopped board must not launch turns; the resume sweep re-drives it.
  if (!isBoardRunning(group)) return false;

  // Only a clean end is recoverable by re-prompting. `stopped` (user Stop, stall
  // kill) and `failed` (provider error, max tool turns) have their own owners and
  // keep their existing park / retry / quarantine routing.
  if (resolveTaskChatStreamOutcome(chat) !== 'completed') return false;

  const chatId = chat.id;
  const sent = missingReportNudges.get(chatId) ?? 0;
  if (sent >= MISSING_REPORT_NUDGE_CAP) return false;

  const attempt = sent + 1;
  missingReportNudges.set(chatId, attempt);
  logBoardReportNudge(group, task.id, attempt, MISSING_REPORT_NUDGE_CAP);
  // Defer past stream teardown: calling nudge while isTaskChatActive is still
  // true no-ops and used to burn this counter with no follow-up turn.
  runAfterChatRelease(chatId, () =>
    runTaskChatNudge(group, task.id, plannerChat, undefined, {
      chatId,
      missingReport: true,
    }),
  );
  return true;
}

function recordBoardQuarantineIssue(
  group: ChatGroup,
  task: BoardTask,
  category: FailureCategory,
  summary: string,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const resolvedCategory: UnresolvedIssue['category'] =
    category === 'unknown' ? 'code' : category;
  const resolutionSteps = resolutionStepsForCategory(resolvedCategory);
  const record: UnresolvedIssue = {
    taskId: task.id,
    title: task.title,
    category: resolvedCategory,
    summary,
    resolutionSteps,
    createdAt: Date.now(),
    attempts: task.selfHealRound ?? task.buildAttempts,
  };
  const prev = board.unresolvedIssues ?? [];
  board.unresolvedIssues = [...prev.filter((u) => u.taskId !== task.id), record];
  scheduleSaveSessions();
}

/**
 * Re-prompt the final integration Tester when it finished cleanly but never
 * reported a verdict. Shares the per-chat nudge budget with task chats.
 */
function tryNudgeForMissingFinalReport(
  group: ChatGroup,
  plannerChat: Chat,
  chat: Chat,
): boolean {
  if (!isBoardRunning(group) || resolveTaskChatStreamOutcome(chat) !== 'completed') return false;
  const sent = missingReportNudges.get(chat.id) ?? 0;
  if (sent >= MISSING_REPORT_NUDGE_CAP) return false;
  const attempt = sent + 1;
  missingReportNudges.set(chat.id, attempt);
  runAfterChatRelease(chat.id, () => runFinalTestReportNudge(group, plannerChat, chat));
  return true;
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
  const currentTask =
    group.orchestrateBoard?.tasks.find((candidate) => candidate.id === task.id) ?? task;
  if (currentTask.status !== 'in_progress') return;
  task = currentTask;

  const chatId = task.chatId?.trim();
  if (!chatId) return;
  const chat = findChatById(chatId);
  if (!chat) return;

  const outcome = resolveTaskChatStreamOutcome(chat);

  if (outcome === 'stopped') {
    const board = group.orchestrateBoard;
    const stopReason = resolveTaskChatStopReason(chat, board);
    if (tryScheduleStallRecoveryOnStreamEnd(group, task, plannerChat, chat, outcome, stopReason)) {
      return;
    }
    logBuildVerdict(group, task.id, 'stopped');
    teardownBoardTaskChatResources(chat, sessionState?.groups);

    const parkUserStop =
      board?.systemPaused !== true &&
      (stopReason === 'user' || board?.userStopped === true);
    if (parkUserStop) {
      // MIN-304: a user Stop is a neutral pause, not a failure. Park the
      // in-flight task back to `planned` so Start re-delegates it, and leave
      // dependents untouched (they were never started and must stay planned).
      // The old path called quarantineTaskAndDependents here, which cascaded
      // Quarantine across the whole downstream graph on a plain Stop. A user
      // Stop also does not burn a stopRetry (that budget is for stall/timeout
      // stops only), so resume starts from a clean attempt count.
      logTaskStatus(group, task.id, task.status, 'planned');
      updateTask(
        group,
        task.id,
        { status: 'planned', endedAt: Date.now(), chatId: undefined },
        plannerChat,
      );
      if (isBoardRunning(group)) {
        void autoDelegateNext(group, plannerChat).catch((err) =>
          reportBackgroundError('auto-delegate-after-stop', err),
        );
      }
      return;
    }

    const freshTask = board?.tasks.find((t) => t.id === task.id) ?? task;
    const stopRetries = (freshTask.stopRetries ?? 0) + 1;
    if (stopRetries <= MAX_STOP_RETRY_ATTEMPTS) {
      logTaskStatus(group, task.id, freshTask.status, 'planned');
      updateTask(
        group,
        task.id,
        {
          status: 'planned',
          endedAt: Date.now(),
          stopRetries,
          chatId: undefined,
        },
        plannerChat,
      );
      if (isBoardRunning(group)) {
        void autoDelegateNext(group, plannerChat).catch((err) =>
          reportBackgroundError('auto-delegate-after-stop', err),
        );
      }
      return;
    }

    quarantineTaskAndDependents(
      group,
      task.id,
      {
        category: 'stall',
        summary: `Stopped repeatedly — ${stopRetries} stop(s)`,
        resolutionSteps: ['agent stalled repeatedly; inspect the task chat, then Requeue'],
        at: Date.now(),
      },
      plannerChat,
    );
    updateTask(
      group,
      task.id,
      { endedAt: Date.now(), stopRetries, chatId: undefined },
      plannerChat,
    );
    if (isBoardRunning(group)) {
      void autoDelegateNext(group, plannerChat).catch((err) =>
        reportBackgroundError('auto-delegate-after-stop', err),
      );
    }
    return;
  }

  if (tryScheduleStallRecoveryOnStreamEnd(group, task, plannerChat, chat, outcome)) {
    return;
  }

  const freshTask = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
  const report = resolveBoardReport(freshTask);

  if (report?.outcome === 'pass') {
    updateTask(
      group,
      task.id,
      {
        endedAt: Date.now(),
        error: undefined,
        testVerdict: undefined,
        testSummary: undefined,
        stopRetries: undefined,
      },
      plannerChat,
    );
    teardownBoardTaskChatResources(chat, sessionState?.groups);
    logBuildVerdict(group, task.id, 'pass');

    const builderChat = findChatById(chatId);
    if (builderChat && !freshTask.synthesizedBuildAt) {
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
      updateTask(group, task.id, { synthesizedBuildAt: Date.now() }, plannerChat);
    }

    const boardAfterPass = group.orchestrateBoard;
    if (boardAfterPass && boardSkipsPerTaskTesting(boardAfterPass)) {
      if (isBoardRunning(group)) {
        void completeTaskAfterVerificationPass(group, freshTask, plannerChat).catch((err) =>
          reportBackgroundError('skip-per-task-merge', err),
        );
      }
      return;
    }

    moveTaskStatus(group, task.id, 'testing', plannerChat);

    if (isBoardRunning(group)) {
      void startTaskTesting(group, task.id, plannerChat).catch((err) =>
        reportBackgroundError('start-task-testing', err),
      );
    }
    return;
  }

  if (report?.outcome === 'env_blocked') {
    const summary = report.summary || 'Environment blocked build verification';
    logBuildVerdict(group, task.id, 'fail', { summary });
    updateTask(group, task.id, { endedAt: Date.now() }, plannerChat);
    teardownBoardTaskChatResources(chat, sessionState?.groups);
    if (isBoardRunning(group)) {
      void startEnvFixer(group, freshTask, plannerChat, 'build', summary).catch((err) =>
        reportBackgroundError('start-env-fixer-build', err),
      );
    } else {
      moveTaskStatus(group, task.id, 'blocked', plannerChat);
      updateTask(group, task.id, { error: summary }, plannerChat);
    }
    return;
  }

  // No report at all: re-prompt the Builder before spending a build attempt.
  // The task stays `in_progress` with its chat and worktree intact.
  if (!report && tryNudgeForMissingBoardReport(group, freshTask, plannerChat, chat)) {
    return;
  }

  const errorSummary =
    report?.outcome === 'fail'
      ? report.summary || 'Build reported failure'
      : 'Task chat ended without board_report';
  logBuildVerdict(group, task.id, 'fail', { summary: errorSummary });
  updateTask(group, task.id, { endedAt: Date.now() }, plannerChat);
  if (isBoardRunning(group)) {
    const nextBuildAttempts = (freshTask.buildAttempts ?? 0) + 1;
    // Missing-report exhaustion at the build cap must quarantine synchronously.
    // Later scripted turns can still fire before an async self-heal run settles.
    if (!report && nextBuildAttempts >= resolveMaxTaskBuildAttempts()) {
      updateTask(
        group,
        freshTask.id,
        { buildAttempts: nextBuildAttempts, error: errorSummary },
        plannerChat,
      );
      quarantineTaskAndDependents(
        group,
        freshTask.id,
        {
          category: 'code',
          summary: errorSummary,
          resolutionSteps: resolutionStepsForCategory('code'),
          at: Date.now(),
        },
        plannerChat,
      );
      recordBoardQuarantineIssue(group, freshTask, 'code', errorSummary);
      void autoDelegateNext(group, plannerChat).catch((err) =>
        reportBackgroundError('auto-delegate-after-quarantine', err),
      );
      return;
    }
    const { outcome, category } = resolveTaskChatStreamFailure(chat);
    const signal = report?.outcome ?? freshTask.buildOutcome;
    const healCategory =
      signal === 'env_blocked' ? 'infra' : !report && outcome === 'completed' ? 'code' : category;
    void runSelfHeal(
      group,
      freshTask,
      plannerChat,
      { phase: 'build', category: healCategory, summary: errorSummary },
      makeSelfHealDeps(),
    ).catch((err) => reportBackgroundError('self-heal-build', err));
    return;
  }
  moveTaskStatus(group, task.id, 'failed', plannerChat);
  void finalizeTerminalBuildFailure(group, task, plannerChat, chat, errorSummary);
}

/** Map a stalled supervised chat to the self-heal phase for stall recovery. */
function resolveStallHealPhase(
  task: BoardTask,
  stalledChatId: string,
  board?: OrchestrateBoardState,
): 'build' | 'test' | 'merge' {
  const stalled = stalledChatId.trim();
  if (stalled === task.chatId?.trim()) return 'build';
  if (stalled === task.testChatId?.trim()) return 'test';
  if (stalled === task.fixerChatId?.trim()) {
    if (task.fixerKind === 'env') return task.envFixPhase ?? 'build';
    if (task.status === 'merging') return 'merge';
  }
  if (board?.finalTest?.chatId?.trim() === stalled) return 'test';
  return 'build';
}

/** Last-ditch: if stall recovery did not re-occupy the slot, re-drive the board. */
async function maybeAutoDelegateAfterStallIdle(
  group: ChatGroup,
  plannerChat: Chat,
  task: BoardTask,
  chatId: string,
): Promise<void> {
  // Tests skip real launches; do not start auto-report timers from this fallback.
  if (skipBackgroundBoardChatLaunch()) return;
  if (pendingChatContinuations.has(chatId)) return;
  if (!isBoardRunning(group)) return;
  if (isTaskChatActive(chatId)) return;
  const board = group.orchestrateBoard;
  const fresh = board?.tasks.find((t) => t.id === task.id);
  if (!board || !fresh) return;
  if (fresh.status !== 'in_progress' && fresh.status !== 'testing') return;
  if (!isTaskStalledForRestart(board, fresh, isTaskChatActiveForStallCheck)) return;
  await autoDelegateNext(group, plannerChat);
}

/**
 * Continue-nudge on first stall, self-heal on the second. Heartbeat only kills;
 * this runs after the chat has released its slot.
 */
function scheduleStallRecoveryAfterRelease(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  chatId: string,
): void {
  if (stallRecoveryScheduled.has(chatId)) return;
  stallRecoveryScheduled.add(chatId);
  const reason =
    stallStopReasons.get(chatId) ?? 'task-chat-stall (no output)';
  stallStopReasons.delete(chatId);
  const restarts = taskChatStallRestarts.get(chatId) ?? 0;
  runAfterChatRelease(chatId, async () => {
    if (restarts === 1) {
      recordTaskChatNudgeCallForTests(task.id, chatId);
      await runTaskChatNudge(group, task.id, plannerChat, reason, { chatId });
    } else if (restarts >= 2) {
      recordStallSelfHealCallForTests(task.id);
      const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
      const phase = resolveStallHealPhase(fresh, chatId, group.orchestrateBoard);
      await runSelfHeal(
        group,
        fresh,
        plannerChat,
        { phase, category: 'stall', summary: reason },
        makeSelfHealDeps(),
      );
      // runSelfHeal already re-drives the board; do not autoDelegateNext again.
      return;
    }
    await maybeAutoDelegateAfterStallIdle(group, plannerChat, task, chatId);
  });
}

/**
 * True when this stream-end belongs to a stall kill. Schedules deferred recovery
 * and tells the caller to skip park / stopRetries / missing-report routing.
 */
function tryScheduleStallRecoveryOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  chat: Chat,
  outcome: TaskChatStreamOutcome,
  stopReason?: ChatStopReason,
): boolean {
  const chatId = chat.id;
  const restarts = taskChatStallRestarts.get(chatId) ?? 0;
  if (restarts <= 0 && !stallStopReasons.has(chatId) && !stallRecoveryScheduled.has(chatId)) {
    return false;
  }
  const board = group.orchestrateBoard;
  const reason = stopReason ?? resolveTaskChatStopReason(chat, board);
  if (reason === 'user' || board?.userStopped === true) return false;
  if (outcome === 'completed') return false;

  if (stallStopReasons.has(chatId) || stallRecoveryScheduled.has(chatId)) {
    scheduleStallRecoveryAfterRelease(group, task, plannerChat, chatId);
    return true;
  }
  // Leftover stall-restart budget on a system stop: do not park / burn stopRetries
  // (the original early return). Recovery is already queued or was the heartbeat's.
  if (outcome === 'stopped' && reason === 'system' && restarts > 0) {
    return true;
  }
  return false;
}

function startTaskChatSupervision(chatId: string): void {
  stallRecoveryScheduled.delete(chatId);
  const runId = chatTaskRunId(chatId);
  const supervision = createRunSupervision();
  bindRunSupervision(runId, supervision);
  startHeartbeat(runId, () => {
    const chat = findChatById(chatId);
    if (!chat?.boardGroupId) return;

    const group = getBoardGroupForChat(chat);
    if (!group?.orchestrateBoard) return;

    const mode = getBoardExecutionMode(group.orchestrateBoard);
    // Sequential runs one chat at a time, so a hung chat stops the whole board —
    // it needs stall supervision just as much as afk/auto. Only manual opts out.
    if (mode === 'manual') return;
    if (!isBoardRunning(group)) return;
    if (isSupervisionPageHidden()) return;

    const sup = getRunSupervision(runId);
    if (!sup) return;
    const thresholds = resolveSupervisionThresholds();
    if (thresholds.progressStallMs <= 0) return;
    const progressAge = getProgressAgeMs(runId);
    if (progressAge == null) return;

    const taskId = chat.boardTaskId;
    if (!taskId) return;

    const planner = getPlannerChatForGroup(group);
    if (!planner) return;

    const stallTask = group.orchestrateBoard.tasks.find((t) => t.id === taskId);

    const stallMs = thresholds.progressStallMs * TASK_CHAT_STALL_MULTIPLIER;
    if (progressAge < stallMs) return;

    const restarts = taskChatStallRestarts.get(chatId) ?? 0;
    if (restarts >= TASK_CHAT_STALL_RESTART_CAP) return;

    // Stalled fixer chat: kill the stuck turn only. stopGeneration always produces
    // a stream-end, and the fixer finalizer is the single owner of bounded fixer
    // recovery (envFixAttempts / fixerAttempts / runSelfHeal → quarantine). Nudging
    // here as well would race the finalizer into dispatching a second fixer.
    if (stallTask?.fixerChatId?.trim() === chatId) {
      stopHeartbeat(chatTaskRunId(chatId));
      stallStoppedChatIds.add(chatId);
      recordFixerStallStopForTests(stallTask.id, chatId);
      stopGeneration(chatId, 'system');
      return;
    }

    taskChatStallRestarts.set(chatId, restarts + 1);
    // Stop the heartbeat timer only — do NOT call stopTaskChatSupervision here, as that
    // would delete the counter we just set. Mark the chat so the stall-stop stream-end
    // also preserves the counter; it is cleared on a natural stream end.
    stopHeartbeat(chatTaskRunId(chatId));
    stallStoppedChatIds.add(chatId);
    stallStopReasons.set(chatId, `task-chat-stall (${progressAge}ms no output)`);
    stopGeneration(chatId, 'system');
    // Recovery is owned by stream-end (runAfterChatRelease). Nudging here races
    // abort teardown: isTaskChatActive is still true, so the launch no-ops.
  });
}

function stopTaskChatSupervision(chatId: string): void {
  taskChatStallRestarts.delete(chatId);
  stallStoppedChatIds.delete(chatId);
  stallStopReasons.delete(chatId);
  stallRecoveryScheduled.delete(chatId);
  stopHeartbeat(chatTaskRunId(chatId));
}

function isTaskChatStreaming(chatId: string): boolean {
  return (
    isChatStreaming(chatId) ||
    isChatTurnSetupPending(chatId) ||
    isLaunchReserved(chatId)
  );
}

/** Provider/model for board chats — board override, then planner / top bar / settings default. */
function resolvePlannerModelBinding(
  plannerChat: Chat,
  board?: OrchestrateBoardState | null,
): { providerId: string; modelId: string } {
  const resolvedBoard =
    board ?? getBoardGroupForChat(plannerChat)?.orchestrateBoard ?? null;
  return resolveBoardModelBinding(plannerChat, resolvedBoard);
}

/** Keep task/test/final chats aligned with the planner model + reasoning before launching a turn. */
function syncTaskChatModelFromPlanner(taskChat: Chat, plannerChat: Chat): void {
  const board = getBoardGroupForChat(plannerChat)?.orchestrateBoard ?? null;
  const binding = resolvePlannerModelBinding(plannerChat, board);
  if (binding.providerId) taskChat.providerId = binding.providerId;
  if (binding.modelId) taskChat.modelId = binding.modelId;
  if (board) applyBoardReasoningToChat(taskChat, board);
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
      // Reusing the same phase chat (nudge continuation or self-heal retry) must
      // preserve the missing-report nudge budget — resetting here caused infinite
      // nudges and blocked quarantine at the build cap.
      if (input.taskId) existing.boardTaskId = input.taskId;
      if (input.role === 'tester') existing.workAgentId = 'tester';
      if (input.role === 'fixer') existing.workAgentId = null;
      syncTaskChatModelFromPlanner(existing, input.plannerChat);
      if (input.taskId && input.taskChatField) {
        updateTask(
          input.group,
          input.taskId,
          { [input.taskChatField]: existing.id },
          input.plannerChat,
        );
      }
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
  const board = input.group.orchestrateBoard;
  if (board) applyBoardReasoningToChat(chat, board);
  return chat;
}

function ensureStreamEndSubscription(): void {
  if (!streamEndSubscribed) {
    streamEndSubscribed = true;
    subscribeChatStreamEnd((endedChatId) => {
      // Close durable ownership before any stream-end finalizer can make the
      // board terminal. The runner's `.finally` release remains an idempotent
      // fallback for setup failures that never emit stream-end.
      releaseLaunchSlot(endedChatId);
      const hadStallStop = stallStoppedChatIds.delete(endedChatId);
      const stallRestarts = taskChatStallRestarts.get(endedChatId) ?? 0;
      if (hadStallStop) {
        // Stall-kill stream-end: keep the restart counter so the next stall
        // escalates (nudge → self-heal → cap) instead of nudging forever.
        stopHeartbeat(chatTaskRunId(endedChatId));
      } else if (stallRestarts > 0) {
        const endedChat = findChatById(endedChatId);
        const endedOutcome = endedChat ? resolveTaskChatStreamOutcome(endedChat) : 'failed';
        if (endedOutcome === 'completed') {
          stopTaskChatSupervision(endedChatId);
        } else {
          // Duplicate stall-stop end (e.g. flushStoppedChatPresentation after
          // stopGeneration) — keep the restart budget until a natural completion.
          stopHeartbeat(chatTaskRunId(endedChatId));
        }
      } else {
        stopTaskChatSupervision(endedChatId);
      }
      if (!sessionState) return;
      // Drain now, then again after a microtask: notifyChatStreamEnded fires
      // before setStreaming(false) clears the ended chat, so in sequential mode
      // the concurrency check sees count=1 and enqueues instead of starting.
      // Re-drain after the flag clears. Rejections are logged, never swallowed.
      const safeDrain = (g: ChatGroup, p: Chat): void => {
        flushChatContinuationIfIdle(endedChatId);
        void drainTaskQueue(g, p).catch((err) =>
          reportBackgroundError('drain-task-queue', err),
        );
        queueMicrotask(() => {
          flushChatContinuationIfIdle(endedChatId);
          void drainTaskQueue(g, p).catch((err) =>
            reportBackgroundError('drain-task-queue', err),
          );
        });
      };
      for (const group of sessionState.groups ?? []) {
        const board = group.orchestrateBoard;
        if (!board) continue;
        const planner = getPlannerChatForGroup(group);
        if (!planner) continue;

        let streamEndMatched = false;

        const finalChatId = board.finalTest?.chatId?.trim();
        if (finalChatId && endedChatId === finalChatId) {
          streamEndMatched = true;
          finalizeFinalTestOnStreamEnd(group, planner);
          safeDrain(group, planner);
          continue;
        }

        const taskByBuild = board.tasks.find((t) => t.chatId === endedChatId);
        if (taskByBuild) {
          streamEndMatched = true;
          finalizeBoardTaskOnStreamEnd(group, taskByBuild, planner);
          safeDrain(group, planner);
          continue;
        }

        const taskByTest = board.tasks.find((t) => t.testChatId === endedChatId);
        if (taskByTest) {
          streamEndMatched = true;
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
        const fixerTask =
          taskByFixer ?? resolveFixerTaskForStreamEnd(board, endedChatId);
        if (fixerTask) {
          streamEndMatched = true;
          const finalize =
            fixerTask.fixerKind === 'env'
              ? finalizeEnvFixerOnStreamEnd(group, fixerTask, planner, endedChatId)
              : finalizeMergeFixerOnStreamEnd(group, fixerTask, planner, endedChatId);
          void finalize
            .then(() => safeDrain(group, planner))
            .catch((err) =>
              reportBackgroundError(
                fixerTask.fixerKind === 'env' ? 'finalize-env-fixer' : 'finalize-merge-fixer',
                err,
              ),
            );
        } else if (!streamEndMatched && isBoardRunning(group)) {
          safeDrain(group, planner);
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

/** Apply OOM recovery cap on top of board/global concurrency settings. */
export function resolveEffectiveMaxConcurrent(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): number {
  const base = resolveBoardMaxConcurrent(board);
  if (!isOomPauseActive()) return base;
  return Math.min(base, OOM_SAFE_MAX_CONCURRENT);
}

function maxConcurrent(board: NonNullable<ChatGroup['orchestrateBoard']>): number {
  return resolveEffectiveMaxConcurrent(board);
}

/**
 * Background board chat launches are suppressed under node:test unless a test
 * explicitly installs a runner via setBoardChatTurnRunner (opting into the real
 * launch path: chat creation, worktree ensure, supervision timers, slot accounting).
 */
function skipBackgroundBoardChatLaunch(): boolean {
  if (boardChatTurnRunner !== runChatTurn) return false;
  return typeof process !== 'undefined' && process.env?.MINNOW_TEST === '1';
}

/** Best-effort sidebar repaint after a launch. UI failures must never fail a launch. */
async function refreshSidebarAfterLaunch(): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    const { renderSidebar } = await import('../ui/sidebar.ts');
    renderSidebar();
  } catch (err) {
    reportBackgroundError('board-launch-sidebar-refresh', err);
  }
}

/** Phase label for a running board task slot (build / test / fix / merge / final integration). */
export type RunningBoardTaskPhase = 'build' | 'test' | 'fix' | 'merge' | 'final';

/** One concurrency slot occupied by a streaming or launching task chat, or a pipeline hold. */
export interface RunningBoardTaskSlot {
  taskId: string;
  title: string;
  chatId?: string;
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

/** Running task / tester / final-integration chats plus pipeline holds occupying a slot. */
export function countRunningTaskChats(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): number {
  const slots = listChatRunningBoardTaskSlots(board);
  const withChat = new Set(slots.map((s) => s.taskId));
  let holds = 0;
  for (const taskId of heldTaskIdsForOccupancy(board)) {
    if (!withChat.has(taskId)) holds += 1;
  }
  return slots.length + holds;
}

/** Enumerate active board task chats (build, test, fixer, final integration). */
export function listRunningBoardTaskSlots(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): RunningBoardTaskSlot[] {
  const slots = listChatRunningBoardTaskSlots(board);
  const withChatTaskIds = new Set(slots.map((s) => s.taskId));
  for (const hold of listPipelineHolds(board)) {
    if (withChatTaskIds.has(hold.taskId)) continue;
    const task = board.tasks.find((t) => t.id === hold.taskId);
    slots.push({
      taskId: hold.taskId,
      title: task?.title ?? hold.taskId,
      phase: 'merge',
      task,
    });
    withChatTaskIds.add(hold.taskId);
  }
  return slots;
}

function listChatRunningBoardTaskSlots(
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
    if (testId && !(boardSkipsPerTaskTesting(board) && task.status !== 'testing')) {
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

/**
 * Stall-restart check: reserved-but-not-streaming chats are leaked launch slots,
 * not healthy occupancy — treat them as idle so auto-pilot can recover.
 */
export function isTaskChatActiveForStallCheck(chatId: string): boolean {
  if (
    isLaunchReserved(chatId) &&
    !isChatStreaming(chatId) &&
    !isChatTurnSetupPending(chatId)
  ) {
    return false;
  }
  return isTaskChatActive(chatId);
}

/** Running slots minus one reserved-only chat and one self-hold that must not block launch. */
function effectiveRunningTaskCount(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
  excludeReservedOnlyChatId?: string,
  excludeHoldTaskId?: string,
): number {
  let count = countRunningTaskChats(board);
  const exclude = excludeReservedOnlyChatId?.trim();
  if (
    exclude &&
    isLaunchReserved(exclude) &&
    !isChatStreaming(exclude) &&
    !isChatTurnSetupPending(exclude)
  ) {
    count = Math.max(0, count - 1);
  }
  const excludeHold = excludeHoldTaskId?.trim();
  if (excludeHold && hasPipelineHold(board, excludeHold)) {
    const withChat = new Set(
      listChatRunningBoardTaskSlots(board).map((s) => s.taskId),
    );
    if (!withChat.has(excludeHold)) {
      count = Math.max(0, count - 1);
    }
  }
  return count;
}

/** Whether a board task can take a concurrency slot (reclaims its own leaked tester reservation). */
function canLaunchBoardTask(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
  task?: BoardTask,
): boolean {
  const exclude =
    task?.status === 'testing' ? task.testChatId?.trim() : undefined;
  return effectiveRunningTaskCount(board, exclude, task?.id) < maxConcurrent(board);
}

/** Release a leaked launch reservation on a task test chat before early return. */
function releaseTestChatLaunchReservation(testChatId: string | undefined): void {
  const id = testChatId?.trim();
  if (id && isLaunchReserved(id)) releaseLaunchSlot(id);
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
    `When done, call board_report({ task_id: "${task.id}", outcome: "pass"|"env_blocked"|"fail", summary: "..." }).`,
    'Use env_blocked (with blockers) if services/commands were missing; never report pass unless verification actually ran.',
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
    `Call board_report({ task_id: "${task.id}", outcome: "pass"|"env_blocked"|"fail", summary: "..." }) when done.`,
    'Use env_blocked (with blockers) if services were unavailable; never report pass unless verification actually ran.',
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
    `Report exactly once via board_report({ task_id: "${task.id}", outcome: "pass" | "fail", summary: "..." }).`,
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
    `Report exactly once via board_report({ task_id: "${FULL_BOARD_TEST_ID}", outcome: "pass" | "fail", summary: "...", failing_tasks: [...] }).`,
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
  if (
    task.status === 'in_progress' &&
    board &&
    boardSkipsPerTaskTesting(board) &&
    resolveBoardReport(task)?.outcome === 'pass'
  ) {
    await completeTaskAfterVerificationPass(group, task, plannerChat);
    return;
  }
  if (task.status === 'testing') {
    await startTaskTesting(group, taskId, plannerChat, {
      allowPreReservedTestChat: true,
    });
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

/** Role-specific board_report reminder for stall nudges. */
function boardReportNudgeLine(
  task: BoardTask,
  stalledChatId?: string,
): string {
  const stalled = stalledChatId?.trim();
  if (stalled === task.testChatId?.trim()) {
    return (
      'Continue verification where you left off and call board_report with pass or fail when done.'
    );
  }
  if (stalled === task.fixerChatId?.trim()) {
    if (task.status === 'merging') {
      return (
        'Continue resolving the merge conflict, run `git commit --no-edit` when ready, ' +
        'then call board_report with pass or fail.'
      );
    }
    return (
      'Continue environment repair and call board_report with pass, fail, or env_blocked when done.'
    );
  }
  return (
    'Continue where you left off and call board_report with pass, fail, or env_blocked when the build phase is complete.'
  );
}

/** Short nudge appended to an existing task chat — no full task reseed. */
export function buildContinueNudgeMessage(
  task: BoardTask,
  priorError?: string,
  options?: { stalledChatId?: string; missingReport?: boolean },
): string {
  const lines = [
    `Continue the orchestrate task ${task.id} — ${task.title} where you left off.`,
    "Pick up from your last step; don't restart from scratch.",
  ];
  if (options?.missingReport) {
    lines.push(
      'Your last turn ended without calling board_report, so the board cannot advance.',
      'If the work is already done, call board_report now with the outcome; otherwise finish it first.',
    );
  }
  const err = priorError?.trim();
  if (err) {
    lines.push(`The prior attempt errored mid-way: ${err}`);
  }
  lines.push(boardReportNudgeLine(task, options?.stalledChatId));
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
  return updateTask(group, task.id, patch, plannerChat);
}

/** Manual recovery for a task stuck in `merging` — stop fixer supervision then reconcile. */
export async function recoverMergingBoardTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  const task = board?.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'merging') return;

  const fixerId = task.fixerChatId?.trim();
  if (fixerId) {
    stopTaskChatSupervision(fixerId);
    // System recovery — must not mark the fixer as a user stop (neutral-stop path).
    stopGeneration(fixerId, 'system');
    releaseLaunchSlot(fixerId);
  }
  releasePipelineHoldsForTask(board, taskId);

  await reconcileMergingTasks(group, plannerChat);
  emitBoardChange(group.id);
}

/** Re-spawn the correct phase chat when a stall nudge target chat is missing. */
async function restartStallNudgeFallback(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  priorError?: string,
  stalledChatId?: string,
): Promise<void> {
  const hold = acquireBoardPipelineHold(group, task.id, 'merge');
  try {
    const stalled = stalledChatId?.trim();
    if (!stalled || stalled === task.chatId?.trim()) {
      await startTask(group, task.id, plannerChat);
      return;
    }
    if (
      stalled === task.testChatId?.trim() ||
      group.orchestrateBoard?.finalTest?.chatId?.trim() === stalled
    ) {
      await startTaskTesting(group, task.id, plannerChat);
      return;
    }
    if (stalled === task.fixerChatId?.trim()) {
      if (task.status === 'merging') {
        const branch = task.worktreeBranch?.trim();
        const board = group.orchestrateBoard;
        if (branch && board?.integrationBranch) {
          await startMergeConflictFixer(group, task, plannerChat, [], task.mergePreSha);
          return;
        }
        quarantineTaskAndDependents(
          group,
          task.id,
          {
            category: 'merge',
            summary: priorError || 'Merge fixer chat missing and merge context invalid',
            resolutionSteps: ['inspect merge state, then Requeue'],
            at: Date.now(),
          },
          plannerChat,
        );
        return;
      }
      if (task.fixerKind === 'env') {
        await startEnvFixer(
          group,
          task,
          plannerChat,
          task.envFixPhase ?? 'build',
          priorError || 'Environment fixer stalled',
        );
        return;
      }
    }
    await startTask(group, task.id, plannerChat);
  } finally {
    releasePipelineHold(hold);
  }
}

/** Run a continue nudge on an existing task chat (no original-prompt reseed). */
export async function runTaskChatNudge(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
  priorError?: string,
  options?: { chatId?: string; missingReport?: boolean },
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  let task = board.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const targetChatId = options?.chatId?.trim() || task.chatId?.trim();
  if (!targetChatId) {
    await restartStallNudgeFallback(group, task, plannerChat, priorError, options?.chatId);
    return;
  }
  if (isTaskChatActive(targetChatId)) return;

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

  const taskChat = findChatById(targetChatId);
  if (!taskChat) {
    await restartStallNudgeFallback(group, task, plannerChat, priorError, targetChatId);
    return;
  }

  task = board.tasks.find((t) => t.id === taskId) ?? task;

  const nudgePhase: BoardExecutionPhase =
    targetChatId === task.fixerChatId?.trim()
      ? 'fixer'
      : targetChatId === task.testChatId?.trim()
        ? 'test'
        : 'build';
  reserveLaunchSlot(taskChat.id, group, nudgePhase, task.id);
  try {
    await refreshSidebarAfterLaunch();

    if (targetChatId === task.chatId?.trim()) {
      const worktreeRoot = await ensureTaskWorktree(group, task, plannerChat);
      if (worktreeRoot) {
        taskChat.worktreeRoot = worktreeRoot;
        scheduleSaveSessions();
      }
    }

    const nudge = buildContinueNudgeMessage(task, priorError, {
      stalledChatId: targetChatId,
      missingReport: options?.missingReport,
    });
    refreshHeartbeatThresholds();
    startTaskChatSupervision(taskChat.id);

    void boardChatTurnRunner({
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
      handleTaskChatLaunchFailure(
        group,
        plannerChat,
        taskId,
        'build',
        'nudge',
        message || 'Task chat failed to continue',
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
  if (task.status === 'merging') {
    await recoverMergingBoardTask(group, taskId, plannerChat);
    return;
  }
  if (task.status === 'testing') {
    await startTaskTesting(group, taskId, plannerChat, {
      allowPreReservedTestChat: true,
    });
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
  if (task.status === 'merging') {
    await recoverMergingBoardTask(group, taskId, plannerChat);
    return;
  }
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
  if (task.status === 'merging') {
    await recoverMergingBoardTask(group, taskId, plannerChat);
    return;
  }
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
  for (const taskId of sweepExpiredPipelineHolds(board)) {
    reportBackgroundError(
      'pipeline-hold-expired',
      new Error(`Pipeline hold expired for task ${taskId}`),
    );
  }
  if (drainInFlightByGroupId.has(group.id)) return;
  drainInFlightByGroupId.add(group.id);
  try {
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
      if (drainResumeCallsForTests) drainResumeCallsForTests.push(nextId);
      await resumeBoardTask(group, nextId, plannerChat);
    }
    if (!queue.length) {
      taskQueueByGroupId.delete(group.id);
    }
  } finally {
    drainInFlightByGroupId.delete(group.id);
  }
}

function enqueueTask(groupId: string, taskId: string): void {
  const q = taskQueueByGroupId.get(groupId) ?? [];
  if (!q.includes(taskId)) q.push(taskId);
  taskQueueByGroupId.set(groupId, q);
}

/** Prepend a task to the board queue so it resumes before siblings after a fixer pass. */
function enqueueTaskAtFront(groupId: string, taskId: string): void {
  const q = taskQueueByGroupId.get(groupId) ?? [];
  const without = q.filter((id) => id !== taskId);
  without.unshift(taskId);
  taskQueueByGroupId.set(groupId, without);
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
    const startedAt = Date.now();
    const phaseId = `phase:merge:${task.id}:${++durableRuntimeSeq}`;
    const lifecycleRun = task.lifecycleRun ?? 0;
    logBoardPhase(group, 'start', {
      phaseId,
      phase: 'merge',
      taskId: task.id,
      lifecycleRun,
      ownerId: 'merge-queue',
    });
    try {
      await waitForNoActiveFixer(group, plannerChat);
      return await mergeCompletedTaskWorktree(group, task, plannerChat);
    } finally {
      logBoardPhase(group, 'end', {
        phaseId,
        phase: 'merge',
        taskId: task.id,
        lifecycleRun,
        ownerId: 'merge-queue',
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    }
  });
}

type MergeFixerSeedOptions = {
  verifyFailureSummary?: string;
  attemptNumber?: number;
  maxAttempts?: number;
};

/** Seed for a merge-conflict fixer chat (runs in the integration worktree). */
function buildMergeFixerSeedMessage(
  task: BoardTask,
  conflictedFiles: string[],
  seedOptions?: MergeFixerSeedOptions,
): string {
  const branch = task.worktreeBranch?.trim() || '(unknown branch)';
  const fileList =
    conflictedFiles.length > 0
      ? conflictedFiles.map((f) => `- ${f}`).join('\n')
      : '- (run git status to list conflicted files)';
  const lines = [
    `Resolve the in-progress git merge of \`${branch}\` into integration.`,
    '',
    'The merge is already in progress in this integration worktree (MERGE_HEAD is set).',
    'Do not run `git merge`, `git reset`, `git checkout`, or `git merge --abort` —',
    'those commands destroy the in-progress merge state.',
  ];
  if (
    seedOptions?.attemptNumber !== undefined &&
    seedOptions?.maxAttempts !== undefined
  ) {
    lines.push(
      '',
      `This is retry attempt ${seedOptions.attemptNumber} of ${seedOptions.maxAttempts}.`,
    );
  }
  if (seedOptions?.verifyFailureSummary?.trim()) {
    lines.push(
      '',
      'Previous board_report was pass but post-merge verification failed:',
      seedOptions.verifyFailureSummary.trim(),
      '',
      'Re-commit the merge if needed, then call board_report again.',
    );
  }
  lines.push(
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
    '',
    `When the merge is committed, call board_report({ task_id: "${task.id}", outcome: "pass" | "fail", summary: "..." }) exactly once.`,
  );
  return lines.join('\n');
}

/** Spawn a fixer chat to resolve an integration merge conflict. */
export async function startMergeConflictFixer(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  conflictedFiles: string[],
  integrationSha?: string,
  seedOptions?: MergeFixerSeedOptions,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board?.integrationBranch) return;

  const hold = acquireBoardPipelineHold(group, task.id, 'merge-fixer-start');
  try {
  const boardId = group.id;

  const ensured = await ensureIntegrationWorktree({
    boardId,
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

  // Part 3: Guard against launching a fixer when MERGE_HEAD has already vanished.
  const branch = task.worktreeBranch?.trim();
  let effectiveConflictedFiles = conflictedFiles;
  let effectiveIntegrationSha = integrationSha;
  if (isLocalServerAvailable() && branch) {
    const inProg = await checkMergeInProgressOp({ boardId });
    if (inProg.ok && !inProg.inProgress) {
      const alreadyMerged = await checkTaskBranchMerged({ boardId, fromBranch: branch });
      if (alreadyMerged.ok && alreadyMerged.merged) {
        // Merge already committed — skip fixer; synthetic pass report for report-driven finalize.
        moveTaskStatus(group, task.id, 'merging', plannerChat);
        updateTask(
          group,
          task.id,
          {
            boardReport: {
              outcome: 'pass',
              summary: 'Merge already committed (MERGE_HEAD absent on preflight)',
            },
          },
          plannerChat,
        );
        const freshMerged = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
        await finalizeMergeFixerOnStreamEnd(group, freshMerged, plannerChat).catch((err) =>
          reportBackgroundError('merge-fixer-already-merged', err),
        );
        return;
      }
      // Re-establish authoritative merge state.
      const remerge = await mergeTaskIntoIntegration({
        boardId,
        fromBranch: branch,
        message: `Merge ${task.id} (${task.title}) into integration`,
      });
      if (!remerge.ok && remerge.conflict) {
        // Fresh conflict — continue spawning fixer with updated state.
        effectiveConflictedFiles = remerge.conflictedFiles ?? conflictedFiles;
        effectiveIntegrationSha = remerge.integrationSha ?? integrationSha;
      } else if (remerge.ok) {
        // Merged cleanly — synthetic pass report then report-driven finalize.
        moveTaskStatus(group, task.id, 'merging', plannerChat);
        updateTask(
          group,
          task.id,
          {
            boardReport: {
              outcome: 'pass',
              summary: 'Merge completed cleanly on preflight re-merge',
            },
          },
          plannerChat,
        );
        const freshClean = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
        await finalizeMergeFixerOnStreamEnd(group, freshClean, plannerChat).catch((err) =>
          reportBackgroundError('merge-fixer-clean-remerge', err),
        );
        return;
      } else {
        // Error re-establishing merge state — self-heal.
        moveTaskStatus(group, task.id, 'merging', plannerChat);
        const freshForHeal = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
        void runSelfHeal(
          group,
          freshForHeal,
          plannerChat,
          {
            phase: 'merge',
            category: 'stall',
            summary: remerge.output ?? 'Failed to re-establish merge state for fixer',
          },
          makeSelfHealDeps(),
        ).catch((err) => reportBackgroundError('merge-fixer-remerge-error', err));
        return;
      }
    }
  }

  moveTaskStatus(group, task.id, 'merging', plannerChat);
  updateTask(group, task.id, { ...BOARD_REPORT_RESET_PATCH }, plannerChat);

  const preSha = effectiveIntegrationSha?.trim() || task.mergePreSha?.trim();
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
  reserveLaunchSlot(fixerChat.id, group, 'fixer', task.id);
  try {
    const seed = buildMergeFixerSeedMessage(task, effectiveConflictedFiles, seedOptions);
    // Part 1: Supervise the fixer chat like every other board chat starter.
    refreshHeartbeatThresholds();
    startTaskChatSupervision(fixerChat.id);
    void boardChatTurnRunner({
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
      handleTaskChatLaunchFailure(group, plannerChat, task.id, 'merge', 'merge-fixer', message);
    }).finally(() => releaseLaunchSlotAndDrive(group, plannerChat, fixerChat.id));
  } catch (err) {
    releaseLaunchSlotAndDrive(group, plannerChat, fixerChat.id);
    throw err;
  }
  } finally {
    releasePipelineHold(hold);
  }
}

/**
 * When fixerChatId was cleared before stream-end delivery, resolve the task via
 * the ended chat's boardTaskId and task state.
 */
function resolveFixerTaskForStreamEnd(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
  endedChatId: string,
): BoardTask | undefined {
  const chat = findChatById(endedChatId);
  const taskId = chat?.boardTaskId?.trim();
  if (!taskId) return undefined;
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) return undefined;
  if (task.status === 'merging' && resolveBoardReport(task)) {
    return task;
  }
  if (task.fixerKind === 'env') {
    return task;
  }
  return undefined;
}

/** Route merge fixer stream-end: report-driven verify, then complete or retry. */
async function finalizeMergeFixerOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  endedChatId?: string,
): Promise<void> {
  if (task.status !== 'merging') return;
  await withFixerFinalizeInflight(group, task.id, async () => {
  const hold = acquireBoardPipelineHold(group, task.id, 'merge-fixer-finalize');
  try {
    const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;

    // Orphan guard: the task already points at a NEWER fixer chat — this
    // stream-end belongs to a superseded chat. Tear down its resources without
    // touching the live fixer's task state.
    const liveFixerChatId = fresh.fixerChatId?.trim();
    if (endedChatId && liveFixerChatId && liveFixerChatId !== endedChatId) {
      const orphanChat = findChatById(endedChatId);
      if (orphanChat) teardownBoardTaskChatResources(orphanChat, sessionState?.groups);
      return;
    }

    if (fresh.status !== 'merging') return;
    const branch = fresh.worktreeBranch?.trim();
    if (!branch) {
      moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
      return;
    }

    const boardId = group.id;
    const attempts = fresh.fixerAttempts ?? 0;

    // Neutral stop (user Stop / board paused): no automatic retry follows, so do
    // not burn a fixerAttempt or self-heal. Restore the integration worktree,
    // clear the linkage, and leave the task in `merging` — reconcileMergingTasks
    // re-drives it on resume. A `system` stop while running (stall kill) falls
    // through to the bounded failure path below (single recovery owner).
    const endedChatRef = endedChatId?.trim() || liveFixerChatId;
    const endedChat = endedChatRef ? findChatById(endedChatRef) : undefined;
    if (endedChat && resolveTaskChatStreamOutcome(endedChat) === 'stopped') {
      const board = group.orchestrateBoard;
      const stopReason = resolveTaskChatStopReason(endedChat, board);
      const neutralStop =
        stopReason === 'user' || board?.userStopped === true || !isBoardRunning(group);
      if (neutralStop) {
        const preSha = fresh.mergePreSha?.trim();
        if (preSha) {
          await restoreIntegrationWorktree({ boardId, sha: preSha }).catch((err) =>
            reportBackgroundError('worktree-restore-integration', err),
          );
        }
        updateTask(
          group,
          fresh.id,
          { fixerChatId: undefined, mergePreSha: undefined },
          plannerChat,
        );
        teardownBoardTaskChatResources(endedChat, sessionState?.groups);
        return;
      }
    }

    const report = resolveBoardReport(fresh);
    let passVerifyFailureSummary: string | undefined;

    const tryCompleteVerifiedMerge = async (): Promise<boolean> => {
      const merged = await checkTaskBranchMerged({ boardId, fromBranch: branch });
      const verified =
        merged.ok && merged.merged
          ? await verifyIntegrationMergeOp({ boardId, fromBranch: branch })
          : null;
      if (!(merged.ok && merged.merged && verified?.ok && verified.verified)) {
        if (!merged.ok || !merged.merged) {
          passVerifyFailureSummary =
            'board_report pass but branch not merged (check_merged)';
        } else {
          const detail =
            verified?.error?.trim() ||
            verified?.output?.trim() ||
            'verify_integration did not pass';
          passVerifyFailureSummary = `board_report pass but verify_integration failed: ${detail}`;
        }
        return false;
      }
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
      return true;
    };

    if (report?.outcome === 'pass') {
      try {
        if (await tryCompleteVerifiedMerge()) return;
      } catch (err) {
        reportBackgroundError('finalize-merge-fixer', err);
        moveTaskStatus(group, fresh.id, 'blocked', plannerChat);
        return;
      }
    }

    if (!report?.outcome) {
      try {
        if (await tryCompleteVerifiedMerge()) return;
      } catch (err) {
        reportBackgroundError('finalize-merge-fixer-git-fallback', err);
      }
    }

    const fixerSummary =
      report?.outcome === 'fail'
        ? report.summary || 'Merge fixer reported failure'
        : report?.outcome === 'pass'
          ? passVerifyFailureSummary ??
            'Merge fixer reported pass but integration merge could not be verified'
          : 'Merge fixer did not report board_report';

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
      if (mergeResult.outcome === 'merged' || mergeResult.outcome === 'skipped') {
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
      if (mergeResult.outcome === 'conflict') {
        const retrySeedOptions: MergeFixerSeedOptions | undefined =
          report?.outcome === 'pass' && passVerifyFailureSummary
            ? {
                verifyFailureSummary: passVerifyFailureSummary,
                attemptNumber: nextAttempts + 1,
                maxAttempts: MAX_MERGE_FIXER_ATTEMPTS,
              }
            : undefined;
        await startMergeConflictFixer(
          group,
          fresh,
          plannerChat,
          mergeResult.conflictedFiles,
          mergeResult.integrationSha,
          retrySeedOptions,
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
    void runSelfHeal(
      group,
      fresh,
      plannerChat,
      { phase: 'merge', category: 'merge', summary: fixerSummary },
      makeSelfHealDeps(),
    ).catch((err) => reportBackgroundError('self-heal-fixer-terminal', err));
  } finally {
    releasePipelineHold(hold);
  }
  });
}

/** Seed for an environment/setup fixer chat (runs in the task's own worktree). */
function buildEnvFixerSeedMessage(
  task: BoardTask,
  phase: 'build' | 'test',
  summary: string,
): string {
  const verifyCmd = (phase === 'test' ? task.testSpec : task.buildSpec)?.trim();
  return [
    `The environment for task \`${task.id}\` (${task.title}) is broken and ${phase} verification cannot run.`,
    '',
    'Failure summary:',
    summary || '(no summary provided)',
    '',
    "You are an environment fixer working in this task's worktree. Repair the",
    '**environment/setup only** — do not change feature code or expand scope.',
    '',
    'Common fixes:',
    '- Missing project tool (eslint, tsc, vite, prettier, jest, …): add it to the',
    '  correct section of package.json and install (`npm install`).',
    '- Required local service (Postgres, Redis, …): start it',
    '  (e.g. `docker compose up -d <service>`); only add a compose/config file if',
    '  one is clearly missing.',
    '- Missing config/env file: create it from the committed example',
    '  (e.g. copy `.env.example` → `.env`).',
    '',
    'Steps:',
    `1. Reproduce the failure${verifyCmd ? ` (e.g. \`${verifyCmd}\`)` : ''} to confirm the root cause.`,
    '2. Apply the minimal fix.',
    '3. Re-run the failing command and confirm it now succeeds.',
    '',
    'You do not need to run git — the board commits this worktree automatically',
    'when the task passes. Keep the change minimal and scoped to unblocking the build.',
    '',
    `When verification succeeds, call board_report({ task_id: "${task.id}", outcome: "pass" | "fail" | "env_blocked", summary: "..." }) exactly once.`,
  ].join('\n');
}

/**
 * Spawn an environment fixer sub-agent on the task's own worktree to repair an
 * infra failure (missing deps, unstarted services, missing config). Mirrors
 * {@link startMergeConflictFixer} but stays on the task worktree; on stream-end
 * {@link finalizeEnvFixerOnStreamEnd} re-runs the failed phase to verify.
 */
export async function startEnvFixer(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  phase: 'build' | 'test',
  summary: string,
): Promise<void> {
  const worktreeRoot = task.worktreePath?.trim() || plannerChat.workspacePath?.trim();
  if (!worktreeRoot) {
    // Nothing to fix in → cannot self-heal here; quarantine for human follow-up.
    quarantineTaskAndDependents(
      group,
      task.id,
      {
        category: 'infra',
        summary: summary || 'Environment fix required but task has no worktree',
        resolutionSteps: ['fix the environment manually, then Requeue'],
        at: Date.now(),
      },
      plannerChat,
    );
    return;
  }

  // Stay in_progress while the fixer works — the fixer-active guard in
  // isTaskStalledForRestart prevents a spurious builder restart.
  moveTaskStatus(group, task.id, 'in_progress', plannerChat);

  const fixerChat = getOrCreateBoardChat({
    group,
    plannerChat,
    existingId: task.fixerChatId?.trim(),
    role: 'fixer',
    name: `Fix env ${task.id}: ${task.title}`,
    taskId: task.id,
    taskChatField: 'fixerChatId',
  });
  updateTask(
    group,
    task.id,
    { fixerKind: 'env', envFixPhase: phase, ...BOARD_REPORT_RESET_PATCH },
    plannerChat,
  );

  fixerChat.worktreeRoot = worktreeRoot;
  scheduleSaveSessions();

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();
  reserveLaunchSlot(fixerChat.id, group, 'fixer', task.id);
  try {
    const seed = buildEnvFixerSeedMessage(task, phase, summary);
    refreshHeartbeatThresholds();
    startTaskChatSupervision(fixerChat.id);
    void boardChatTurnRunner({
      chat: fixerChat,
      pushUser: true,
      rawText: seed,
      userText: seed,
      displayText: seed,
      historyContent: seed,
      skillId: null,
      validAttachments: [],
      titleSeed: `Fix env ${task.id}`,
      ownsGlobalStreaming: true,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : 'Env fixer chat failed to start';
      handleTaskChatLaunchFailure(group, plannerChat, task.id, phase, 'env-fixer', message);
    }).finally(() => releaseLaunchSlotAndDrive(group, plannerChat, fixerChat.id));
  } catch (err) {
    releaseLaunchSlotAndDrive(group, plannerChat, fixerChat.id);
    throw err;
  }
}

/**
 * Route env-fixer stream-end: clear the fixer linkage and re-run the failed
 * phase. The re-run's own finalizer decides pass (→ testing/complete) or fail
 * (→ self-heal; env-fixer attempts are bounded before quarantine).
 */
async function finalizeEnvFixerOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  endedChatId?: string,
): Promise<void> {
  if (task.fixerKind !== 'env') return;
  await withFixerFinalizeInflight(group, task.id, async () => {
  const hold = acquireBoardPipelineHold(group, task.id, 'env-fixer-finalize');
  try {
    const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;

    // Orphan guard: the task already points at a NEWER fixer chat — this
    // stream-end belongs to a superseded chat. Tear down its resources without
    // touching the live fixer's task state (no attempt burn, no self-heal).
    const liveFixerChatId = fresh.fixerChatId?.trim();
    if (endedChatId && liveFixerChatId && liveFixerChatId !== endedChatId) {
      const orphanChat = findChatById(endedChatId);
      if (orphanChat) teardownBoardTaskChatResources(orphanChat, sessionState?.groups);
      return;
    }

    if (fresh.fixerKind !== 'env') return;
    const phase = fresh.envFixPhase ?? 'test';

    // Neutral stop (user Stop / board paused): no automatic retry follows, so do
    // not burn an envFixAttempt or self-heal. Clear the linkage; the task stays
    // in_progress and the resume sweep restarts the phase with the attempt
    // budget intact. A `system` stop while running (stall kill) falls through
    // to the bounded failure path below (single recovery owner).
    const endedChatRef = endedChatId?.trim() || liveFixerChatId;
    const endedChat = endedChatRef ? findChatById(endedChatRef) : undefined;
    if (endedChat && resolveTaskChatStreamOutcome(endedChat) === 'stopped') {
      const board = group.orchestrateBoard;
      const stopReason = resolveTaskChatStopReason(endedChat, board);
      const neutralStop =
        stopReason === 'user' || board?.userStopped === true || !isBoardRunning(group);
      if (neutralStop) {
        updateTask(
          group,
          fresh.id,
          { fixerChatId: undefined, fixerKind: undefined, envFixPhase: undefined },
          plannerChat,
        );
        teardownBoardTaskChatResources(endedChat, sessionState?.groups);
        return;
      }
    }

    const report = resolveBoardReport(fresh);

    if (report?.outcome === 'pass') {
      // Record the pass unconditionally — clearing the linkage and advancing the
      // column must survive a paused board, or the fix is lost and the stale
      // fixerChatId misroutes later stream-ends. Only the launch is gated.
      if (phase === 'build') {
        updateTask(
          group,
          fresh.id,
          { fixerChatId: undefined, fixerKind: undefined, envFixPhase: undefined },
          plannerChat,
        );
        if (isBoardRunning(group)) {
          await startTask(group, fresh.id, plannerChat);
        }
      } else {
        updateTask(
          group,
          fresh.id,
          { fixerChatId: undefined, fixerKind: undefined, envFixPhase: undefined },
          plannerChat,
        );
        const boardAfterFix = group.orchestrateBoard;
        if (boardAfterFix && boardSkipsPerTaskTesting(boardAfterFix)) {
          if (isBoardRunning(group)) {
            await completeTaskAfterVerificationPass(group, fresh, plannerChat);
          }
        } else {
          moveTaskStatus(group, fresh.id, 'testing', plannerChat);
          if (isBoardRunning(group)) {
            const testChat = getOrCreateBoardChat({
              group,
              plannerChat,
              existingId: fresh.testChatId?.trim(),
              role: 'tester',
              name: `Test ${fresh.id}: ${fresh.title}`,
              taskId: fresh.id,
              taskChatField: 'testChatId',
            });
            reserveLaunchSlot(testChat.id, group, 'test', fresh.id);
            await startTaskTesting(group, fresh.id, plannerChat, {
              enqueueAtFront: true,
              allowPreReservedTestChat: true,
            });
          }
          // Paused: the resume sweep routes `testing` → startTaskTesting.
        }
      }
      return;
    }

    // No report: re-prompt this fixer before burning an env-fix attempt. Nudge
    // first — clearing the linkage below is what makes the failure terminal.
    if (!report && endedChat && tryNudgeForMissingBoardReport(group, fresh, plannerChat, endedChat)) {
      return;
    }

    updateTask(
      group,
      fresh.id,
      { fixerChatId: undefined, fixerKind: undefined, envFixPhase: undefined },
      plannerChat,
    );

    const summary =
      report?.summary ||
      (report?.outcome === 'env_blocked'
        ? 'Environment still blocked after env fixer'
        : 'Env fixer did not report board_report pass');
    const category = report?.outcome === 'env_blocked' ? 'infra' : 'infra';
    void runSelfHeal(
      group,
      fresh,
      plannerChat,
      { phase, category, summary },
      makeSelfHealDeps(),
    ).catch((err) => reportBackgroundError('self-heal-env-fixer', err));
  } catch (err) {
    reportBackgroundError('finalize-env-fixer', err);
  } finally {
    releasePipelineHold(hold);
  }
  });
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

/** Record that integration work was merged into the workspace and committed. */
export function markBoardIntegrationLanded(group: ChatGroup, plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board || board.integrationLandedAt) return;
  board.integrationLandedAt = Date.now();
  touchChat(plannerChat);
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Clear every git worktree for a board after landing integration in the workspace. */
export async function clearBoardWorktreesAfterLanding(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<{ ok: boolean; removed?: number; error?: string }> {
  const board = group.orchestrateBoard;
  if (!board) return { ok: false, error: 'no_board' };
  if (board.worktreesClearedAt) return { ok: true, removed: 0 };

  const res = await cleanupBoardWorktreesOp({
    boardId: group.id,
    includeIntegration: true,
  });
  if (!res.ok) {
    return { ok: false, error: res.error || res.output || 'cleanup_failed' };
  }

  for (const task of board.tasks) {
    task.worktreePath = undefined;
    task.devPort = undefined;
    task.apiPort = undefined;
    for (const chatId of [task.chatId, task.testChatId, task.fixerChatId]) {
      const id = chatId?.trim();
      if (!id) continue;
      const chat = findChatById(id);
      if (chat?.worktreeRoot) delete chat.worktreeRoot;
    }
  }

  const finalChatId = board.finalTest?.chatId?.trim();
  if (finalChatId) {
    const finalChat = findChatById(finalChatId);
    if (finalChat?.worktreeRoot) delete finalChat.worktreeRoot;
  }

  board.worktreesClearedAt = Date.now();
  touchChat(plannerChat);
  scheduleSaveSessions();
  emitBoardChange(group.id);
  return { ok: true, removed: typeof res.removed === 'number' ? res.removed : undefined };
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

  if (!canLaunchBoardTask(board, task)) {
    enqueueTask(group.id, taskId);
    return;
  }

  if (skipBackgroundBoardChatLaunch()) return;

  ensureStreamEndSubscription();
  updateTask(group, taskId, { ...BOARD_REPORT_RESET_PATCH }, plannerChat);

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

  reserveLaunchSlot(taskChat.id, group, 'build', task.id);
  try {
    await refreshSidebarAfterLaunch();

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

    void boardChatTurnRunner({
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
      handleTaskChatLaunchFailure(
        group,
        plannerChat,
        taskId,
        'build',
        'build',
        message || 'Task chat failed to start',
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
  options?: { enqueueAtFront?: boolean; allowPreReservedTestChat?: boolean },
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'testing') return;

  const existingTestId = task.testChatId?.trim();
  if (existingTestId && isTaskChatActive(existingTestId)) {
    const preReservedOnly =
      options?.allowPreReservedTestChat &&
      isLaunchReserved(existingTestId) &&
      !isChatStreaming(existingTestId) &&
      !isChatTurnSetupPending(existingTestId);
    if (!preReservedOnly) return;
  }

  const taskForCapacity = options?.allowPreReservedTestChat ? task : undefined;
  if (!canLaunchBoardTask(board, taskForCapacity)) {
    releaseTestChatLaunchReservation(existingTestId);
    if (options?.enqueueAtFront) {
      enqueueTaskAtFront(group.id, taskId);
    } else {
      enqueueTask(group.id, taskId);
    }
    return;
  }

  if (skipBackgroundBoardChatLaunch()) {
    releaseTestChatLaunchReservation(existingTestId);
    return;
  }

  ensureStreamEndSubscription();

  const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
  if (!modelId) {
    releaseTestChatLaunchReservation(existingTestId);
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
    { ...BOARD_REPORT_RESET_PATCH },
    plannerChat,
  );

  reserveLaunchSlot(testChat.id, group, 'test', task.id);
  try {
    await refreshSidebarAfterLaunch();

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

    void boardChatTurnRunner({
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
      handleTaskChatLaunchFailure(
        group,
        plannerChat,
        taskId,
        'test',
        'test',
        message || 'Tester chat failed to start',
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
    {
      testAttempts: attempts,
      testSummary: summary,
      // Drop stale VERDICT markers so a retest is not re-read as an immediate fail.
      testVerdict: undefined,
    },
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

function parseLastVerdictFromContent(content: string): {
  verdict: 'pass' | 'fail';
  summary: string;
} | null {
  const pattern = /\bverdict\s*[:=]\s*([a-z]+)/gi;
  let last: { verdict: 'pass' | 'fail'; line: string } | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const verdict = normalizeVerdict(match[1]);
    if (!verdict) continue;
    const line =
      content
        .split(/\r?\n/)
        .find((l) => l.toLowerCase().includes(match![0].trim().toLowerCase()))
        ?.trim() ?? match[0].trim();
    last = { verdict, line };
  }
  if (!last) return null;
  return {
    verdict: last.verdict,
    summary: last.line || `Tester message verdict: ${last.verdict}`,
  };
}

/**
 * Fallback verdict parsed from the Tester chat transcript when the structured
 * `board_report_test_result` call never landed (primary signal). Scans backward
 * for the most recent assistant message that contains an explicit
 * `VERDICT: pass|fail` marker — prose alone is not trusted. Returns null when
 * no marker is present.
 */
function parseTesterVerdictMarker(chatId: string | undefined): {
  verdict: 'pass' | 'fail';
  summary: string;
} | null {
  const id = chatId?.trim();
  if (!id) return null;
  const chat = findChatById(id);
  if (!chat) return null;

  // Ignore VERDICT markers from prior tester rounds — only the latest user turn
  // (the current seed/nudge) and its assistant reply are authoritative.
  let lastUserIdx = -1;
  for (let i = chat.history.length - 1; i >= 0; i--) {
    if (chat.history[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  for (let i = chat.history.length - 1; i > lastUserIdx; i--) {
    const msg = chat.history[i];
    if (!msg || msg.role !== 'assistant') continue;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (!content.trim()) continue;
    const parsed = parseLastVerdictFromContent(content);
    if (parsed) return parsed;
    // Current tester turn has a user seed but no VERDICT yet — do not reuse older turns.
    if (lastUserIdx >= 0) return null;
  }
  return null;
}

/** True when the board header skip-per-task-tests option is enabled. */
export function boardSkipsPerTaskTesting(board: OrchestrateBoardState): boolean {
  return board.skipPerTaskTesting === true;
}

/** Skip toggle is frozen after Start or once any task leaves planned/blocked. */
export function isBoardSkipPerTaskTestingLocked(board: OrchestrateBoardState): boolean {
  if (board.autoRunning === true) return true;
  return board.tasks.some((t) => t.status !== 'planned' && t.status !== 'blocked');
}

/** Persist skip-per-task-tests (header only, before first run). */
export function setBoardSkipPerTaskTesting(
  group: ChatGroup,
  value: boolean,
  _plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board || isBoardSkipPerTaskTestingLocked(board)) return;
  const next = value === true;
  if (boardSkipsPerTaskTesting(board) === next) return;
  if (next) {
    board.skipPerTaskTesting = true;
  } else {
    delete board.skipPerTaskTesting;
  }
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Merge + complete after build or tester verification passes (shared path). */
export async function completeTaskAfterVerificationPass(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<void> {
  const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
  updateTask(group, fresh.id, { error: undefined }, plannerChat);
  const hold = acquireBoardPipelineHold(group, fresh.id, 'merge');
  try {
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

    const testChatIdAfterMerge = fresh.testChatId?.trim();
    const testChat = testChatIdAfterMerge ? findChatById(testChatIdAfterMerge) : null;
    const latestTask =
      group.orchestrateBoard?.tasks.find((t) => t.id === fresh.id) ?? fresh;
    if (testChat && !latestTask.synthesizedTestAt) {
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
      updateTask(group, fresh.id, { synthesizedTestAt: Date.now() }, plannerChat);
    }
  } finally {
    releasePipelineHold(hold);
  }
}

/** Route per-task Tester verdict after its chat stream ends. */
export async function finalizeTaskTestingOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<void> {
  const finalizeKey = `${group.id}:${task.id}`;
  if (taskTestFinalizeInFlight.has(finalizeKey)) return;
  taskTestFinalizeInFlight.add(finalizeKey);
  try {
    await finalizeTaskTestingOnStreamEndImpl(group, task, plannerChat);
  } finally {
    taskTestFinalizeInFlight.delete(finalizeKey);
  }
}

async function finalizeTaskTestingOnStreamEndImpl(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<void> {
  const fresh = group.orchestrateBoard?.tasks.find((t) => t.id === task.id) ?? task;
  if (fresh.status !== 'testing') return;

  // MIN-304: a tester aborted by a user Stop / board pause has no verdict and
  // must not be routed through self-heal as a test failure. Clear the linkage
  // and leave the task in `testing` — the resume sweep (isTaskStalledForRestart)
  // restarts the tester when the board runs again.
  const testChatId = fresh.testChatId?.trim();
  const endedTestChat = testChatId ? findChatById(testChatId) : undefined;
  if (endedTestChat && resolveTaskChatStreamOutcome(endedTestChat) === 'stopped') {
    const board = group.orchestrateBoard;
    const stopReason = resolveTaskChatStopReason(endedTestChat, board);
    const neutralStop =
      stopReason === 'user' || board?.userStopped === true || !isBoardRunning(group);
    if (neutralStop) {
      updateTask(group, fresh.id, { testChatId: undefined }, plannerChat);
      teardownBoardTaskChatResources(endedTestChat, sessionState?.groups);
      return;
    }
  }

  if (
    endedTestChat &&
    tryScheduleStallRecoveryOnStreamEnd(
      group,
      fresh,
      plannerChat,
      endedTestChat,
      resolveTaskChatStreamOutcome(endedTestChat),
    )
  ) {
    return;
  }

  if (
    endedTestChat &&
    resolveTaskChatStreamOutcome(endedTestChat) === 'failed' &&
    isTransientContextLengthError(extractChatFailureText(endedTestChat))
  ) {
    const assistantTurns = countChatAssistantTurns(endedTestChat);
    if (contextRetryAssistantTurns.get(endedTestChat) === assistantTurns) return;
    contextRetryAssistantTurns.set(endedTestChat, assistantTurns);
    const attempts = (fresh.testAttempts ?? 0) + 1;
    if (attempts < resolveMaxTaskTestAttempts()) {
      const summary = 'Tester exceeded the model context window';
      logTaskRetry(group, fresh.id, 'test', attempts);
      updateTask(
        group,
        fresh.id,
        {
          ...BOARD_REPORT_RESET_PATCH,
          testAttempts: attempts,
          testSummary: summary,
        },
        plannerChat,
      );
      runAfterChatRelease(endedTestChat.id, () =>
        runTaskChatNudge(group, fresh.id, plannerChat, summary, {
          chatId: endedTestChat.id,
        }),
      );
      return;
    }
  }

  const report = resolveTesterPhaseReport(fresh);
  if (report?.outcome === 'pass') {
    updateTask(
      group,
      fresh.id,
      { testVerdict: 'pass', testSummary: report.summary },
      plannerChat,
    );
  }

  // Context-window overflow on the Tester is transient — retry testing without
  // burning a test attempt or reseeding the Builder. Defer one microtask so
  // finalizeRun can populate run.errorMessage before we scan the transcript.
  if (!report && endedTestChat && resolveTaskChatStreamOutcome(endedTestChat) === 'failed') {
    await Promise.resolve();
    const retestChat = testChatId ? findChatById(testChatId) : endedTestChat;
    if (
      retestChat &&
      isTransientContextLengthError(extractChatFailureText(retestChat)) &&
      isBoardRunning(group)
    ) {
      void startTaskTesting(group, fresh.id, plannerChat).catch((err) =>
        reportBackgroundError('retry-tester-context-length', err),
      );
      return;
    }
  }

  // No report and no VERDICT marker: re-prompt the Tester before recording a
  // fail. Without this the missing tool call is routed as a test failure, which
  // burns a test attempt and reseeds the Builder for work that may well be sound.
  if (!report && endedTestChat && tryNudgeForMissingBoardReport(group, fresh, plannerChat, endedTestChat)) {
    return;
  }

  const outcome = report?.outcome;
  const summary = report?.summary?.trim() || 'Tester did not report a verdict';
  const attemptNum = fresh.testAttempts ?? 0;
  logTestVerdict(
    group,
    fresh.id,
    outcome === 'pass' ? 'pass' : 'fail',
    summary,
    outcome !== 'pass' ? attemptNum || undefined : undefined,
  );

  if (outcome === 'pass') {
    await completeTaskAfterVerificationPass(group, fresh, plannerChat);
    return;
  }

  // Test failed or env_blocked: route through self-heal with the Tester chat for classification.
  const testerChatObj = fresh.testChatId ? findChatById(fresh.testChatId) : null;
  const category =
    outcome === 'env_blocked'
      ? 'infra'
      : testerChatObj
        ? classifyTaskFailure(testerChatObj, outcome, fresh)
        : 'code';
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

/** When every task is terminal, start final test or surface all-quarantined plan-complete. */
export function syncBoardRunCompletion(group: ChatGroup, plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board || !isOrchestratePlanComplete(board)) {
    if (board) board.terminalBlocked = false;
    return;
  }
  const completeCount = board.tasks.filter((t) => t.status === 'complete').length;
  const quarantinedCount = board.tasks.filter((t) => t.status === 'quarantined').length;
  board.terminalBlocked = completeCount === 0 && quarantinedCount > 0;
  if (isBoardReadyForFinalTest(board)) {
    tryTriggerFinalIntegrationTest(group, plannerChat);
  } else {
    void maybeEmitOrchestratePlanComplete(group.id);
  }
}

/** Deliver quarantine reports and sync board completion after BFS quarantine. */
export function onTasksQuarantined(
  group: ChatGroup,
  taskIds: string[],
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;

  // AFK: immediately requeue root quarantines instead of parking until the finish report.
  if (getBoardExecutionMode(board) === 'afk' && isBoardRunning(group)) {
    const rootIds = taskIds.filter((id) => {
      const task = board.tasks.find((t) => t.id === id);
      if (!task || task.status !== 'quarantined') return false;
      return !task.quarantine?.summary?.startsWith('blocked by quarantined');
    });
    if (rootIds.length > 0) {
      void (async () => {
        for (const id of rootIds) {
          await requeueBoardTask(group, id, plannerChat);
        }
        await autoDelegateNext(group, plannerChat);
      })().catch((err) => reportBackgroundError('afk-quarantine-requeue', err));
      return;
    }
  }

  if (isBoardRunning(group)) {
    for (const taskId of taskIds) {
      const task = board.tasks.find((t) => t.id === taskId);
      if (!task) continue;
      const reportable =
        task.status === 'complete' ||
        task.status === 'failed' ||
        task.status === 'blocked' ||
        task.status === 'quarantined';
      if (reportable) {
        void import('../agents/controller/report.ts')
          .then((mod) => mod.deliverOrchestratorTaskReport(group, plannerChat, task, task.status))
          .catch((err) => reportBackgroundError('deliver-task-report', err));
      }
    }
  }
  syncBoardRunCompletion(group, plannerChat);
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

  reserveLaunchSlot(finalChat.id, group, 'final_test');
  try {
    await refreshSidebarAfterLaunch();

    const seed = buildFinalIntegrationTestSeedMessage(group, plannerChat);

    refreshHeartbeatThresholds();
    startTaskChatSupervision(finalChat.id);

    void boardChatTurnRunner({
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

async function runFinalTestReportNudge(
  group: ChatGroup,
  plannerChat: Chat,
  chat: Chat,
): Promise<void> {
  if (isTaskChatActive(chat.id)) {
    runAfterChatRelease(chat.id, () => runFinalTestReportNudge(group, plannerChat, chat));
    return;
  }
  if (skipBackgroundBoardChatLaunch()) return;

  reserveLaunchSlot(chat.id, group, 'final_test');
  try {
    await refreshSidebarAfterLaunch();
    const nudge = [
      'Continue the final integration test where you left off.',
      'Your last turn ended without an explicit VERDICT, so the board cannot advance.',
      'Finish any remaining verification, then end with exactly `VERDICT: pass` or `VERDICT: fail`.',
    ].join(' ');
    refreshHeartbeatThresholds();
    startTaskChatSupervision(chat.id);
    void boardChatTurnRunner({
      chat,
      pushUser: true,
      rawText: nudge,
      userText: nudge,
      displayText: nudge,
      historyContent: nudge,
      skillId: null,
      validAttachments: [],
      titleSeed: 'Final integration test',
      ownsGlobalStreaming: true,
    }).catch((err) => {
      reportBackgroundError('final-test-report-nudge', err);
    }).finally(() => releaseLaunchSlotAndDrive(group, plannerChat, chat.id));
  } catch (err) {
    releaseLaunchSlotAndDrive(group, plannerChat, chat.id);
    throw err;
  }
}

/** Route full-board Tester verdict after final integration chat ends. */
export function finalizeFinalTestOnStreamEnd(
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board?.finalTest || board.finalTest.status !== 'in_progress') return;

  let report = resolveFinalBoardReport(board);
  const finalChatId = board.finalTest.chatId?.trim();
  const finalChat = finalChatId ? findChatById(finalChatId) : undefined;

  if (!report) {
    const parsed = parseTesterVerdictMarker(finalChatId);
    if (parsed) {
      board.finalTest = {
        ...board.finalTest,
        recordedVerdict: parsed.verdict,
        summary: parsed.summary,
      };
      scheduleSaveSessions();
      report = { outcome: parsed.verdict, summary: parsed.summary };
    }
  }

  if (!report && finalChat && tryNudgeForMissingFinalReport(group, plannerChat, finalChat)) {
    return;
  }

  const outcome = report?.outcome;
  const summary = report?.summary?.trim() || 'Final integration test did not report a verdict';
  const failingIds = board.finalTest.failingTaskIds ?? [];

  if (outcome === 'pass') {
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
    if (board.tasks.every((t) => t.status === 'complete')) {
      void maybeEmitOrchestratePlanComplete(group.id);
    }
    return;
  }

  if (!failingIds.length) {
    const allTasksComplete = board.tasks.every((t) => t.status === 'complete');
    if (
      allTasksComplete &&
      getBoardExecutionMode(board) === 'afk' &&
      isBoardRunning(group) &&
      attempts < resolveMaxFinalTestAttempts()
    ) {
      void startFinalIntegrationTest(group, plannerChat);
      return;
    }
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
    if (allTasksComplete) {
      void maybeEmitOrchestratePlanComplete(group.id);
    }
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
  releasePipelineHoldsForTask(group.orchestrateBoard, taskId);
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
  if (board && (status === 'complete' || status === 'quarantined')) {
    const planner = plannerChat ?? getPlannerChatForGroup(group);
    if (planner) syncBoardRunCompletion(group, planner);
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
 * Reset a quarantined, failed, or blocked task to `planned`, clear recovery payload,
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
  if (
    !task ||
    (task.status !== 'quarantined' && task.status !== 'failed' && task.status !== 'blocked')
  ) {
    return;
  }
  const requeuedIds = new Set<string>([taskId]);
  logTaskStatus(group, taskId, task.status, 'planned');
  updateTask(
    group,
    taskId,
    {
      status: 'planned',
      quarantine: undefined,
      stopRetries: undefined,
      error: undefined,
    },
    plannerChat,
  );
  if (task.status === 'quarantined') {
    const blockedByRootSummary = `blocked by quarantined ${taskId}`;
    for (const dependent of board.tasks) {
      if (dependent.id === taskId || dependent.status !== 'quarantined') continue;
      if (dependent.quarantine?.summary !== blockedByRootSummary) continue;
      requeuedIds.add(dependent.id);
      logTaskStatus(group, dependent.id, dependent.status, 'planned');
      updateTask(
        group,
        dependent.id,
        {
          status: 'planned',
          quarantine: undefined,
          stopRetries: undefined,
          error: undefined,
        },
        plannerChat,
      );
    }
  }

  delete board.completionShownAt;
  delete board.finishReport;
  delete board.wrapUpPending;
  board.terminalBlocked = false;
  if (board.unresolvedIssues?.length) {
    board.unresolvedIssues = board.unresolvedIssues.filter((issue) => !requeuedIds.has(issue.taskId));
  }

  for (const id of requeuedIds) {
    const existing = board.tasks.find((t) => t.id === id);
    updateTask(
      group,
      id,
      {
        selfHealRound: undefined,
        lastHealCategory: undefined,
        stopRetries: undefined,
        lifecycleRun: (existing?.lifecycleRun ?? 0) + 1,
        ...BOARD_REPORT_RESET_PATCH,
      },
      plannerChat,
    );
  }

  const { clearOrchestratorReportDedupeForTask } = await import('../agents/controller/report.ts');
  for (const id of requeuedIds) {
    clearOrchestratorReportDedupeForTask(id);
  }

  if (isBoardRunning(group)) {
    await autoDelegateNext(group, plannerChat);
  }
}

/** Root quarantine / failed / blocked tasks eligible for bulk requeue. */
export function listRecoverableBoardTaskRootIds(board: OrchestrateBoardState): string[] {
  return board.tasks
    .filter((task) => {
      if (task.status === 'failed' || task.status === 'blocked') return true;
      if (task.status !== 'quarantined') return false;
      return !task.quarantine?.summary?.startsWith('blocked by quarantined');
    })
    .map((t) => t.id);
}

/** Requeue every recoverable task (finish dashboard / auto-sequential restart). */
export async function requeueAllFailedBoardTasks(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<string[]> {
  const board = group.orchestrateBoard;
  if (!board) return [];
  const rootIds = listRecoverableBoardTaskRootIds(board);
  for (const id of rootIds) {
    await requeueBoardTask(group, id, plannerChat);
  }
  return rootIds;
}

/**
 * Requeue failed work, reset final-test gating, return to the kanban, and resume auto run.
 */
export async function restartBoardAfterRequeueFailures(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  await requeueAllFailedBoardTasks(group, plannerChat);
  const allTasksComplete =
    board.tasks.length > 0 && board.tasks.every((t) => t.status === 'complete');
  const failingIds = board.finalTest?.failingTaskIds ?? [];
  if (allTasksComplete && failingIds.length > 0) {
    const summary =
      board.finalTest?.summary?.trim() || 'Final integration test failed';
    for (const taskId of failingIds) {
      const task = board.tasks.find((t) => t.id === taskId);
      if (!task) continue;
      applyFinalTestFailureReopens(group, plannerChat, [taskId], summary);
      const seed = buildRetryBuilderSeedMessage(task, 1, `Final integration test: ${summary}`);
      updateTask(group, taskId, { pendingBuildSeed: seed }, plannerChat);
    }
  }
  if (board.finalTest) {
    const chatId = board.finalTest.chatId;
    const attempts = board.finalTest.attempts;
    board.finalTest = {
      ...(chatId ? { chatId } : {}),
      ...(attempts != null ? { attempts } : {}),
      status: 'pending',
      recordedVerdict: undefined,
      summary: undefined,
      failingTaskIds: undefined,
    };
  }
  board.dashboardDismissed = true;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
  if (!isBoardAutoMode(group)) return;
  startBoardAutoRun(group, plannerChat);
  if (allTasksComplete && board.tasks.every((t) => t.status === 'complete')) {
    await startFinalIntegrationTest(group, plannerChat);
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
  // Sequential → AFK must not silently lift the one-at-a-time cap. Sequential
  // disables the concurrency stepper (ui/orchestrate-board.ts), so the user
  // never had a chance to pick a value; pin it to 1 and let them raise it in AFK.
  if (mode === 'afk' && prevMode === 'sequential' && board.maxConcurrentTasks === undefined) {
    board.maxConcurrentTasks = 1;
  }
  if (mode !== 'afk') delete board.pendingAfk;
  if (mode === 'manual') board.autoRunning = false;
  board.lastUpdatedAt = Date.now();
  // Flush stop state immediately so reload cannot resurrect auto execution.
  if (mode === 'manual') {
    saveSessionsNow(group);
  } else {
    scheduleSaveSessions(group);
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

/** Set the model used for this board (planner + linked task chats). */
export function setBoardModel(
  group: ChatGroup,
  providerId: string,
  modelId: string,
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const pid = providerId.trim();
  const mid = modelId.trim();
  if (!pid || !mid) return;
  if (
    board.modelProviderId === pid &&
    board.modelId === mid &&
    plannerChat.providerId?.trim() === pid &&
    plannerChat.modelId?.trim() === mid
  ) {
    return;
  }

  board.modelProviderId = pid;
  board.modelId = mid;
  plannerChat.providerId = pid;
  plannerChat.modelId = mid;

  sanitizeBoardReasoningForModel(board, plannerChat);

  for (const task of board.tasks) {
    for (const chatId of [task.chatId, task.testChatId, task.fixerChatId]) {
      const id = chatId?.trim();
      if (!id) continue;
      const chat = findChatById(id);
      if (!chat) continue;
      chat.providerId = pid;
      chat.modelId = mid;
    }
  }

  const finalChatId = board.finalTest?.chatId?.trim();
  if (finalChatId) {
    const finalChat = findChatById(finalChatId);
    if (finalChat) {
      finalChat.providerId = pid;
      finalChat.modelId = mid;
    }
  }

  board.lastUpdatedAt = Date.now();
  touchChat(plannerChat);
  propagateBoardReasoningToChats(group, board, plannerChat);
  scheduleSaveSessions();
  emitBoardChange(group.id);
}

/** Set reasoning effort / thinking mode for this board (planner + linked task chats). */
export function setBoardReasoning(
  group: ChatGroup,
  plannerChat: Chat,
  patch: BoardReasoningPatch,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;

  applyBoardReasoningPatch(board, patch);
  sanitizeBoardReasoningForModel(board, plannerChat);
  board.lastUpdatedAt = Date.now();
  propagateBoardReasoningToChats(group, board, plannerChat);
  touchChat(plannerChat);
  scheduleSaveSessions();
  emitBoardChange(group.id);
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
 * Live safety net for tasks stuck in `merging`: supervise an active fixer chat
 * or re-run finalize when the fixer died without stream-end.
 */
export async function reconcileMergingTasks(
  group: ChatGroup,
  plannerChat: Chat,
  options?: { isFixerChatActive?: (fixerChatId: string) => boolean },
): Promise<void> {
  if (reconcileMergingTasksCallsForTests !== null) {
    reconcileMergingTasksCallsForTests += 1;
  }
  const board = group.orchestrateBoard;
  if (!board) return;
  for (const taskId of sweepExpiredPipelineHolds(board)) {
    reportBackgroundError(
      'pipeline-hold-expired',
      new Error(`Pipeline hold expired for task ${taskId}`),
    );
  }
  const isFixerActive = options?.isFixerChatActive ?? isTaskChatActive;
  const pending: Promise<void>[] = [];
  for (const task of board.tasks) {
    if (task.status !== 'merging') continue;
    const fixerId = task.fixerChatId?.trim();
    if (fixerId && isFixerActive(fixerId)) {
      startTaskChatSupervision(fixerId);
      continue;
    }
    pending.push(
      finalizeMergeFixerOnStreamEnd(group, task, plannerChat).catch((err) => {
        reportBackgroundError('reconcile-merging-task', err);
      }),
    );
  }
  await Promise.all(pending);
  if (isBoardRunning(group)) {
    await drainTaskQueue(group, plannerChat);
  }
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
  await reconcileMergingTasks(group, plannerChat, {
    isFixerChatActive: (id) => shouldSuperviseBoardChatOnReload(id),
  });
}

/** Begin auto/sequential execution — set running flag then kick off delegation. */
export function startBoardAutoRun(group: ChatGroup, plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board || !isBoardAutoMode(group)) return;
  const wasRunning = board.autoRunning === true;
  void clearOomPauseFromElectron();
  board.autoRunning = true;
  // Clear any prior Stop or system pause so the timer resumes and badges clear.
  board.userStopped = false;
  board.systemPaused = false;
  board.lastUpdatedAt = Date.now();
  logAutoStart(group);
  scheduleSaveSessions();
  emitBoardChange(group.id);
  if (!wasRunning) onBoardAutoRunStarted();
  void autoDelegateNext(group, plannerChat).catch((err) =>
    reportBackgroundError('auto-delegate-next', err),
  );
}

export type StopBoardAutoRunOptions = {
  /** User Stop (default) vs shutdown/OOM system pause. */
  reason?: 'user' | 'system';
};

/** Stop all active task chats and clear the task queue. */
export function stopBoardAutoRun(
  group: ChatGroup,
  plannerChat: Chat,
  options: StopBoardAutoRunOptions = {},
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const wasRunning = board.autoRunning === true;
  const reason = options.reason ?? 'user';
  board.autoRunning = false;
  if (reason === 'system') {
    // Shutdown/OOM: pause without user-stop quarantine on stream-end.
    board.systemPaused = true;
    board.userStopped = false;
  } else {
    // Freeze the header timer and surface the Stopped badge immediately, even if
    // task statuses lag behind the aborted streams (MIN-248).
    board.userStopped = true;
    board.systemPaused = false;
  }
  board.lastUpdatedAt = Date.now();
  logAutoStop(group);
  taskQueueByGroupId.delete(group.id);
  releaseAllPipelineHolds(board);
  for (const task of board.tasks) {
    if (task.chatId) {
      stopTaskChatSupervision(task.chatId);
      stopGeneration(task.chatId, reason);
    }
    if (task.testChatId) {
      stopTaskChatSupervision(task.testChatId);
      stopGeneration(task.testChatId, reason);
    }
    if (task.fixerChatId) {
      stopTaskChatSupervision(task.fixerChatId);
      stopGeneration(task.fixerChatId, reason);
    }
  }
  if (board.finalTest?.chatId) {
    stopTaskChatSupervision(board.finalTest.chatId);
    stopGeneration(board.finalTest.chatId, reason);
  }
  stopGeneration(plannerChat.id, reason);
  // Freeze the header timer now (close the open segment) instead of waiting for
  // the next live tick, so the elapsed value stops the instant Stop is pressed.
  syncOrchestrateBoardTimer(group, plannerChat, {
    isStreaming: false,
    activeRunCount: 0,
    userStopped: reason === 'user',
  });
  // Cancel any sub-agent runs still attributed to the planner's active parent
  // turn so background runs/heartbeats do not linger after Stop (MIN-246).
  if (board.activeParentTurnId) {
    void import('../agents/controller/controller.ts')
      .then((mod) => mod.cancelAllForParentTurn(board.activeParentTurnId!))
      .catch((err) => reportBackgroundError('stop-board-cancel-runs', err));
  }
  // Flush stop state immediately so reload cannot resurrect auto execution.
  saveSessionsNow(group);
  emitBoardChange(group.id);
  if (wasRunning) onBoardAutoRunStopped();
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
    stopBoardAutoRun(group, planner, { reason: 'system' });
  }
}

export type AutoDelegateNextOptions = {
  /**
   * When false, only launch newly-ready planned tasks (and drain the queue).
   * Wake reconcile sets this false so a fresh launch reservation is not mistaken
   * for a leaked slot before streaming/turn-setup begins.
   */
  allowStalledRestart?: boolean;
};

/** Start all ready planned tasks up to the concurrency cap (auto-pilot / sequential). */
export async function autoDelegateNext(
  group: ChatGroup,
  plannerChat: Chat,
  options: AutoDelegateNextOptions = {},
): Promise<void> {
  ensureStreamEndSubscription();
  ensureAutoDriveSubscription();
  await reconcileMergingTasks(group, plannerChat);
  const board = group.orchestrateBoard;
  if (!board || !isBoardRunning(group)) return;

  const allowStalledRestart = options.allowStalledRestart !== false;
  const waveOrder = new Map(board.waves.map((w, i) => [String(w.id), i]));
  const ready = board.tasks
    .filter(
      (t) =>
        isTaskReadyForAuto(board, t) ||
        (allowStalledRestart &&
          isTaskStalledForRestart(board, t, isTaskChatActiveForStallCheck)),
    )
    .sort((a, b) => {
      const wa = waveOrder.get(String(a.wave)) ?? 999;
      const wb = waveOrder.get(String(b.wave)) ?? 999;
      if (wa !== wb) return wa - wb;
      return board.tasks.indexOf(a) - board.tasks.indexOf(b);
    });
  for (const task of ready) {
    if (!canLaunchBoardTask(board, task)) {
      enqueueTask(group.id, task.id);
      continue;
    }
    await resumeBoardTask(group, task.id, plannerChat);
  }
  await drainTaskQueue(group, plannerChat);
}

function isBoardCandidateForWakeReconcile(group: ChatGroup): boolean {
  const board = group.orchestrateBoard;
  if (!board || !isBoardAutoMode(group)) return false;
  if (isBoardRunning(group)) return true;
  return (
    board.systemPaused === true &&
    board.userStopped !== true &&
    hasIncompleteOrchestrateWork(board)
  );
}

/** Restore auto-run after sleep/lock system pause (not user Stop). */
function resumeSystemPausedBoardAfterWake(group: ChatGroup, plannerChat: Chat): void {
  const board = group.orchestrateBoard;
  if (!board?.systemPaused || board.userStopped === true) return;
  if (!hasIncompleteOrchestrateWork(board)) return;
  if (isUserStoppedChat(plannerChat)) return;
  const wasRunning = board.autoRunning === true;
  board.autoRunning = true;
  board.systemPaused = false;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  if (!wasRunning) onBoardAutoRunStarted();
}

/**
 * Clear leaked streaming / launch flags when the task chat transcript already ended
 * (common after macOS display sleep throttling).
 */
function reconcileStaleBoardTaskChatActivity(chatId: string): boolean {
  const trimmed = chatId.trim();
  if (!trimmed) return false;
  const chat = findChatById(trimmed);

  if (isTaskChatActiveForStallCheck(trimmed)) {
    if (!chat) return false;
    const outcome = resolveTaskChatStreamOutcome(chat);
    if (outcome !== 'completed' && outcome !== 'stopped') return false;
    if (
      isLaunchReserved(trimmed) &&
      !isChatStreaming(trimmed) &&
      !isChatTurnSetupPending(trimmed)
    ) {
      releaseLaunchSlot(trimmed);
    }
    if (isChatTurnSetupPending(trimmed)) {
      endChatTurnSetup(trimmed);
    }
    if (isChatStreaming(trimmed)) {
      // Do not notifyChatStreamEnded here — wake finalizers replay once below.
      // Stream-end subscribers also drain the queue and can race autoDelegateNext.
      setStreaming(false, trimmed);
    }
  }

  return !isTaskChatActiveForStallCheck(trimmed);
}

function boardTimerContextForWake(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
  plannerChat: Chat,
): OrchestrateBoardTimerContext {
  return {
    isStreaming: isChatStreaming(plannerChat.id),
    activeRunCount: 0,
    userStopped: board.userStopped === true,
  };
}

async function reconcileBoardTasksAfterWake(group: ChatGroup, planner: Chat): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;

  for (const task of board.tasks) {
    if (task.status === 'in_progress') {
      const chatId = task.chatId?.trim();
      if (chatId && reconcileStaleBoardTaskChatActivity(chatId)) {
        finalizeBoardTaskOnStreamEnd(group, task, planner);
      }
      continue;
    }
    if (task.status === 'testing') {
      const testId = task.testChatId?.trim();
      if (testId && reconcileStaleBoardTaskChatActivity(testId)) {
        await finalizeTaskTestingOnStreamEnd(group, task, planner).catch((err) =>
          reportBackgroundError('wake-finalize-task-testing', err),
        );
      }
    }
  }

  const finalChatId = board.finalTest?.chatId?.trim();
  if (board.finalTest?.status === 'in_progress' && finalChatId) {
    if (reconcileStaleBoardTaskChatActivity(finalChatId)) {
      finalizeFinalTestOnStreamEnd(group, planner);
    }
  }
}

/**
 * After display wake / tab focus, replay stream-end finalizers for task chats that
 * finished while the renderer was throttled (macOS display sleep).
 */
export type DisplayWakeReconcileOptions = {
  allowStalledRestart?: boolean;
};

export async function reconcileRunningBoardsAfterDisplayWake(
  options: DisplayWakeReconcileOptions = {},
): Promise<void> {
  if (!sessionState?.groups?.length) return;
  ensureStreamEndSubscription();
  const allowStalledRestart = options.allowStalledRestart === true;
  for (const group of sessionState.groups) {
    if (!isBoardCandidateForWakeReconcile(group)) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;

    resumeSystemPausedBoardAfterWake(group, planner);
    await reconcileBoardTasksAfterWake(group, planner);

    await reconcileMergingTasks(group, planner, {
      isFixerChatActive: isTaskChatActiveForStallCheck,
    });
    if (isBoardRunning(group)) {
      await autoDelegateNext(group, planner, { allowStalledRestart });
    }
    syncOrchestrateBoardTimer(group, planner, boardTimerContextForWake(group.orchestrateBoard!, planner));
    emitBoardChange(group.id);
  }
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
  const collapsed = wave.collapsed === true;
  wave.collapsed = !collapsed;
  if (collapsed) {
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
    if (!canLaunchBoardTask(board, task)) {
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

export function isLaunchReservedForTests(chatId: string): boolean {
  return isLaunchReserved(chatId);
}

export function enqueueTaskForTests(groupId: string, taskId: string): void {
  enqueueTask(groupId, taskId);
}

export function enqueueTaskAtFrontForTests(groupId: string, taskId: string): void {
  enqueueTaskAtFront(groupId, taskId);
}

export function getTaskQueueForTests(groupId: string): string[] {
  return [...(taskQueueByGroupId.get(groupId) ?? [])];
}

export function clearTaskQueuesForTests(): void {
  taskQueueByGroupId.clear();
  drainInFlightByGroupId.clear();
}

/** When set, records task ids passed to resumeBoardTask from drainTaskQueue. */
let drainResumeCallsForTests: string[] | null = null;

/** When non-null, counts reconcileMergingTasks invocations (test spy). */
let reconcileMergingTasksCallsForTests: number | null = null;

export function trackReconcileMergingTasksCallsForTests(enabled: boolean): number {
  if (enabled) {
    reconcileMergingTasksCallsForTests = 0;
    return 0;
  }
  const count = reconcileMergingTasksCallsForTests ?? 0;
  reconcileMergingTasksCallsForTests = null;
  return count;
}

export function trackDrainResumeCallsForTests(enabled: boolean): string[] {
  if (enabled) {
    drainResumeCallsForTests = [];
    return drainResumeCallsForTests;
  }
  const captured = drainResumeCallsForTests ?? [];
  drainResumeCallsForTests = null;
  return captured;
}

/** Test-only: run integration merge on the per-board queue (waits for fixers). */
export async function enqueueMergeCompletedTaskWorktreeForTests(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): Promise<MergeTaskWorktreeResult> {
  return enqueueMergeCompletedTaskWorktree(group, task, plannerChat);
}

export async function drainTaskQueueForTests(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  return drainTaskQueue(group, plannerChat);
}

export { setPipelineHoldMaxMsForTests };

export function getPipelineHoldsForTests(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): ReturnType<typeof listPipelineHolds> {
  return listPipelineHolds(board);
}

export function acquirePipelineHoldForTests(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
  taskId: string,
  reason: Parameters<typeof acquirePipelineHold>[2],
): ReturnType<typeof acquirePipelineHold> {
  return acquirePipelineHold(board, taskId, reason);
}

export function releasePipelineHoldsForTaskForTests(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
  taskId: string,
): number {
  return releasePipelineHoldsForTask(board, taskId);
}

export function startTaskChatSupervisionForTests(chatId: string): void {
  startTaskChatSupervision(chatId);
}

export function clearTaskChatStallRestartsForTests(): void {
  taskChatStallRestarts.clear();
  stallStopReasons.clear();
  stallRecoveryScheduled.clear();
  pendingChatContinuations.clear();
}

export function getTaskChatStallRestartCountForTests(chatId: string): number {
  return taskChatStallRestarts.get(chatId) ?? 0;
}

export function clearMissingReportNudgesForTests(): void {
  missingReportNudges.clear();
}

export function getMissingReportNudgeCountForTests(chatId: string): number {
  return missingReportNudges.get(chatId) ?? 0;
}

/** Enable/disable capture of stall-path nudge and self-heal calls from heartbeat ticks. */
export function trackTaskChatStallRecoveryCallsForTests(enabled: boolean): {
  nudges: string[];
  nudgeChatIds: string[];
  selfHeals: string[];
} {
  if (enabled) {
    taskChatNudgeCallsForTests = [];
    taskChatNudgeChatIdsForTests = [];
    stallSelfHealCallsForTests = [];
    return {
      nudges: taskChatNudgeCallsForTests,
      nudgeChatIds: taskChatNudgeChatIdsForTests,
      selfHeals: stallSelfHealCallsForTests,
    };
  }
  const nudges = taskChatNudgeCallsForTests ?? [];
  const nudgeChatIds = taskChatNudgeChatIdsForTests ?? [];
  const selfHeals = stallSelfHealCallsForTests ?? [];
  taskChatNudgeCallsForTests = null;
  taskChatNudgeChatIdsForTests = null;
  stallSelfHealCallsForTests = null;
  return { nudges, nudgeChatIds, selfHeals };
}

/** Test-only: simulate fixer stream-end (optionally inject board_report first). */
export async function triggerFixerStallReconcileForTests(
  group: ChatGroup,
  plannerChat: Chat,
  taskId: string,
  options?: { boardReport?: BoardReport },
): Promise<void> {
  ensureStreamEndSubscription();
  const task = group.orchestrateBoard?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const chatId = task.fixerChatId?.trim();
  if (!chatId) return;
  if (options?.boardReport) {
    updateTask(group, taskId, { boardReport: options.boardReport }, plannerChat);
  }
  notifyChatStreamEnded(chatId);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await awaitInFlightChatContinuations();
}

/** Test-only: invoke merge-fixer finalize directly (re-entrancy / idempotency tests). */
export async function finalizeMergeFixerOnStreamEndForTests(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  endedChatId?: string,
): Promise<void> {
  return finalizeMergeFixerOnStreamEnd(group, task, plannerChat, endedChatId);
}

/** Test-only: invoke env-fixer finalize directly (stopped-outcome / orphan tests). */
export async function finalizeEnvFixerOnStreamEndForTests(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  endedChatId?: string,
): Promise<void> {
  return finalizeEnvFixerOnStreamEnd(group, task, plannerChat, endedChatId);
}

/** Test-only: route a rejected task-chat launch through self-heal recovery. */
export function handleTaskChatLaunchFailureForTests(
  group: ChatGroup,
  plannerChat: Chat,
  taskId: string,
  phase: 'build' | 'test' | 'merge',
  kind: 'build' | 'test' | 'nudge' | 'env-fixer' | 'merge-fixer',
  message: string,
): void {
  handleTaskChatLaunchFailure(group, plannerChat, taskId, phase, kind, message);
}

/** Enable/disable capture of heartbeat fixer stall-stops (kill without nudge). */
export function trackFixerStallStopsForTests(
  enabled: boolean,
): { taskId: string; chatId: string }[] {
  if (enabled) {
    fixerStallStopsForTests = [];
    return fixerStallStopsForTests;
  }
  const captured = fixerStallStopsForTests ?? [];
  fixerStallStopsForTests = null;
  return captured;
}

/** Test-only: was this chat's turn killed by the stall heartbeat (pending stream-end)? */
export function isStallStoppedChatForTests(chatId: string): boolean {
  return stallStoppedChatIds.has(chatId);
}

export function clearStallStoppedChatIdsForTests(): void {
  stallStoppedChatIds.clear();
}

/** Test-only: flush deferred board-chat continuations after streaming is cleared. */
export async function flushBoardChatContinuationsForTests(chatId?: string): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  if (chatId) {
    flushChatContinuationIfIdle(chatId);
  } else {
    for (const id of [...pendingChatContinuations.keys()]) {
      flushChatContinuationIfIdle(id);
    }
  }
  await awaitInFlightChatContinuations();
}

/** Test-only: wait for queued + in-flight `runAfterChatRelease` work before teardown. */
export async function awaitBoardChatContinuationsForTests(): Promise<void> {
  await awaitInFlightChatContinuations();
}

/** Test-only: build merge-fixer seed with optional retry context. */
export function buildMergeFixerSeedMessageForTests(
  task: BoardTask,
  conflictedFiles: string[],
  seedOptions?: {
    verifyFailureSummary?: string;
    attemptNumber?: number;
    maxAttempts?: number;
  },
): string {
  return buildMergeFixerSeedMessage(task, conflictedFiles, seedOptions);
}

/** Test-only: simulate stream-end when fixerChatId was already cleared before delivery. */
export async function simulateUnmatchedFixerStreamEndForTests(
  group: ChatGroup,
  plannerChat: Chat,
  endedChatId: string,
): Promise<void> {
  ensureStreamEndSubscription();
  notifyChatStreamEnded(endedChatId);
  // Tester finalize is async; give it a turn before flushing recovery.
  await new Promise((resolve) => setTimeout(resolve, 50));
  flushChatContinuationIfIdle(endedChatId);
  await awaitInFlightChatContinuations();
}
