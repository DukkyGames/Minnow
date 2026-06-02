/**
 * Concurrent chat streaming registry (Wave A).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  abortByChatId,
  getChatAbort,
  setChatAbort,
  setStreaming,
  streamingChatIds,
} from '../../src/app-state.ts';
import { isChatStreaming, isBackgroundStreamBlockingSend } from '../../src/chat/streaming-state.ts';

describe('concurrent streaming registry', () => {
  afterEach(() => {
    setStreaming(false);
    abortByChatId.clear();
  });

  test('two chats can stream simultaneously', () => {
    setStreaming(true, 'chat-a');
    setStreaming(true, 'chat-b');
    assert.equal(streamingChatIds.size, 2);
    assert.equal(isChatStreaming('chat-a'), true);
    assert.equal(isChatStreaming('chat-b'), true);
  });

  test('stopping one chat leaves the other streaming', () => {
    setStreaming(true, 'chat-a');
    setStreaming(true, 'chat-b');
    setStreaming(false, 'chat-a');
    assert.equal(isChatStreaming('chat-a'), false);
    assert.equal(isChatStreaming('chat-b'), true);
  });

  test('per-chat abort controllers are isolated', () => {
    const a = new AbortController();
    const b = new AbortController();
    setChatAbort('chat-a', a);
    setChatAbort('chat-b', b);
    assert.equal(getChatAbort('chat-a'), a);
    assert.equal(getChatAbort('chat-b'), b);
    setChatAbort('chat-a', null);
    assert.equal(getChatAbort('chat-a'), undefined);
    assert.equal(getChatAbort('chat-b'), b);
  });

  test('background send is not blocked', () => {
    setStreaming(true, 'chat-a');
    assert.equal(isBackgroundStreamBlockingSend(), false);
  });
});
