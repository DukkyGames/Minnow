/**
 * Board onboarding kickoff names a bound plan path and keeps a stable marker.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/fixture-plan.md';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { setStreaming } = await import('../../src/app-state.ts');
const {
  BOARD_ONBOARDING_KICKOFF_MARKER,
  BOARD_ONBOARDING_KICKOFF_MESSAGE,
  buildBoardOnboardingKickoffMessage,
  shouldSkipDuplicateBoardOnboardingKickoff,
} = await import('../../src/ui/orchestrate-board-kickoff.ts');
const { lastUserMessageMatchesBoardKickoff } = await import(
  '../../src/ui/orchestrate-board-init-split.ts'
);
const { resetBoardOnboardingTransientState } = await import(
  '../../src/ui/orchestrate-board-onboarding-state.ts'
);

afterEach(() => {
  resetBoardOnboardingTransientState();
  setStreaming(false);
  setSessionStateForTests(null);
});

describe('buildBoardOnboardingKickoffMessage', () => {
  test('pathless message is the historical constant and includes the marker', () => {
    const text = buildBoardOnboardingKickoffMessage(null);
    assert.equal(text, BOARD_ONBOARDING_KICKOFF_MESSAGE);
    assert.ok(text.includes(BOARD_ONBOARDING_KICKOFF_MARKER));
    assert.ok(BOARD_ONBOARDING_KICKOFF_MESSAGE.includes(BOARD_ONBOARDING_KICKOFF_MARKER));
  });

  test('bound path is named and still includes the marker', () => {
    const text = buildBoardOnboardingKickoffMessage(PLAN_PATH);
    assert.ok(text.includes(`\`${PLAN_PATH}\``));
    assert.ok(text.includes(BOARD_ONBOARDING_KICKOFF_MARKER));
    assert.match(text, /Do not ask which plan to use/);
    assert.notEqual(text, BOARD_ONBOARDING_KICKOFF_MESSAGE);
  });

  test('invalid path falls back to the pathless constant', () => {
    assert.equal(
      buildBoardOnboardingKickoffMessage('not-a-plan.txt'),
      BOARD_ONBOARDING_KICKOFF_MESSAGE,
    );
  });
});

describe('board onboarding kickoff detection', () => {
  test('path-named kickoff is treated as a board-init turn', () => {
    const chat = createEmptyChatObject('');
    chat.history.push({
      role: 'user',
      content: buildBoardOnboardingKickoffMessage(PLAN_PATH),
    });
    assert.equal(lastUserMessageMatchesBoardKickoff(chat), true);
  });

  test('path-named kickoff still skips a duplicate send', () => {
    const chat = createEmptyChatObject('');
    chat.id = FIXED_CHAT_ID;
    chat.history.push({
      role: 'user',
      content: buildBoardOnboardingKickoffMessage(PLAN_PATH),
    });
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [],
    });
    assert.equal(shouldSkipDuplicateBoardOnboardingKickoff(chat), true);
  });
});
