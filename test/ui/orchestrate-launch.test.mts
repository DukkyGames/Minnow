/**
 * launchBoardFromPlan — multiple boards per workspace.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import { getOrCreateBoardGroup } from '../../src/state/chat-groups.ts';
import {
  createEmptyChatObject,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { launchBoardFromPlan } from '../../src/ui/orchestrate-launch.ts';

const WORKSPACE = '/tmp/orchestrate-launch-test';

function setupDom() {
  const win = new Window();
  installHappyDomGlobals(win);
  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);
  const main = document.createElement('div');
  main.id = 'mainColumn';
  document.body.appendChild(main);
  const modelSelect = document.createElement('select');
  modelSelect.id = 'modelSelect';
  document.body.appendChild(modelSelect);
  const msgInput = document.createElement('textarea');
  msgInput.id = 'msgInput';
  document.body.appendChild(msgInput);
}

describe('launchBoardFromPlan', () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('creates a new board folder when the active planner already owns one', () => {
    setupDom();

    const planner = createEmptyChatObject('m1');
    planner.workspacePath = WORKSPACE;
    planner.modeId = 'orchestrate';
    planner.orchestratePlanPath = 'documentation/plans/first.md';

    setSessionStateForTests({
      version: 5,
      activeId: planner.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [planner],
    });

    const firstGroup = getOrCreateBoardGroup(planner);
    initBoard(firstGroup, planner, {
      planPath: 'documentation/plans/first.md',
      tasks: [{ id: 'W1-A', title: 'One', wave: 'W1', category: 'build', build: 'x', test: 'y' }],
      waves: [{ id: 'W1' }],
    });

    launchBoardFromPlan('documentation/plans/second.md');

    assert.ok(sessionState);
    const boards = (sessionState.groups ?? []).filter(
      (g) => g.workspacePath === WORKSPACE && g.orchestrateBoard,
    );
    assert.equal(boards.length, 2);
    assert.notEqual(boards[0]?.id, boards[1]?.id);
    const activePlannerId = sessionState.activeId;
    const activeGroup = (sessionState.groups ?? []).find((g) => g.plannerChatId === activePlannerId);
    assert.notEqual(activeGroup?.id, firstGroup.id);
    assert.equal(activeGroup?.orchestratePlanPath, 'documentation/plans/second.md');
  });
});
