/**
 * Workspace switch guard while orchestrator boards are running (MIN-344).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import { isBoardRunning } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { resetWorkspaceStateForTests, setWorkspaceFromServer } from '../../src/state/workspace.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';
import {
  confirmAndStopBoardsForWorkspaceSwitch,
  formatWorkspaceSwitchBoardConfirmMessage,
  getBlockingBoardsForWorkspace,
  isBoardBlockingWorkspaceSwitch,
  isWorkspaceSwitchBlockedByRunningBoard,
} from '../../src/ui/workspace-switch-guard.ts';

const GROUP_ID = 'grp_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PLANNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CURRENT_WS = '/tmp/minnow-current';
const OTHER_WS = '/tmp/minnow-other';
const PLAN_PATH = 'documentation/plans/test-plan.md';

function makePlanner(): Chat {
  return {
    id: PLANNER_ID,
    name: 'Planner',
    workspacePath: CURRENT_WS,
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
    name: 'Ship feature',
    workspacePath: CURRENT_WS,
    collapsed: false,
    order: 0,
    createdAt: 1,
    orchestratePlanPath: PLAN_PATH,
    plannerChatId: PLANNER_ID,
  };
}

function seedRunningBoard(): { planner: Chat; group: ChatGroup } {
  const planner = makePlanner();
  const group = makeGroup();
  initBoard(group, planner, {
    planPath: PLAN_PATH,
    waves: [{ id: 'W1' }],
    tasks: [
      {
        id: 'W1-A',
        title: 'Task',
        wave: 'W1',
        category: 'build',
        build: 'Work',
      },
    ],
  });
  const board = group.orchestrateBoard!;
  board.executionMode = 'auto';
  board.autoRunning = true;
  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner],
    groups: [group],
  });
  return { planner, group };
}

describe('workspace-switch-guard', () => {
  let originalConfirm: typeof window.confirm;
  let domWindow: Window;

  beforeEach(() => {
    domWindow = new Window();
    installHappyDomGlobals(domWindow);
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({
      path: CURRENT_WS,
      label: 'current',
      isDefault: false,
    });
    originalConfirm = window.confirm;
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    setSessionStateForTests(null);
    resetWorkspaceStateForTests();
    domWindow.close();
  });

  test('detects a running board in the current workspace', () => {
    const { group } = seedRunningBoard();
    assert.equal(isBoardRunning(group), true);
    assert.equal(isBoardBlockingWorkspaceSwitch(group), true);
    assert.deepEqual(getBlockingBoardsForWorkspace(CURRENT_WS).map((g) => g.id), [GROUP_ID]);
    assert.equal(isWorkspaceSwitchBlockedByRunningBoard(OTHER_WS), true);
  });

  test('does not block switching to the same workspace path', () => {
    seedRunningBoard();
    assert.equal(isWorkspaceSwitchBlockedByRunningBoard(CURRENT_WS), false);
  });

  test('does not block when no board is running', () => {
    const planner = makePlanner();
    const group = makeGroup();
    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner],
      groups: [group],
    });
    assert.equal(isWorkspaceSwitchBlockedByRunningBoard(OTHER_WS), false);
  });

  test('formatWorkspaceSwitchBoardConfirmMessage covers single and multiple boards', () => {
    const single = makeGroup();
    const multi = [makeGroup(), { ...makeGroup(), id: 'grp_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }];
    assert.match(formatWorkspaceSwitchBoardConfirmMessage([single]), /Ship feature/);
    assert.match(formatWorkspaceSwitchBoardConfirmMessage(multi), /2 orchestrator boards/);
  });

  test('confirmAndStopBoardsForWorkspaceSwitch cancels without stopping', async () => {
    const { group } = seedRunningBoard();
    const allowedPromise = confirmAndStopBoardsForWorkspaceSwitch(OTHER_WS);
    await Promise.resolve();
    const cancelBtn = document.querySelector<HTMLButtonElement>('[data-dialog-action="cancel"]');
    assert.ok(cancelBtn);
    cancelBtn.click();
    const allowed = await allowedPromise;
    assert.equal(allowed, false);
    assert.equal(isBoardRunning(group), true);
  });

  test('confirmAndStopBoardsForWorkspaceSwitch stops boards when confirmed', async () => {
    const { group } = seedRunningBoard();
    const allowedPromise = confirmAndStopBoardsForWorkspaceSwitch(OTHER_WS);
    await Promise.resolve();
    const confirmBtn = document.querySelector<HTMLButtonElement>('[data-dialog-action="confirm"]');
    assert.ok(confirmBtn);
    confirmBtn.click();
    const allowed = await allowedPromise;
    assert.equal(allowed, true);
    assert.equal(isBoardRunning(group), false);
    assert.equal(group.orchestrateBoard?.userStopped, true);
  });
});
