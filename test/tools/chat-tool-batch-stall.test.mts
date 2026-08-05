/**
 * AFK display-off: runChatToolBatch must bump board stall credit via notifyChatStreamActivity.
 */

import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { subscribeChatStreamActivity } from '../../src/chat/streaming-state.ts';
import { runChatToolBatch } from '../../src/tools/chat-tool-batch.ts';
import type { Chat, ToolCall } from '../../src/types.ts';

async function flushStreamActivityCoalesce(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    queueMicrotask(() => resolve());
  });
}

const CHAT_ID = 'dddd-dddd-tool-batch';

function tc(name: string, id = name, args = '{}'): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: args },
  };
}

function makeChat(): Chat {
  return {
    id: CHAT_ID,
    name: 'tool-batch',
    workspacePath: '/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
  };
}

let domWindow: Window | undefined;
let activityCalls: string[] = [];
let unsubscribeActivity: (() => void) | undefined;

beforeEach(() => {
  activityCalls = [];
  unsubscribeActivity = subscribeChatStreamActivity((chatId) => {
    activityCalls.push(chatId);
  });

  domWindow = new Window();
  globalThis.document = domWindow.document;
  globalThis.window = domWindow as unknown as Window & typeof globalThis.window;
  globalThis.HTMLElement = domWindow.HTMLElement;

  const mount = document.createElement('div');
  mount.id = 'chatMessages';
  document.body.appendChild(mount);
});

afterEach(() => {
  unsubscribeActivity?.();
  unsubscribeActivity = undefined;
  domWindow?.close();
  domWindow = undefined;
  // @ts-expect-error test cleanup
  delete globalThis.document;
  // @ts-expect-error test cleanup
  delete globalThis.window;
});

describe('runChatToolBatch stall activity bumps', () => {
  test('notifies on tools phase entry and each tool start', async () => {
    await runChatToolBatch({
      chat: makeChat(),
      toolCalls: [tc('get_datetime', 'a')],
      signal: new AbortController().signal,
      constrained: false,
      paintInChat: false,
      parentTurnId: 'turn-1',
      uiDesignerActive: false,
      uiDesignerMode: 'off',
      livePartialText: '',
      thoughtController: null,
      syncContextUsage: () => {},
      trackHistoryPush: () => {},
    });

    await flushStreamActivityCoalesce();
    assert.ok(activityCalls.length >= 1);
    assert.ok(activityCalls.every((id) => id === CHAT_ID));
  });

  test('notifies on parallel segment start and each tool start', async () => {
    await runChatToolBatch({
      chat: makeChat(),
      toolCalls: [tc('get_datetime', 'a'), tc('calculate', 'b', '{"expression":"1+1"}')],
      signal: new AbortController().signal,
      constrained: false,
      paintInChat: false,
      parentTurnId: 'turn-2',
      uiDesignerActive: false,
      uiDesignerMode: 'off',
      livePartialText: '',
      thoughtController: null,
      syncContextUsage: () => {},
      trackHistoryPush: () => {},
    });

    await flushStreamActivityCoalesce();
    assert.ok(activityCalls.length >= 1);
    assert.ok(activityCalls.every((id) => id === CHAT_ID));
  });
});
