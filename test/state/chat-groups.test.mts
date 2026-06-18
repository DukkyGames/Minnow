/**
 * Sidebar chat groups store.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  assignChatToGroup,
  createGroup,
  deleteGroup,
  dismissActiveBoardView,
  findBoardGroupForPlanner,
  getBoardGroupForChat,
  getGroupsForWorkspace,
  getOrCreateBoardGroup,
  renameGroup,
  toggleGroupCollapsed,
} from '../../src/state/chat-groups.ts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import {
  createEmptyChatObject,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const WS = 'C:\\workspace\\demo';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/demo-plan.md';

afterEach(() => {
  setSessionStateForTests(null);
});

describe('chat groups', () => {
  test('create rename delete keeps chats', () => {
    const chat = createEmptyChatObject('', WS);
    chat.id = PLANNER_ID;
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [chat],
    });
    const g = createGroup('Sprint 1', WS);
    assignChatToGroup(chat.id, g.id);
    assert.equal(chat.groupId, g.id);
    renameGroup(g.id, 'Sprint A');
    assert.equal(getGroupsForWorkspace(WS)[0]?.name, 'Sprint A');
    toggleGroupCollapsed(g.id);
    assert.equal(getGroupsForWorkspace(WS)[0]?.collapsed, true);
    deleteGroup(g.id);
    assert.equal(chat.groupId, undefined);
    assert.equal(getGroupsForWorkspace(WS).length, 0);
  });

  test('group holds board and planner link', () => {
    const planner = createEmptyChatObject('', WS);
    planner.id = PLANNER_ID;
    planner.modeId = 'orchestrate';
    planner.orchestratePlanPath = PLAN_PATH;
    setSessionStateForTests({
      version: 5,
      activeId: planner.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [planner],
    });
    const group = getOrCreateBoardGroup(planner);
    initBoard(group, planner, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    assert.equal(planner.boardGroupId, group.id);
    assert.equal(planner.groupId, group.id);
    assert.equal(findBoardGroupForPlanner(planner.id)?.id, group.id);
    assert.equal(getBoardGroupForChat(planner)?.orchestrateBoard?.tasks.length, 1);
    group.viewMode = 'board';
    if (!sessionState) throw new Error('Session not loaded');
    sessionState.activeBoardGroupId = group.id;
    assert.equal(group.viewMode, 'board');
    assert.equal(sessionState.activeBoardGroupId, group.id);
  });

  test('dismissActiveBoardView clears focus and folder viewMode', () => {
    const planner = createEmptyChatObject('', WS);
    planner.id = PLANNER_ID;
    planner.modeId = 'orchestrate';
    setSessionStateForTests({
      version: 5,
      activeId: planner.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [planner],
    });
    const group = createGroup('Board folder', WS);
    group.viewMode = 'board';
    if (!sessionState) throw new Error('Session not loaded');
    sessionState.activeBoardGroupId = group.id;
    assert.equal(dismissActiveBoardView(), true);
    assert.equal(group.viewMode, 'chat');
    assert.ok(!sessionState.activeBoardGroupId);
    assert.equal(dismissActiveBoardView(), false);
  });
});
