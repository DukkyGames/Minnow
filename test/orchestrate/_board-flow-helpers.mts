/**
 * Shared fixtures and drive harness for orchestrate board lifecycle E2E tests.
 * Supplements MINNOW_TEST launch suppression by bootstrapping chats that
 * startTask / startTaskTesting would create in production.
 */

import assert from 'node:assert/strict';
import { setStreaming } from '../../src/app-state.ts';
import { isOrchestratePlanComplete } from '../../src/chat/orchestrate/plan-complete.ts';
import { notifyChatStreamEnded } from '../../src/chat/streaming-state.ts';
import {
  autoDelegateNext,
  countRunningTaskChats,
  drainTaskQueueForTests,
  isTaskChatActive,
  isTaskChatActiveForStallCheck,
  listRunningBoardTaskSlots,
  releaseLaunchSlotForTests,
  reserveLaunchSlotForTests,
  resolveBoardMaxConcurrent,
  startBoardAutoRun,
  type RunningBoardTaskSlot,
} from '../../src/state/orchestrate-board-actions.ts';
import {
  initBoard,
  isBoardRunning,
  isTaskReadyForAuto,
  isTaskStalledForRestart,
  markBoardTaskInProgressFromChat,
  setBoardNowForTests,
  updateTask,
} from '../../src/state/orchestrate-board-store.ts';
import {
  createEmptyChatObject,
  findChatById,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import type { BoardTask, Chat, ChatGroup, OrchestrateBoardState } from '../../src/types.ts';
import type { ScriptedTurnRunnerHandle } from './_scripted-turn-runner.mts';
import { injectChatOutcome } from './_scripted-turn-runner.mts';

export { injectChatOutcome } from './_scripted-turn-runner.mts';

export const FLOW_PLANNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const FLOW_GROUP_ID = 'grp_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const FLOW_PLAN_PATH = 'documentation/plans/board-flow-e2e.md';
export const FLOW_INTEGRATION_BRANCH = 'minnow/integration/grp_aaaaaaaa';
export const FLOW_FINAL_CHAT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export type BuildOutcome =
  | 'complete'
  | 'fail'
  | 'stopped'
  | 'fail-then-heal'
  | 'always-fail';

export type TaskFlowScript = {
  build?: BuildOutcome;
  test?: 'pass' | 'fail';
  merge?: 'clean' | 'conflict';
  fixer?: 'resolve' | 'fail';
};

export type BoardFlowScript = {
  tasks: Record<string, TaskFlowScript>;
  finalTest?: 'pass' | 'fail';
};

export type BoardSeedTask = {
  id: string;
  title: string;
  wave: string;
  category?: BoardTask['category'];
  build?: string;
  test?: string;
  dependsOn?: string[];
};

export type BoardSeedSpec = {
  tasks: BoardSeedTask[];
  waves: Array<{ id: string; status?: OrchestrateBoardState['waves'][0]['status'] }>;
  integrationBranch?: string;
  maxConcurrentTasks?: number;
};

/** Deterministic chat ids per task phase for reproducible harness runs. */
export function taskChatId(
  taskId: string,
  role: 'build' | 'test' | 'fixer',
): string {
  const compact = taskId.replace(/[^A-Za-z0-9]/g, '').toUpperCase().padEnd(8, 'X').slice(0, 8);
  const roleTag = { build: 'b1', test: 't1', fixer: 'f1' }[role];
  return `eeeeeeee-eeee-${roleTag}-eeee-${compact}00000000`.slice(0, 36);
}

export function makePlanner(overrides: Partial<Chat> = {}): Chat {
  return {
    id: FLOW_PLANNER_ID,
    name: 'Flow planner',
    workspacePath: '/tmp/ws',
    modeId: 'orchestrate',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    orchestratePlanPath: FLOW_PLAN_PATH,
    boardGroupId: FLOW_GROUP_ID,
    ...overrides,
  };
}

export function makeGroup(overrides: Partial<ChatGroup> = {}): ChatGroup {
  return {
    id: FLOW_GROUP_ID,
    name: 'Flow board',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    plannerChatId: FLOW_PLANNER_ID,
    orchestratePlanPath: FLOW_PLAN_PATH,
    viewMode: 'board',
    ...overrides,
  };
}

/** Build planner + group, init board store, register session, start auto-run. */
export function seedBoard(
  spec: BoardSeedSpec,
  executionMode: 'auto' | 'sequential' = 'auto',
): { planner: Chat; group: ChatGroup } {
  const planner = makePlanner();
  const group = makeGroup();
  initBoard(group, planner, {
    planPath: FLOW_PLAN_PATH,
    tasks: spec.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      wave: t.wave,
      category: t.category ?? 'build',
      build: t.build ?? `Build ${t.id}`,
      test: t.test ?? `Test ${t.id}`,
      ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}),
    })),
    waves: spec.waves.map((w) => ({
      id: w.id,
      status: w.status ?? 'planned',
    })),
  });
  const board = group.orchestrateBoard!;
  board.integrationBranch = spec.integrationBranch ?? FLOW_INTEGRATION_BRANCH;
  board.executionMode = executionMode;
  board.autoRunning = true;
  if (spec.maxConcurrentTasks !== undefined) {
    board.maxConcurrentTasks = spec.maxConcurrentTasks;
  }
  const decoyChat: Chat = {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    name: 'Decoy',
    workspacePath: '/tmp/ws',
    modeId: 'general',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
  };
  setSessionStateForTests({
    version: 5,
    activeId: decoyChat.id,
    chats: [decoyChat, planner],
    groups: [group],
  });
  startBoardAutoRun(group, planner);
  return { planner, group };
}

/**
 * Stub globalThis.fetch for /api/worktree calls. Routes by the `op` field in
 * the POST body. Returns a restore function.
 */
export function mockWorktreeOps(responses: Record<string, unknown>): () => void {
  const saved = globalThis.fetch;
  // @ts-ignore — test-only replacement
  globalThis.fetch = async (_url: unknown, opts?: { body?: unknown }) => {
    let op = '';
    try {
      op = (JSON.parse(opts?.body as string) as { op?: string }).op ?? '';
    } catch {
      /* ignore */
    }
    const payload = op in responses ? responses[op] : { ok: false, error: 'not_mocked' };
    return { ok: true, json: async () => payload };
  };
  return () => {
    globalThis.fetch = saved;
  };
}

/**
 * Like mockWorktreeOps, but listed ops block until release(op) is called.
 * Gives deterministic slow merges without production seams.
 */
export function mockWorktreeOpsGated(
  responses: Record<string, unknown>,
  gatedOps: string[],
): { restore: () => void; release: (op: string) => void } {
  const gates = new Map<string, { resolve: () => void; promise: Promise<void> }>();
  for (const op of gatedOps) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    gates.set(op, { resolve, promise });
  }
  const saved = globalThis.fetch;
  // @ts-ignore — test-only replacement
  globalThis.fetch = async (_url: unknown, opts?: { body?: unknown }) => {
    let op = '';
    try {
      op = (JSON.parse(opts?.body as string) as { op?: string }).op ?? '';
    } catch {
      /* ignore */
    }
    const gate = gates.get(op);
    if (gate) await gate.promise;
    const payload = op in responses ? responses[op] : { ok: false, error: 'not_mocked' };
    return { ok: true, json: async () => payload };
  };
  return {
    restore: () => {
      globalThis.fetch = saved;
    },
    release: (op: string) => {
      gates.get(op)?.resolve();
    },
  };
}

export function cleanMergeMocks(integrationSha = 'cafebabe'): Record<string, unknown> {
  return {
    merge: { ok: true, integrationSha },
    verify_integration: { ok: true, verified: true },
    refresh_integration_deps: { ok: true },
    ensure_integration: { ok: true, path: '/tmp/fake-integration' },
  };
}

export function conflictMergeMocks(): Record<string, unknown> {
  return {
    merge: {
      ok: false,
      conflict: true,
      conflictedFiles: ['src/conflict.ts'],
      integrationSha: 'deadbeef',
    },
    ensure_integration: { ok: true, path: '/tmp/fake-integration' },
    merge_in_progress: { ok: true, inProgress: true },
  };
}

export function fixerResolveMocks(): Record<string, unknown> {
  return {
    check_merged: { ok: true, merged: true },
    verify_integration: { ok: true, verified: true },
    refresh_integration_deps: { ok: true },
    restore_integration: { ok: true },
  };
}

export function fixerFailMocks(): Record<string, unknown> {
  return {
    check_merged: { ok: true, merged: false },
    restore_integration: { ok: true },
    merge: {
      ok: false,
      conflict: true,
      conflictedFiles: ['src/conflict.ts'],
      integrationSha: 'aabbccdd',
    },
    ensure_integration: { ok: true, path: '/tmp/fake-integration' },
    merge_in_progress: { ok: true, inProgress: true },
  };
}

function isBoardReadyForFinalTest(board: OrchestrateBoardState): boolean {
  return isOrchestratePlanComplete(board) && board.tasks.some((t) => t.status === 'complete');
}

function resolveBuildOutcome(
  taskId: string,
  script: BoardFlowScript,
  buildAttempts: Map<string, number>,
): 'complete' | 'fail' | 'stopped' {
  const spec = script.tasks[taskId]?.build ?? 'complete';
  if (spec === 'always-fail') return 'fail';
  if (spec === 'fail-then-heal') {
    const n = buildAttempts.get(taskId) ?? 0;
    return n === 0 ? 'fail' : 'complete';
  }
  return spec;
}

function worktreeMocksForSlot(
  script: BoardFlowScript,
  slot: RunningBoardTaskSlot,
): Record<string, unknown> {
  const taskScript = script.tasks[slot.taskId] ?? {};
  if (slot.phase === 'test' && (taskScript.merge ?? 'clean') === 'conflict') {
    return conflictMergeMocks();
  }
  if (slot.phase === 'fix') {
    return taskScript.fixer === 'fail' ? fixerFailMocks() : fixerResolveMocks();
  }
  if (slot.phase === 'test') {
    return cleanMergeMocks();
  }
  return cleanMergeMocks();
}

function upsertChat(chat: Chat): void {
  if (!sessionState) {
    throw new Error('sessionState not initialized; call setSessionStateForTests first');
  }
  const idx = sessionState.chats.findIndex((c) => c.id === chat.id);
  if (idx >= 0) {
    sessionState.chats[idx] = chat;
  } else {
    sessionState.chats.unshift(chat);
  }
}

function activateChatSlot(chatId: string): void {
  reserveLaunchSlotForTests(chatId);
  setStreaming(true, chatId);
}

function createBuildChat(group: ChatGroup, planner: Chat, task: BoardTask): Chat {
  const chatId = taskChatId(task.id, 'build');
  let chat = findChatById(chatId);
  if (!chat) {
    chat = createEmptyChatObject(planner.modelId ?? 'm1', group.workspacePath);
    chat.id = chatId;
    chat.modeId = 'build';
    chat.name = `Task ${task.id}: ${task.title}`;
    chat.boardGroupId = group.id;
    chat.boardTaskId = task.id;
    upsertChat(chat);
  }
  updateTask(group, task.id, { chatId }, planner);
  markBoardTaskInProgressFromChat(chat);
  activateChatSlot(chatId);
  return chat;
}

function createTesterChat(group: ChatGroup, planner: Chat, task: BoardTask): Chat {
  const chatId = taskChatId(task.id, 'test');
  let chat = findChatById(chatId);
  if (!chat) {
    chat = createEmptyChatObject(planner.modelId ?? 'm1', group.workspacePath);
    chat.id = chatId;
    chat.modeId = 'build';
    chat.workAgentId = 'tester';
    chat.name = `Test ${task.id}: ${task.title}`;
    chat.boardGroupId = group.id;
    chat.boardTaskId = task.id;
    upsertChat(chat);
  }
  updateTask(
    group,
    task.id,
    { testChatId: chatId, testVerdict: undefined, testSummary: undefined },
    planner,
  );
  activateChatSlot(chatId);
  return chat;
}

function createFinalTestChat(group: ChatGroup, planner: Chat): Chat {
  const board = group.orchestrateBoard!;
  let chat = findChatById(FLOW_FINAL_CHAT_ID);
  if (!chat) {
    chat = createEmptyChatObject(planner.modelId ?? 'm1', group.workspacePath);
    chat.id = FLOW_FINAL_CHAT_ID;
    chat.modeId = 'build';
    chat.workAgentId = 'tester';
    chat.name = 'Final integration test';
    chat.boardGroupId = group.id;
    upsertChat(chat);
  }
  board.finalTest = {
    ...(board.finalTest ?? {}),
    status: 'in_progress',
    chatId: FLOW_FINAL_CHAT_ID,
    recordedVerdict: undefined,
    failingTaskIds: undefined,
    summary: undefined,
  };
  board.lastUpdatedAt = Date.now();
  activateChatSlot(FLOW_FINAL_CHAT_ID);
  return chat;
}

/**
 * When MINNOW_TEST suppresses real chat launches, mirror autoDelegateNext's
 * picks by creating chats + occupying concurrency slots.
 */
export async function bootstrapPendingLaunches(
  group: ChatGroup,
  planner: Chat,
): Promise<void> {
  const board = group.orchestrateBoard;
  if (!board || !isBoardRunning(group)) return;

  const waveOrder = new Map(board.waves.map((w, i) => [String(w.id), i]));
  const ready = board.tasks
    .filter(
      (t) =>
        isTaskReadyForAuto(board, t) ||
        isTaskStalledForRestart(board, t, isTaskChatActiveForStallCheck),
    )
    .sort((a, b) => {
      const wa = waveOrder.get(String(a.wave)) ?? 999;
      const wb = waveOrder.get(String(b.wave)) ?? 999;
      if (wa !== wb) return wa - wb;
      return board.tasks.indexOf(a) - board.tasks.indexOf(b);
    });

  for (const task of ready) {
    if (countRunningTaskChats(board) >= resolveBoardMaxConcurrent(board)) break;
    if (task.status === 'testing') {
      const testId = task.testChatId?.trim();
      if (testId && isTaskChatActive(testId)) continue;
      createTesterChat(group, planner, task);
      continue;
    }
    if (task.status === 'planned' || task.status === 'in_progress') {
      const buildId = task.chatId?.trim();
      if (buildId && isTaskChatActive(buildId)) continue;
      createBuildChat(group, planner, task);
    }
  }

  for (const task of board.tasks) {
    if (task.status !== 'merging') continue;
    const fixerId = task.fixerChatId?.trim();
    if (!fixerId || isTaskChatActive(fixerId)) continue;
    activateChatSlot(fixerId);
  }

  if (
    isBoardReadyForFinalTest(board) &&
    board.finalTest?.status !== 'in_progress' &&
    board.finalTest?.status !== 'passed' &&
    countRunningTaskChats(board) < resolveBoardMaxConcurrent(board)
  ) {
    createFinalTestChat(group, planner);
  }
}

async function settleAsyncBoardWork(group: ChatGroup, planner: Chat): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await drainTaskQueueForTests(group, planner);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function endChatStream(
  chatId: string,
  group: ChatGroup,
  planner: Chat,
): Promise<void> {
  notifyChatStreamEnded(chatId);
  setStreaming(false, chatId);
  releaseLaunchSlotForTests(chatId);
  await settleAsyncBoardWork(group, planner);
}

export function assertTaskStatus(
  group: ChatGroup,
  taskId: string,
  status: BoardTask['status'],
): void {
  const task = group.orchestrateBoard?.tasks.find((t) => t.id === taskId);
  assert.ok(task, `task ${taskId} missing`);
  assert.equal(task.status, status, `task ${taskId} status`);
}

export function assertBoardConverged(group: ChatGroup): boolean {
  const board = group.orchestrateBoard;
  if (!board?.tasks.length) return false;
  return board.tasks.every((t) => t.status === 'complete' || t.status === 'quarantined');
}

export function getUnresolvedIssues(group: ChatGroup) {
  return group.orchestrateBoard?.unresolvedIssues ?? [];
}

export type DriveIterationSnapshot = {
  iteration: number;
  slots: RunningBoardTaskSlot[];
  group: ChatGroup;
};

export type DriveBoardOptions = {
  mode?: 'bootstrap' | 'live';
  maxIterations?: number;
  maxTicks?: number;
  runner?: ScriptedTurnRunnerHandle;
  onIteration?: (snapshot: DriveIterationSnapshot) => void;
  setWorktreeMocks?: (mocks: Record<string, unknown>) => void;
};

/** Alternate setTimeout(0) + drain until every task is terminal or maxTicks exceeded. */
export async function settleUntil(
  group: ChatGroup,
  planner: Chat,
  maxTicks = 400,
): Promise<void> {
  for (let tick = 0; tick < maxTicks; tick++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await drainTaskQueueForTests(group, planner);
    if (assertBoardConverged(group)) return;
  }
  throw new Error(`settleUntil exceeded ${maxTicks} ticks without convergence`);
}

/**
 * Drive a board through real launch + scripted turns (MINNOW_TEST runner hook).
 * Installs the runner for the duration of the drive (caller restores via runner.restore()).
 */
export async function driveLiveBoard(
  group: ChatGroup,
  planner: Chat,
  runner: ScriptedTurnRunnerHandle,
  options: DriveBoardOptions = {},
): Promise<void> {
  const board = group.orchestrateBoard;
  assert.ok(board, 'board required');
  runner.install();
  startBoardAutoRun(group, planner);
  await autoDelegateNext(group, planner);
  await settleUntil(group, planner, options.maxTicks ?? 400);
}

/**
 * Drive a board through build → test → merge → final test using scripted outcomes.
 * Uses autoDelegateNext for real wave / dependency / concurrency gating.
 */
export async function driveBoardToConvergence(
  group: ChatGroup,
  planner: Chat,
  script: BoardFlowScript,
  options: DriveBoardOptions = {},
): Promise<void> {
  if (options.mode === 'live') {
    if (!options.runner) {
      throw new Error('driveBoardToConvergence live mode requires options.runner');
    }
    return driveLiveBoard(group, planner, options.runner, options);
  }

  const board = group.orchestrateBoard;
  assert.ok(board, 'board required');
  const maxIterations = options.maxIterations ?? 50;
  const buildAttempts = new Map<string, number>();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    await autoDelegateNext(group, planner);
    await drainTaskQueueForTests(group, planner);
    await bootstrapPendingLaunches(group, planner);

    const slots = listRunningBoardTaskSlots(board);
    options.onIteration?.({ iteration, slots: [...slots], group });

    let advanced = false;
    const resolvedThisIteration = new Set<string>();

    for (const slot of slots) {
      if (resolvedThisIteration.has(slot.chatId)) continue;

      const mocks = worktreeMocksForSlot(script, slot);
      options.setWorktreeMocks?.(mocks);

      const freshTask = board.tasks.find((t) => t.id === slot.taskId);
      const chat = findChatById(slot.chatId);
      assert.ok(chat, `chat ${slot.chatId} missing`);

      if (slot.phase === 'build') {
        const buildOutcome = resolveBuildOutcome(slot.taskId, script, buildAttempts);
        injectChatOutcome(chat, freshTask, 'build', { build: buildOutcome });
        buildAttempts.set(slot.taskId, (buildAttempts.get(slot.taskId) ?? 0) + 1);
      } else if (slot.phase === 'test') {
        injectChatOutcome(chat, freshTask, 'test', {
          test: script.tasks[slot.taskId]?.test ?? 'pass',
        });
      } else if (slot.phase === 'fix') {
        injectChatOutcome(chat, freshTask, 'fix', {});
      } else if (slot.phase === 'final') {
        injectChatOutcome(chat, undefined, 'final', {
          finalTest: script.finalTest ?? 'pass',
        });
      }

      resolvedThisIteration.add(slot.chatId);
      await endChatStream(slot.chatId, group, planner);
      advanced = true;
    }

    if (
      assertBoardConverged(group) &&
      (!script.finalTest || board.finalTest?.status === 'passed')
    ) {
      return;
    }

    if (!advanced) {
      await bootstrapPendingLaunches(group, planner);
      const pending = listRunningBoardTaskSlots(board);
      if (!pending.length && !assertBoardConverged(group)) {
        throw new Error(`Board stuck with no active slots at iteration ${iteration}`);
      }
      if (!pending.length && assertBoardConverged(group) && !script.finalTest) {
        return;
      }
    }

    await settleAsyncBoardWork(group, planner);
  }

  throw new Error(`driveBoardToConvergence exceeded ${maxIterations} iterations`);
}

/** Test lifecycle helpers mirroring merge-fixer tests. */
export function installFlowTestEnv(): {
  restore: () => void;
  prevMinnowTest: string | undefined;
} {
  const prevMinnowTest = process.env.MINNOW_TEST;
  process.env.MINNOW_TEST = '1';
  setBoardNowForTests(() => 1_700_000_000_000);
  installBoardTestDom();
  return {
    prevMinnowTest,
    restore: () => {
      setBoardNowForTests(null);
      setStreaming(false);
      if (prevMinnowTest === undefined) {
        delete process.env.MINNOW_TEST;
      } else {
        process.env.MINNOW_TEST = prevMinnowTest;
      }
    },
  };
}

/** DOM / window stubs for code paths that touch UI during node:test. */
export function installBoardTestDom(): void {
  class FakeElement {
    innerHTML = '';
    id = '';
    dataset: Record<string, string> = {};
    classList = { add() {}, remove() {}, contains: () => false };
    setAttribute() {}
    remove() {}
    replaceChildren() {}
    querySelector() {
      return null;
    }
    appendChild() {
      return this;
    }
  }
  const chatArea = new FakeElement();
  chatArea.id = 'chatArea';
  const chatList = new FakeElement();
  chatList.id = 'chatList';
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement =
    FakeElement as unknown as typeof HTMLElement;
  const doc = {
    createElement: () => new FakeElement(),
    body: { appendChild() {} },
    addEventListener() {},
    getElementById: (id: string) => {
      if (id === 'chatArea') return chatArea;
      if (id === 'chatList') return chatList;
      return null;
    },
    querySelector: () => chatArea,
    querySelectorAll: () => [],
  };
  (globalThis as { document?: Document }).document = doc as unknown as Document;
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = (
    cb: FrameRequestCallback,
  ) => {
    cb(0);
    return 0;
  };
  (globalThis as { window?: Window }).window = {
    setTimeout: (fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    addEventListener() {},
    document: doc,
  } as unknown as Window;
}
