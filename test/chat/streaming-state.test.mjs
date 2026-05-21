import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

const appState = await import('../../src/app-state.ts');
const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const {
  getStreamingChatId,
  isActiveChatStreaming,
  isChatStreaming,
  isBackgroundStreamBlockingSend,
  isStreamDomVisible,
} = await import('../../src/chat/streaming-state.ts');

function seedTwoChats(activeId) {
  const a = createEmptyChatObject('');
  a.id = 'chat-a';
  a.name = 'Chat A';
  const b = createEmptyChatObject('');
  b.id = 'chat-b';
  b.name = 'Chat B';
  setSessionStateForTests({
    version: 2,
    activeId,
    sidebarCollapsed: false,
    chats: [a, b],
  });
  return { a, b };
}

describe('streaming-state helpers', () => {
  afterEach(() => {
    appState.setStreaming(false);
    setSessionStateForTests(null);
  });

  test('getStreamingChatId is null when idle', () => {
    seedTwoChats('chat-a');
    assert.equal(getStreamingChatId(), null);
    assert.equal(isChatStreaming('chat-a'), false);
    assert.equal(isActiveChatStreaming(), false);
  });

  test('isChatStreaming tracks streamingChatId', () => {
    seedTwoChats('chat-b');
    appState.setStreaming(true, 'chat-a');
    assert.equal(getStreamingChatId(), 'chat-a');
    assert.equal(isChatStreaming('chat-a'), true);
    assert.equal(isChatStreaming('chat-b'), false);
    assert.equal(isActiveChatStreaming(), false);
  });

  test('isActiveChatStreaming when active matches stream', () => {
    seedTwoChats('chat-a');
    appState.setStreaming(true, 'chat-a');
    assert.equal(isActiveChatStreaming(), true);
    assert.equal(isStreamDomVisible('chat-a'), true);
    assert.equal(isStreamDomVisible('chat-b'), false);
  });

  test('isBackgroundStreamBlockingSend when another chat streams', () => {
    seedTwoChats('chat-b');
    appState.setStreaming(true, 'chat-a');
    assert.equal(isBackgroundStreamBlockingSend(), true);
    assert.equal(isActiveChatStreaming(), false);
  });
});
