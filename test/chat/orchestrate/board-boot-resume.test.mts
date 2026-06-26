/**
 * Boot resume for orchestrate boards after page reload.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { bootOrchestrateBoardResume } from '../../../src/chat/orchestrate/board-boot-resume.ts';
import { resumeBoardExecutionAfterReload } from '../../../src/state/orchestrate-board-actions.ts';
import { initBoard, updateTask } from '../../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../../src/state/sessions.ts';
import { setLocalServerAvailableForTests } from '../../../src/tools/config.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const FIXER_CHAT_ID = '55555555-5555-5555-5555-555555555555';
const PLAN_PATH = 'documentation/plans/boot-resume.md';

function makePlanner(): Chat {
  return {
    id: PLANNER_ID,
    name: 'Planner',
    workspacePath: '/tmp/ws',
    modeId: 'orchestrate',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    orchestratePlanPath: PLAN_PATH,
    boardGroupId: GROUP_ID,
  };
}

function makeGroup(): ChatGroup {
  return {
    id: GROUP_ID,
    name: 'Boot resume folder',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    orchestratePlanPath: PLAN_PATH,
    plannerChatId: PLANNER_ID,
  };
}

function seedRunningBoard(executionMode: 'auto' | 'sequential' = 'auto') {
  const planner = makePlanner();
  const group = makeGroup();
  initBoard(group, planner, {
    planPath: PLAN_PATH,
    waves: [{ id: 'W1' }],
    tasks: [
      {
        id: 'W1-A',
        title: 'Stalled task',
        wave: 'W1',
        category: 'build',
        build: 'Do work',
      },
    ],
  });
  const board = group.orchestrateBoard!;
  board.executionMode = executionMode;
  board.autoRunning = true;
  board.tasks[0]!.status = 'in_progress';
  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner],
    groups: [group],
  });
  return { planner, group };
}

describe('boot orchestrate board resume', () => {
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
  });

  afterEach(() => {
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('resumeBoardExecutionAfterReload keeps board running for stalled in_progress task', async () => {
    const { planner, group } = seedRunningBoard('sequential');
    await resumeBoardExecutionAfterReload(group, planner);
    assert.equal(group.orchestrateBoard?.autoRunning, true);
    assert.equal(group.orchestrateBoard?.executionMode, 'sequential');
  });

  test('bootOrchestrateBoardResume skips boards that are not running', async () => {
    const { planner, group } = seedRunningBoard();
    group.orchestrateBoard!.autoRunning = false;
    await bootOrchestrateBoardResume({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner],
      groups: [group],
    });
    assert.equal(group.orchestrateBoard?.autoRunning, false);
  });

  test('bootOrchestrateBoardResume resumes each running board with a planner', async () => {
    const { planner, group } = seedRunningBoard();
    await bootOrchestrateBoardResume({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner],
      groups: [group],
    });
    assert.equal(group.orchestrateBoard?.autoRunning, true);
  });

  test('OOM boot pauses boards and reconciles dead merge fixers', async () => {
    const prevWindow = (globalThis as { window?: Window }).window;
    const { Window } = await import('happy-dom');
    const domWindow = new Window();
    (globalThis as { document?: Document; HTMLElement?: typeof HTMLElement }).document =
      domWindow.document;
    (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = domWindow.HTMLElement;
    (globalThis as { window?: Window }).window = {
      ...domWindow,
      minnow: {
        diagnostics: {
          getOomPause: async () => ({
            reason: 'oom',
            kind: 'render-process-gone',
            ts: new Date().toISOString(),
          }),
          clearOomPause: async () => {},
        },
      },
    } as Window;

    process.env.MINNOW_TEST = '1';

    const planner = makePlanner();
    const group = makeGroup();
    initBoard(group, planner, {
      planPath: PLAN_PATH,
      waves: [{ id: 'W1' }],
      tasks: [
        {
          id: 'W1-A',
          title: 'Stuck merge',
          wave: 'W1',
          category: 'build',
          build: 'Do work',
        },
      ],
    });
    const board = group.orchestrateBoard!;
    board.executionMode = 'auto';
    board.autoRunning = true;
    board.integrationBranch = 'minnow/integration/grp_11111111';

    const fixerChat: Chat = {
      id: FIXER_CHAT_ID,
      name: 'Merge fixer W1-A',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      history: [
        { role: 'user', content: 'Resolve merge conflict' },
        { role: 'assistant', content: 'Conflict resolved and committed.' },
      ],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-A',
    };

    updateTask(
      group,
      'W1-A',
      {
        status: 'merging',
        fixerChatId: FIXER_CHAT_ID,
        worktreeBranch: 'minnow/board/W1-A',
        mergePreSha: 'abc123',
      },
      planner,
    );

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, fixerChat],
      groups: [group],
    });

    const savedFetch = globalThis.fetch;
    setLocalServerAvailableForTests(true);
    // @ts-ignore — test-only replacement
    globalThis.fetch = async (_url: unknown, opts?: { body?: unknown }) => {
      let op = '';
      try {
        op = (JSON.parse(opts?.body as string) as { op?: string }).op ?? '';
      } catch {
        /* ignore */
      }
      if (op === 'check_merged') {
        return { ok: true, json: async () => ({ ok: true, merged: true }) };
      }
      if (op === 'verify_integration') {
        return { ok: true, json: async () => ({ ok: true, verified: true }) };
      }
      if (op === 'refresh_integration_deps') {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ ok: false, error: 'not_mocked' }) };
    };

    try {
      await bootOrchestrateBoardResume({
        version: 5,
        activeId: PLANNER_ID,
        chats: [planner, fixerChat],
        groups: [group],
      });

      assert.equal(board.autoRunning, false);
      assert.equal(board.systemPaused, true);
      const task = board.tasks.find((t) => t.id === 'W1-A')!;
      assert.equal(task.status, 'complete', 'dead fixer should be reconciled on OOM boot');
    } finally {
      globalThis.fetch = savedFetch;
      setLocalServerAvailableForTests(false);
      domWindow.close();
      // @ts-expect-error test cleanup
      delete globalThis.document;
      // @ts-expect-error test cleanup
      delete globalThis.HTMLElement;
      if (prevWindow === undefined) {
        delete (globalThis as { window?: Window }).window;
      } else {
        (globalThis as { window?: Window }).window = prevWindow;
      }
    }
  });
});
