/**
 * Scripted board chat-turn runner — reproduces the real turn contract from
 * `runChatTurn` / board launch paths without hitting the LLM.
 */

import { setStreaming } from '../../src/app-state.ts';
import { notifyChatStreamEnded } from '../../src/chat/streaming-state.ts';
import { resetWrapperState } from '../../src/agents/controller/wrapper.ts';
import {
  clearTaskChatStallRestartsForTests,
  clearTaskQueuesForTests,
  listRunningBoardTaskSlots,
  setBoardChatTurnRunner,
  type BoardChatTurnRunner,
  type RunningBoardTaskSlot,
} from '../../src/state/orchestrate-board-actions.ts';
import { markBoardTaskInProgressFromChat } from '../../src/state/orchestrate-board-store.ts';
import { sessionState } from '../../src/state/sessions.ts';
import type { RunChatTurnOptions } from '../../src/tools/loop.ts';
import type { BoardTask, Chat, ChatGroup } from '../../src/types.ts';
import type { BoardFlowScript } from './_board-flow-helpers.mts';

/** Matches FLOW_GROUP_ID in _board-flow-helpers (injectChatOutcome final-test lookup). */
const FLOW_GROUP_ID = 'grp_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

type BuildOutcome =
  | 'complete'
  | 'fail'
  | 'stopped'
  | 'fail-then-heal'
  | 'always-fail'
  | undefined;

export interface ScriptedTurnContext {
  input: RunChatTurnOptions;
  chat: Chat;
  group: ChatGroup;
  task: BoardTask | undefined;
  phase: RunningBoardTaskSlot['phase'];
  attempt: number;
}

export type ScriptedTurnBody = (
  ctx: ScriptedTurnContext,
) => void | Promise<void>;

export type ScriptedTurnLaunch = {
  chatId: string;
  taskId?: string;
  phase: RunningBoardTaskSlot['phase'];
  attempt: number;
  peakConcurrency: number;
  input: RunChatTurnOptions;
};

export interface ScriptedTurnRunnerHandle {
  install(): void;
  restore(): void;
  launches: ScriptedTurnLaunch[];
  peakConcurrency: number;
  inFlight: number;
}

function macrotaskDelay(ms: number): Promise<void> {
  if (ms <= 0) {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveGroupForChat(chat: Chat): ChatGroup | undefined {
  const groupId = chat.boardGroupId?.trim();
  if (!groupId || !sessionState?.groups) return undefined;
  return sessionState.groups.find((g) => g.id === groupId);
}

function resolvePhaseForChat(
  chat: Chat,
  board: NonNullable<ChatGroup['orchestrateBoard']>,
): RunningBoardTaskSlot['phase'] {
  const slot = listRunningBoardTaskSlots(board).find((s) => s.chatId === chat.id);
  if (slot) return slot.phase;

  const taskId = chat.boardTaskId?.trim();
  if (!taskId) {
    if (board.finalTest?.chatId?.trim() === chat.id) return 'final';
    return 'build';
  }
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) return 'build';
  if (task.fixerChatId?.trim() === chat.id) return 'fix';
  if (task.testChatId?.trim() === chat.id || chat.workAgentId === 'tester') {
    if (board.finalTest?.chatId?.trim() === chat.id) return 'final';
    return 'test';
  }
  if (board.finalTest?.chatId?.trim() === chat.id) return 'final';
  return 'build';
}

function resolveBuildOutcome(
  taskId: string,
  script: BoardFlowScript,
  buildAttempts: Map<string, number>,
): 'complete' | 'fail' | 'stopped' {
  const spec: BuildOutcome = script.tasks[taskId]?.build ?? 'complete';
  if (spec === 'always-fail') return 'fail';
  if (spec === 'fail-then-heal') {
    const n = buildAttempts.get(taskId) ?? 0;
    return n === 0 ? 'fail' : 'complete';
  }
  return spec as 'complete' | 'fail' | 'stopped';
}

/** Populate a launched chat so stream-end finalizers read the scripted result. */
export function injectChatOutcome(
  chat: Chat,
  task: BoardTask | undefined,
  phase: RunningBoardTaskSlot['phase'],
  outcome: {
    build?: 'complete' | 'fail' | 'stopped';
    test?: 'pass' | 'fail';
    finalTest?: 'pass' | 'fail';
  },
): void {
  if (phase === 'build') {
    const build = outcome.build ?? 'complete';
    if (build === 'stopped') {
      chat.history.push({
        role: 'assistant',
        content: 'Stopped mid-build.',
        stopped: true,
      });
      chat.runs = [
        {
          runId: 'run_stop',
          branchId: 'b1',
          forkHistoryIndex: 0,
          status: 'stopped',
          stopReason: 'system',
          createdAt: 10,
          snapshot: null as never,
        },
      ];
      return;
    }
    if (build === 'fail') {
      chat.history.push({ role: 'user', content: 'Execute task' });
      return;
    }
    if (task) {
      task.boardReport = { outcome: 'pass', summary: `Build verified for ${task.id}` };
    }
    chat.history.push({
      role: 'assistant',
      content: `Build complete for ${task?.id ?? 'task'}.`,
    });
    return;
  }

  if (phase === 'test') {
    const verdict = outcome.test ?? 'pass';
    if (task) {
      task.testVerdict = verdict;
      task.testSummary = verdict === 'pass' ? 'tests passed' : 'tests failed';
    }
    chat.history.push({
      role: 'assistant',
      content: verdict === 'pass' ? 'VERDICT: pass' : 'VERDICT: fail',
    });
    return;
  }

  if (phase === 'fix') {
    if (task) {
      task.boardReport = { outcome: 'pass', summary: 'Merge committed' };
    }
    chat.history.push({
      role: 'assistant',
      content: 'Resolved conflict with git commit --no-edit.',
    });
    return;
  }

  if (phase === 'final') {
    const verdict = outcome.finalTest ?? 'pass';
    const board = sessionState?.groups?.find((g) => g.id === FLOW_GROUP_ID);
    if (board?.orchestrateBoard?.finalTest) {
      board.orchestrateBoard.finalTest.recordedVerdict = verdict;
      board.orchestrateBoard.finalTest.summary =
        verdict === 'pass' ? 'full board pass' : 'full board fail';
    }
    chat.history.push({
      role: 'assistant',
      content: `VERDICT: ${verdict}`,
    });
  }
}

function defaultScriptedBody(
  ctx: ScriptedTurnContext,
  script: BoardFlowScript,
  buildAttempts: Map<string, number>,
): void {
  const { chat, task, phase } = ctx;
  const taskId = task?.id ?? chat.boardTaskId?.trim() ?? '';

  if (phase === 'build') {
    const buildOutcome = resolveBuildOutcome(taskId, script, buildAttempts);
    injectChatOutcome(chat, task, 'build', { build: buildOutcome });
    buildAttempts.set(taskId, (buildAttempts.get(taskId) ?? 0) + 1);
    return;
  }
  if (phase === 'test') {
    injectChatOutcome(chat, task, 'test', {
      test: script.tasks[taskId]?.test ?? 'pass',
    });
    return;
  }
  if (phase === 'fix') {
    injectChatOutcome(chat, task, 'fix', {});
    return;
  }
  if (phase === 'final') {
    injectChatOutcome(chat, undefined, 'final', {
      finalTest: script.finalTest ?? 'pass',
    });
  }
}

export function createScriptedTurnRunner(opts: {
  script: BoardFlowScript;
  override?: ScriptedTurnBody;
  turnDelayMs?: number;
}): ScriptedTurnRunnerHandle {
  const { script, override, turnDelayMs = 0 } = opts;
  const launches: ScriptedTurnLaunch[] = [];
  let peakConcurrency = 0;
  let inFlight = 0;
  const buildAttempts = new Map<string, number>();
  const attemptByKey = new Map<string, number>();

  const runner: BoardChatTurnRunner = async (input) => {
    const chat = input.chat;
    const group = resolveGroupForChat(chat);
    const board = group?.orchestrateBoard;
    if (!group || !board) return;

    const phase = resolvePhaseForChat(chat, board);
    const taskId = chat.boardTaskId?.trim();
    const task = taskId ? board.tasks.find((t) => t.id === taskId) : undefined;
    const attemptKey = `${taskId ?? chat.id}:${phase}`;
    const attempt = attemptByKey.get(attemptKey) ?? 0;
    attemptByKey.set(attemptKey, attempt + 1);

    const slotsNow = listRunningBoardTaskSlots(board).length;
    peakConcurrency = Math.max(peakConcurrency, slotsNow);

    launches.push({
      chatId: chat.id,
      taskId: task?.id,
      phase,
      attempt,
      peakConcurrency: slotsNow,
      input,
    });

    inFlight += 1;
    try {
      markBoardTaskInProgressFromChat(chat);

      if (input.ownsGlobalStreaming ?? true) {
        setStreaming(true, chat.id);
        if (input.pushUser) {
          chat.history.push({ role: 'user', content: input.historyContent });
        }
      }

      await macrotaskDelay(turnDelayMs);

      const ctx: ScriptedTurnContext = {
        input,
        chat,
        group,
        task,
        phase,
        attempt,
      };

      if (override) {
        await override(ctx);
      } else {
        defaultScriptedBody(ctx, script, buildAttempts);
      }

      notifyChatStreamEnded(chat.id);
      if (input.ownsGlobalStreaming ?? true) {
        setStreaming(false, chat.id);
      }
    } finally {
      inFlight -= 1;
    }
  };

  const handle: ScriptedTurnRunnerHandle = {
    launches,
    get peakConcurrency() {
      return peakConcurrency;
    },
    get inFlight() {
      return inFlight;
    },
    install() {
      setBoardChatTurnRunner(runner);
    },
    restore() {
      resetWrapperState();
      clearTaskQueuesForTests();
      clearTaskChatStallRestartsForTests();
      setBoardChatTurnRunner(null);
    },
  };
  return handle;
}
