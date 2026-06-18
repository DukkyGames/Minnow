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
import { loadSubAgentConfig } from '../agents/sub-agent-config.ts';
import {
  bindRunSupervision,
  bumpProgress,
  chatTaskRunId,
  createRunSupervision,
  setHeartbeatConfig,
  startHeartbeat,
  stopHeartbeat,
} from '../agents/controller/wrapper.ts';
import { runChatTurn } from '../tools/loop.ts';
import { normalizeVerdict } from '../tools/board-tools.ts';
import type { BoardTask, BoardTaskStatus, Chat, ChatGroup, OrchestrateBoardState } from '../types.ts';
import {
  assignChatToGroup,
  getBoardGroupForChat,
  getOrCreateBoardGroup,
  getPlannerChatForGroup,
} from './chat-groups.ts';
import { emitBoardChange } from './orchestrate-board-events.ts';
import { isTaskReadyForAuto, isTaskStalledForRestart, isBoardAutoMode, getBoardExecutionMode, updateTask } from './orchestrate-board-store.ts';

export { getBoardExecutionMode, isBoardAutoMode };
import {
  createEmptyChatObject,
  findChatById,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from './sessions.ts';

function requireSession(): NonNullable<typeof sessionState> {
  if (!sessionState) throw new Error('Session not loaded');
  return sessionState;
}

const DEFAULT_MAX_CONCURRENT = 3;
const MAX_TASK_TEST_ATTEMPTS = 3;
const MAX_FINAL_TEST_ATTEMPTS = 3;
const FULL_BOARD_TEST_ID = 'FULL_BOARD';

/** Per-board folder id → queued task ids waiting for a concurrency slot. */
const taskQueueByGroupId = new Map<string, string[]>();

let streamEndSubscribed = false;
let streamActivitySubscribed = false;
let autoDriveSubscribed = false;

async function refreshHeartbeatThresholds(): Promise<void> {
  const config = await loadSubAgentConfig();
  setHeartbeatConfig({
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    progressStallMs: config.progressStallMs,
    heartbeatDeadMs: config.heartbeatDeadMs,
  });
}

function stopTaskChatSupervision(chatId: string): void {
  stopHeartbeat(chatTaskRunId(chatId));
}

/** How a linked task chat ended its latest assistant turn. */
export type TaskChatStreamOutcome = 'completed' | 'stopped' | 'failed';

/** Infer stream outcome from the task chat transcript (last assistant turn). */
export function resolveTaskChatStreamOutcome(chat: Chat): TaskChatStreamOutcome {
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
    updateTask(group, task.id, { endedAt: Date.now() }, plannerChat);
    return;
  }

  if (outcome === 'failed') {
    moveTaskStatus(group, task.id, 'failed', plannerChat);
    updateTask(
      group,
      task.id,
      {
        endedAt: Date.now(),
        error: 'Task chat ended without completing successfully',
      },
      plannerChat,
    );
    return;
  }

  updateTask(
    group,
    task.id,
    { endedAt: Date.now(), error: undefined, testVerdict: undefined, testSummary: undefined },
    plannerChat,
  );
  moveTaskStatus(group, task.id, 'testing', plannerChat);
  if (isBoardAutoMode(group)) {
    void startTaskTesting(group, task.id, plannerChat);
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
  });
}

function isTaskChatStreaming(chatId: string): boolean {
  return isChatStreaming(chatId) || isChatTurnSetupPending(chatId);
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
  return { providerId, modelId };
}

/** Keep task/test/final chats aligned with the planner model before launching a turn. */
function syncTaskChatModelFromPlanner(taskChat: Chat, plannerChat: Chat): void {
  const binding = resolvePlannerModelBinding(plannerChat);
  if (binding.providerId) taskChat.providerId = binding.providerId;
  if (binding.modelId) taskChat.modelId = binding.modelId;
}

function ensureStreamEndSubscription(): void {
  if (!streamEndSubscribed) {
    streamEndSubscribed = true;
    subscribeChatStreamEnd((endedChatId) => {
      stopTaskChatSupervision(endedChatId);
      if (!sessionState) return;
      for (const group of sessionState.groups ?? []) {
        const board = group.orchestrateBoard;
        if (!board) continue;
        const planner = getPlannerChatForGroup(group);
        if (!planner) continue;

        const finalChatId = board.finalTest?.chatId?.trim();
        if (finalChatId && endedChatId === finalChatId) {
          finalizeFinalTestOnStreamEnd(group, planner);
          void drainTaskQueue(group, planner);
          continue;
        }

        const taskByBuild = board.tasks.find((t) => t.chatId === endedChatId);
        if (taskByBuild) {
          finalizeBoardTaskOnStreamEnd(group, taskByBuild, planner);
          void drainTaskQueue(group, planner);
          continue;
        }

        const taskByTest = board.tasks.find((t) => t.testChatId === endedChatId);
        if (taskByTest) {
          finalizeTaskTestingOnStreamEnd(group, taskByTest, planner);
          void drainTaskQueue(group, planner);
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

function maxConcurrent(board: NonNullable<ChatGroup['orchestrateBoard']>): number {
  const n = board.maxConcurrentTasks;
  return typeof n === 'number' && n > 0 ? n : DEFAULT_MAX_CONCURRENT;
}

/** Skip launching background chat turns under node:test (avoids open handles). */
function skipBackgroundBoardChatLaunch(): boolean {
  return (
    typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.MINNOW_TEST === '1'
  );
}

/** Running task / tester / final-integration chats occupying a concurrency slot. */
export function countRunningTaskChats(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): number {
  const seen = new Set<string>();
  let n = 0;
  const countActive = (raw?: string): void => {
    const id = raw?.trim();
    if (!id || seen.has(id)) return;
    if (isTaskChatStreaming(id)) {
      seen.add(id);
      n += 1;
    }
  };
  for (const task of board.tasks) {
    countActive(task.chatId);
    countActive(task.testChatId);
  }
  countActive(board.finalTest?.chatId);
  return n;
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
  return [
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
  ].join('\n');
}

/** Compact Builder seed after a per-task test failure (fresh chat, no history bloat). */
export function buildRetryBuilderSeedMessage(task: BoardTask, attempt: number, testSummary: string): string {
  const build = task.buildSpec?.trim() || '(see plan)';
  return [
    'Fix this orchestrate task after a failed test.',
    '',
    `Task: ${task.id} — ${task.title}`,
    '',
    'Build:',
    build,
    '',
    `Previous attempt failed testing (${attempt}/${MAX_TASK_TEST_ATTEMPTS}): ${testSummary}`,
    '',
    'Fix the issues and report what you changed.',
  ].join('\n');
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

async function drainTaskQueue(group: ChatGroup, plannerChat: Chat): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board) return;
  const queue = taskQueueByGroupId.get(group.id);
  if (!queue?.length) return;
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

/** Start a linked task chat (background stream; does not switch active chat). */
export async function startTask(
  group: ChatGroup,
  taskId: string,
  plannerChat: Chat,
  options?: { seedOverride?: string },
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

  const folderId = group.id;

  let taskChat: Chat;
  const forceNewChat = Boolean(options?.seedOverride?.trim());
  const existingId = forceNewChat ? '' : task.chatId?.trim();
  if (existingId) {
    const existing = findChatById(existingId);
    if (existing) {
      taskChat = existing;
      taskChat.boardTaskId = task.id;
      syncTaskChatModelFromPlanner(taskChat, plannerChat);
    } else {
      taskChat = createEmptyChatObject(modelId, plannerChat.workspacePath);
      taskChat.providerId = providerId;
      taskChat.modeId = 'build';
      taskChat.workAgentId = null;
      taskChat.name = `Task ${task.id}: ${task.title}`;
      taskChat.groupId = folderId;
      taskChat.boardGroupId = folderId;
      taskChat.boardTaskId = task.id;
      requireSession().chats.unshift(taskChat);
      updateTask(group, taskId, { chatId: taskChat.id }, plannerChat);
      assignChatToGroup(taskChat.id, folderId);
    }
  } else {
    taskChat = createEmptyChatObject(modelId, plannerChat.workspacePath);
    taskChat.providerId = providerId;
    taskChat.modeId = 'build';
    taskChat.workAgentId = null;
    taskChat.name = `Task ${task.id}: ${task.title}`;
    taskChat.groupId = folderId;
    taskChat.boardGroupId = folderId;
    taskChat.boardTaskId = task.id;
    requireSession().chats.unshift(taskChat);
    updateTask(group, taskId, { chatId: taskChat.id }, plannerChat);
    assignChatToGroup(taskChat.id, folderId);
  }

  const { renderSidebar } = await import('../ui/sidebar.ts');
  renderSidebar();

  const seed = options?.seedOverride?.trim() || buildTaskSeedMessage(group, plannerChat, task);

  void refreshHeartbeatThresholds().then(() => {
    startTaskChatSupervision(taskChat.id);
  });

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
  });
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

  const folderId = group.id;

  let testChat: Chat;
  const existingId = task.testChatId?.trim();
  if (existingId) {
    const existing = findChatById(existingId);
    if (existing) {
      testChat = existing;
      testChat.boardTaskId = task.id;
      testChat.workAgentId = 'tester';
      syncTaskChatModelFromPlanner(testChat, plannerChat);
    } else {
      testChat = createEmptyChatObject(modelId, plannerChat.workspacePath);
      testChat.providerId = providerId;
      testChat.modeId = 'build';
      testChat.workAgentId = 'tester';
      testChat.name = `Test ${task.id}: ${task.title}`;
      testChat.groupId = folderId;
      testChat.boardGroupId = folderId;
      testChat.boardTaskId = task.id;
      requireSession().chats.unshift(testChat);
      updateTask(group, taskId, { testChatId: testChat.id }, plannerChat);
      assignChatToGroup(testChat.id, folderId);
    }
  } else {
    testChat = createEmptyChatObject(modelId, plannerChat.workspacePath);
    testChat.providerId = providerId;
    testChat.modeId = 'build';
    testChat.workAgentId = 'tester';
    testChat.name = `Test ${task.id}: ${task.title}`;
    testChat.groupId = folderId;
    testChat.boardGroupId = folderId;
    testChat.boardTaskId = task.id;
    requireSession().chats.unshift(testChat);
    updateTask(group, taskId, { testChatId: testChat.id }, plannerChat);
    assignChatToGroup(testChat.id, folderId);
  }

  updateTask(
    group,
    taskId,
    { testVerdict: undefined, testSummary: undefined },
    plannerChat,
  );

  const { renderSidebar } = await import('../ui/sidebar.ts');
  renderSidebar();

  const seed = buildTaskTestSeedMessage(group, plannerChat, task);

  void refreshHeartbeatThresholds().then(() => {
    startTaskChatSupervision(testChat.id);
  });

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
  });
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

  if (attempts >= MAX_TASK_TEST_ATTEMPTS) {
    moveTaskStatus(group, task.id, 'blocked', plannerChat);
    updateTask(group, task.id, { error: summary }, plannerChat);
    return 'blocked';
  }

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
export function finalizeTaskTestingOnStreamEnd(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
): void {
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

  if (verdict === 'pass') {
    updateTask(group, fresh.id, { error: undefined }, plannerChat);
    moveTaskStatus(group, fresh.id, 'complete', plannerChat);
    return;
  }

  const route = applyTaskTestFailureState(group, fresh, plannerChat, summary);
  if (route === 'retry') {
    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === fresh.id) ?? fresh;
    const seed = buildRetryBuilderSeedMessage(
      updated,
      updated.testAttempts ?? 1,
      summary,
    );
    void startTask(group, fresh.id, plannerChat, { seedOverride: seed });
  }
}

/** Start full-board final integration test (Tester with browser). */
export async function startFinalIntegrationTest(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board || !isOrchestratePlanComplete(board)) return;
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

  const folderId = group.id;

  let finalChat: Chat;
  if (existingFinalId) {
    const existing = findChatById(existingFinalId);
    if (existing) {
      finalChat = existing;
      finalChat.workAgentId = 'tester';
      syncTaskChatModelFromPlanner(finalChat, plannerChat);
    } else {
      finalChat = createEmptyChatObject(modelId, plannerChat.workspacePath);
      finalChat.providerId = providerId;
      finalChat.modeId = 'build';
      finalChat.workAgentId = 'tester';
      finalChat.name = 'Final integration test';
      finalChat.groupId = folderId;
      finalChat.boardGroupId = folderId;
      requireSession().chats.unshift(finalChat);
      assignChatToGroup(finalChat.id, folderId);
    }
  } else {
    finalChat = createEmptyChatObject(modelId, plannerChat.workspacePath);
    finalChat.providerId = providerId;
    finalChat.modeId = 'build';
    finalChat.workAgentId = 'tester';
    finalChat.name = 'Final integration test';
    finalChat.groupId = folderId;
    finalChat.boardGroupId = folderId;
    requireSession().chats.unshift(finalChat);
    assignChatToGroup(finalChat.id, folderId);
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
  scheduleSaveSessions();
  emitBoardChange(group.id);

  const { renderSidebar } = await import('../ui/sidebar.ts');
  renderSidebar();

  const seed = buildFinalIntegrationTestSeedMessage(group, plannerChat);

  void refreshHeartbeatThresholds().then(() => {
    startTaskChatSupervision(finalChat.id);
  });

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
  });
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

/** When every task is complete, start or surface the final integration test. */
export function tryTriggerFinalIntegrationTest(
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board || !isOrchestratePlanComplete(board)) return;
  if (board.finalTest?.status === 'passed') {
    void maybeEmitOrchestratePlanComplete(group.id);
    return;
  }
  if (board.finalTest?.status === 'in_progress') return;

  const attempts = board.finalTest?.attempts ?? 0;
  if (board.finalTest?.status === 'failed' && attempts >= MAX_FINAL_TEST_ATTEMPTS) {
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
    updateTask(group, taskId, { testAttempts: 0, testSummary: summary }, plannerChat);
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
    board.finalTest = { ...board.finalTest, status: 'passed' };
    board.lastUpdatedAt = Date.now();
    scheduleSaveSessions();
    emitBoardChange(group.id);
    void maybeEmitOrchestratePlanComplete(group.id);
    return;
  }

  const attempts = (board.finalTest.attempts ?? 0) + 1;
  board.finalTest = {
    ...board.finalTest,
    status: 'failed',
    attempts,
    summary,
  };
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);

  if (attempts >= MAX_FINAL_TEST_ATTEMPTS) {
    postPlannerBoardMessage(
      plannerChat,
      [
        '**Final integration test exhausted**',
        '',
        summary,
        '',
        `${attempts}/${MAX_FINAL_TEST_ATTEMPTS} rounds completed. Review failing areas manually.`,
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
    void startTask(group, taskId, plannerChat, { seedOverride: seed });
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
  await drainTaskQueue(group, plannerChat);
}

export function moveTaskStatus(
  group: ChatGroup,
  taskId: string,
  status: BoardTaskStatus,
  plannerChat?: Chat,
): void {
  const existing = group.orchestrateBoard?.tasks.find((t) => t.id === taskId);
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
  if (board && isBoardAutoMode(group) && plannerChat) {
    const reportable =
      status === 'complete' || status === 'failed' || status === 'blocked';
    if (reportable) {
      void import('../agents/controller/report.ts').then((mod) => {
        const task = board.tasks.find((t) => t.id === taskId);
        if (!task) return;
        void mod.deliverOrchestratorTaskReport(group, plannerChat, task, status);
      });
    }
  }
}

/** Persist auto/manual execution mode and kick off delegation when enabling auto. */
export function setBoardExecutionMode(
  group: ChatGroup,
  mode: 'manual' | 'auto',
  plannerChat: Chat,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  board.executionMode = mode;
  board.lastUpdatedAt = Date.now();
  scheduleSaveSessions();
  emitBoardChange(group.id);
  if (mode === 'auto') {
    void autoDelegateNext(group, plannerChat);
  }
}

/** Start all ready planned tasks up to the concurrency cap (auto-pilot). */
export async function autoDelegateNext(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  ensureStreamEndSubscription();
  ensureAutoDriveSubscription();
  const board = group.orchestrateBoard;
  if (!board || !isBoardAutoMode(group)) return;

  const ready = board.tasks.filter(
    (t) =>
      isTaskReadyForAuto(board, t) ||
      isTaskStalledForRestart(board, t, isTaskChatActive),
  );
  for (const task of ready) {
    if (countRunningTaskChats(board) >= maxConcurrent(board)) {
      enqueueTask(group.id, task.id);
      continue;
    }
    await resumeBoardTask(group, task.id, plannerChat);
  }
}

function ensureAutoDriveSubscription(): void {
  if (autoDriveSubscribed) return;
  autoDriveSubscribed = true;
  void import('../agents/controller/report.ts').then((mod) => {
    mod.initOrchestratorAutoReports();
  });
}

/** Toggle kanban visibility for a wave section in board view. */
export function toggleWaveCollapsed(group: ChatGroup, waveId: number | string): void {
  const board = group.orchestrateBoard;
  if (!board) return;
  const wave = board.waves.find((w) => String(w.id) === String(waveId));
  if (!wave) return;
  wave.collapsed = !wave.collapsed;
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
