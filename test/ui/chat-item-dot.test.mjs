import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { resolveChatItemDotState } = await import('../../src/ui/chat-item-dot.ts');

function chat(overrides) {
  return {
    id: 'chat-a',
    name: 'A',
    workspacePath: '',
    modelId: '',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    ...overrides,
  };
}

function ctx(overrides = {}) {
  return {
    activeChatId: 'other',
    streamingChatIds: new Set(),
    streamPhaseByChatId: new Map(),
    inputPendingChatId: null,
    ...overrides,
  };
}

describe('chat-item-dot resolveChatItemDotState', () => {
  test('inactive chat with no flags is idle', () => {
    const c = ctx({
      streamingChatIds: new Set(['other']),
      streamPhaseByChatId: new Map([['other', 'generating']]),
    });
    assert.equal(resolveChatItemDotState(chat({}), c), 'idle');
  });

  test('inactive chat with unread is unread', () => {
    assert.equal(
      resolveChatItemDotState(chat({ unread: true }), ctx()),
      'unread',
    );
  });

  test('background chat in thinking stream shows thinking', () => {
    const c = ctx({
      streamingChatIds: new Set(['chat-b']),
      streamPhaseByChatId: new Map([['chat-b', 'thinking']]),
    });
    assert.equal(resolveChatItemDotState(chat({ id: 'chat-b' }), c), 'thinking');
  });

  test('active chat streaming generating only is idle', () => {
    const c = ctx({
      activeChatId: 'chat-a',
      streamingChatIds: new Set(['chat-a']),
      streamPhaseByChatId: new Map([['chat-a', 'generating']]),
    });
    assert.equal(resolveChatItemDotState(chat({}), c), 'idle');
  });

  test('active chat in thinking stream phase shows thinking', () => {
    const c = ctx({
      activeChatId: 'chat-a',
      streamingChatIds: new Set(['chat-a']),
      streamPhaseByChatId: new Map([['chat-a', 'thinking']]),
    });
    assert.equal(resolveChatItemDotState(chat({}), c), 'thinking');
  });

  test('needs-input beats thinking', () => {
    const c = ctx({
      activeChatId: 'chat-a',
      streamingChatIds: new Set(['chat-a']),
      streamPhaseByChatId: new Map([['chat-a', 'thinking']]),
      inputPendingChatId: 'chat-a',
    });
    assert.equal(resolveChatItemDotState(chat({}), c), 'needs-input');
  });
});
