/**
 * MIN-340 leftover: return-to-setup banner is a no-op after P4-C (MIN-715).
 * Planner-chat setup chrome is gone; incomplete V1 folders do not show a banner.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { createEmptyChatObject, setSessionStateForTests } = await import(
  '../../src/state/sessions.ts'
);
const {
  BOARD_SETUP_BANNER_ID,
  removeBoardSetupReturnBanner,
  syncBoardSetupReturnBanner,
} = await import('../../src/ui/orchestrate-board-setup-banner.ts');

/** happy-dom windows keep the event loop alive unless closed. */
let testWindow = null;

describe('board setup return UI is retired (MIN-715)', () => {
  afterEach(() => {
    setSessionStateForTests(null);
    testWindow?.close();
    testWindow = null;
  });

  test('syncBoardSetupReturnBanner does not render a banner', () => {
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

    syncBoardSetupReturnBanner(chat);
    assert.equal(document.getElementById(BOARD_SETUP_BANNER_ID), null);
    removeBoardSetupReturnBanner();
    assert.equal(document.getElementById(BOARD_SETUP_BANNER_ID), null);
  });
});
