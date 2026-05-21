/**
 * Chat turn setup guard — blocks double-send before streaming flag is set.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  beginChatTurnSetup,
  endChatTurnSetup,
  isChatTurnSetupPending,
} from '../../src/chat/chat-turn-guard.ts';
import { setStreaming } from '../../src/app-state.ts';

const CHAT_A = '11111111-1111-1111-1111-111111111111';

afterEach(() => {
  setStreaming(false);
  endChatTurnSetup(CHAT_A);
});

describe('chat-turn-guard', () => {
  test('beginChatTurnSetup claims once per chat', () => {
    assert.equal(beginChatTurnSetup(CHAT_A), true);
    assert.equal(isChatTurnSetupPending(CHAT_A), true);
    assert.equal(beginChatTurnSetup(CHAT_A), false);
  });

  test('endChatTurnSetup releases the claim', () => {
    assert.equal(beginChatTurnSetup(CHAT_A), true);
    endChatTurnSetup(CHAT_A);
    assert.equal(isChatTurnSetupPending(CHAT_A), false);
    assert.equal(beginChatTurnSetup(CHAT_A), true);
  });

  test('beginChatTurnSetup fails when chat is already streaming', () => {
    setStreaming(true, CHAT_A);
    assert.equal(beginChatTurnSetup(CHAT_A), false);
  });
});
