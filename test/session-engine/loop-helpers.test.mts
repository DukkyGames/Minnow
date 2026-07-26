/**
 * Parity helpers for Session Engine loop features (steer / queue / mode).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  consumePendingSteerEngine,
  enqueueComposerMessageEngine,
  executeCreateChatWithModeEngine,
  executeProposeModeSwitchEngine,
  executeSetChatModeEngine,
  isEngineModeTool,
  peekOldestQueuedMessage,
  shiftOldestQueuedMessage,
} from '../../src/session-engine/engine-loop-helpers.ts';

function makeChat(overrides = {}) {
  return {
    id: 'chat-1',
    name: 'Test',
    workspacePath: '/tmp/ws',
    modelId: 'model-a',
    modeId: 'general',
    workAgentAuto: true,
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    ...overrides,
  };
}

describe('session-engine loop helpers (MIN-359)', () => {
  test('consumePendingSteerEngine moves steer into history', () => {
    const chat = makeChat({ pendingSteerMessage: '  fix this  ' });
    const consumed = consumePendingSteerEngine(chat);
    assert.equal(consumed, 'fix this');
    assert.equal(chat.pendingSteerMessage, undefined);
    assert.equal(chat.history.length, 1);
    assert.equal(chat.history[0].role, 'user');
    assert.equal(chat.history[0].steer, true);
    assert.equal(consumePendingSteerEngine(chat), null);
  });

  test('queue enqueue + shift preserves FIFO', () => {
    const chat = makeChat();
    assert.equal(enqueueComposerMessageEngine(chat, 'first'), true);
    assert.equal(enqueueComposerMessageEngine(chat, 'second'), true);
    assert.equal(peekOldestQueuedMessage(chat), 'first');
    assert.equal(shiftOldestQueuedMessage(chat), 'first');
    assert.equal(shiftOldestQueuedMessage(chat), 'second');
    assert.equal(shiftOldestQueuedMessage(chat), null);
    assert.equal(chat.pendingMessageQueue, undefined);
  });

  test('set_chat_mode mutates modeId', () => {
    const chat = makeChat({ modeId: 'general' });
    const result = executeSetChatModeEngine({ mode: 'build' }, chat);
    assert.match(result, /build/);
    assert.equal(chat.modeId, 'build');
  });

  test('propose_mode_switch queues pendingModeId for known situations', () => {
    const chat = makeChat({ modeId: 'plan' });
    const result = executeProposeModeSwitchEngine(
      { situation: 'implement_in_wrong_mode' },
      chat,
    );
    assert.match(result, /build/);
    assert.equal(chat.pendingModeId, 'build');
  });

  test('create_chat_with_mode adds a sibling chat', () => {
    const state = {
      chats: [makeChat()],
      activeChatId: 'chat-1',
    };
    const result = executeCreateChatWithModeEngine(
      { mode: 'orchestrate', name: 'Board chat', activate: true },
      state,
      'chat-1',
    );
    assert.match(result, /Created chat/);
    assert.equal(state.chats.length, 2);
    assert.equal(state.chats[1].modeId, 'orchestrate');
    assert.equal(state.chats[1].name, 'Board chat');
    assert.equal(state.activeChatId, state.chats[1].id);
  });

  test('isEngineModeTool recognizes handoff tools', () => {
    assert.equal(isEngineModeTool('set_chat_mode'), true);
    assert.equal(isEngineModeTool('create_chat_with_mode'), true);
    assert.equal(isEngineModeTool('propose_mode_switch'), true);
    assert.equal(isEngineModeTool('check_reef_widget'), true);
    assert.equal(isEngineModeTool('read_file'), false);
  });
});
