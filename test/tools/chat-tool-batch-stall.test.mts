/**
 * AFK display-off: runChatToolBatch must bump board stall credit via notifyChatStreamActivity.
 */

import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { subscribeChatStreamActivity } from '../../src/chat/streaming-state.ts';
import { runChatToolBatch } from '../../src/tools/chat-tool-batch.ts';
import { renderToolCall } from '../../src/ui/tool-messages.ts';
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

describe('runChatToolBatch remount after a mid-batch chat switch (MIN-649)', () => {
  test('renders the result into the row history redrew, not the stranded one', async () => {
    const chat = makeChat();
    const mount = document.getElementById('chatMessages')!;

    let stranded: HTMLElement | undefined;
    let redrawn: HTMLElement | undefined;

    await runChatToolBatch({
      chat,
      toolCalls: [tc('get_datetime', 'call-1')],
      signal: new AbortController().signal,
      constrained: false,
      paintInChat: true,
      parentTurnId: 'turn-switch',
      uiDesignerActive: false,
      uiDesignerMode: 'off',
      livePartialText: '',
      thoughtController: null,
      syncContextUsage: () => {},
      trackHistoryPush: () => {},
      ensureToolWrap: (toolName, args, toolCallId) => {
        stranded = renderToolCall(toolName, args);
        stranded.dataset.toolCallId = toolCallId;
        mount.appendChild(stranded);

        /*
         * Switch away and back before the result lands: the transcript is
         * rebuilt from history, so the node the batch captured is stranded and
         * a fresh row carries the same tool_call_id.
         */
        mount.innerHTML = '';
        redrawn = renderToolCall(toolName, args);
        redrawn.dataset.toolCallId = toolCallId;
        mount.appendChild(redrawn);

        return stranded;
      },
    });

    assert.ok(stranded);
    assert.ok(redrawn);
    assert.equal(stranded.isConnected, false);
    assert.equal(redrawn.isConnected, true);
    // The result must fill in the row that is actually on screen.
    const redrawnBody = redrawn.querySelector<HTMLElement>('.tool-call-body');
    const strandedBody = stranded.querySelector<HTMLElement>('.tool-call-body');
    assert.equal(redrawnBody?.dataset.resultRendered, 'true');
    assert.notEqual(strandedBody?.dataset.resultRendered, 'true');
    assert.equal(chat.history.filter((m) => m.role === 'tool').length, 1);
  });
});
