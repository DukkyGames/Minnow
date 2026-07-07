/**
 * MIN-340: return-to-setup banner and openBoardGroup for incomplete setup.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { createEmptyChatObject, setSessionStateForTests } = await import(
  '../../src/state/sessions.ts'
);
const { getOrCreateBoardGroup } = await import(
  '../../src/state/chat-groups.ts'
);
const { isBoardSetupIncomplete } = await import(
  '../../src/chat/orchestrate/board-setup.ts'
);
const {
  resetBoardOnboardingTransientState,
  setBoardKickoffInProgress,
} = await import('../../src/ui/orchestrate-board-onboarding-state.ts');
const {
  BOARD_SETUP_BANNER_ID,
  removeBoardSetupReturnBanner,
  syncBoardSetupReturnBanner,
} = await import('../../src/ui/orchestrate-board-setup-banner.ts');

const PLAN_PATH = 'documentation/plans/fixture.md';

/** happy-dom windows keep the event loop alive unless closed. */
let testWindow = null;

describe('board setup return UI (MIN-340)', () => {
  afterEach(() => {
    resetBoardOnboardingTransientState();
    setSessionStateForTests(null);
    testWindow?.close();
    testWindow = null;
  });

  test('setup-incomplete groups qualify for board open path', () => {
    const chat = createEmptyChatObject('');
    chat.id = '22222222-2222-2222-2222-222222222222';
    chat.modeId = 'orchestrate';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [],
    });
    const group = getOrCreateBoardGroup(chat);
    group.orchestratePlanPath = PLAN_PATH;

    assert.equal(Boolean(group.orchestrateBoard), false);
    assert.equal(isBoardSetupIncomplete(group), true);
  });

  test('syncBoardSetupReturnBanner renders while setup incomplete in chat view', () => {
    testWindow = new Window();
    globalThis.document = testWindow.document;
    globalThis.HTMLElement = testWindow.HTMLElement;

    const area = document.createElement('main');
    area.id = 'chatArea';
    document.body.appendChild(area);

    const chat = createEmptyChatObject('');
    chat.id = '33333333-3333-3333-3333-333333333333';
    chat.modeId = 'orchestrate';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [],
    });
    const group = getOrCreateBoardGroup(chat);
    group.orchestratePlanPath = PLAN_PATH;
    group.viewMode = 'chat';
    setBoardKickoffInProgress(true);

    syncBoardSetupReturnBanner(chat);
    const banner = document.getElementById(BOARD_SETUP_BANNER_ID);
    assert.ok(banner);
    assert.match(banner.textContent ?? '', /in progress/i);

    removeBoardSetupReturnBanner();
    assert.equal(document.getElementById(BOARD_SETUP_BANNER_ID), null);
    setBoardKickoffInProgress(false);
  });
});
