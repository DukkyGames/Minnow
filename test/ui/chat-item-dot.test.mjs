import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { resolveChatItemDotState } = await import('../../src/ui/chat-item-dot.ts');

/** Minimal chat row for resolver tests (only id / flags used). */
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

describe('chat-item-dot resolveChatItemDotState', () => {
  test('inactive chat with no flags is idle', () => {
    const ctx = {
      activeChatId: 'other',
      streaming: true,
      streamingChatId: 'other',
      streamPhase: 'generating',
      inputPendingChatId: null,
    };
    assert.equal(resolveChatItemDotState(chat({}), ctx), 'idle');
  });

  test('inactive chat with unread is unread', () => {
    const ctx = {
      activeChatId: 'other',
      streaming: false,
      streamingChatId: null,
      streamPhase: null,
      inputPendingChatId: null,
    };
    assert.equal(resolveChatItemDotState(chat({ unread: true }), ctx), 'unread');
  });

  test('active chat with unread flag still idle (unread only when inactive)', () => {
    const ctx = {
      activeChatId: 'chat-a',
      streaming: false,
      streamingChatId: null,
      streamPhase: null,
      inputPendingChatId: null,
    };
    assert.equal(resolveChatItemDotState(chat({ unread: true }), ctx), 'idle');
  });

  test('active chat streaming generating only is idle', () => {
    const ctx = {
      activeChatId: 'chat-a',
      streaming: true,
      streamingChatId: 'chat-a',
      streamPhase: 'generating',
      inputPendingChatId: null,
    };
    assert.equal(resolveChatItemDotState(chat({}), ctx), 'idle');
  });

  test('active chat in thinking stream phase shows thinking', () => {
    const ctx = {
      activeChatId: 'chat-a',
      streaming: true,
      streamingChatId: 'chat-a',
      streamPhase: 'thinking',
      inputPendingChatId: null,
    };
    assert.equal(resolveChatItemDotState(chat({}), ctx), 'thinking');
  });

  test('active chat with currentGenerationId in thinking phase shows thinking when not streaming', () => {
    const ctx = {
      activeChatId: 'chat-a',
      streaming: false,
      streamingChatId: null,
      streamPhase: 'thinking',
      inputPendingChatId: null,
    };
    const c = chat({
      currentGenerationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    assert.equal(resolveChatItemDotState(c, ctx), 'thinking');
  });

  test('needs-input beats thinking', () => {
    const ctx = {
      activeChatId: 'chat-a',
      streaming: true,
      streamingChatId: 'chat-a',
      streamPhase: 'thinking',
      inputPendingChatId: 'chat-a',
    };
    assert.equal(resolveChatItemDotState(chat({}), ctx), 'needs-input');
  });

  test('needs-input beats unread when both apply to the active chat', () => {
    const ctx = {
      activeChatId: 'chat-a',
      streaming: true,
      streamingChatId: 'chat-a',
      streamPhase: null,
      inputPendingChatId: 'chat-a',
    };
    assert.equal(
      resolveChatItemDotState(chat({ id: 'chat-a', unread: true }), ctx),
      'needs-input',
    );
  });
});
