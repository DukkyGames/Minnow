/**
 * UI-only transcript rows (`injection`, `context`) must never reach a provider.
 *
 * P6 routes chat through `runTurn({ seedKind: 'continue' })`, which reads prior
 * messages straight off `chat.history` instead of `buildApiMessages`. A stored
 * `role: 'injection'` notice went out verbatim and every completion failed with
 * HTTP 400 (unknown role). Both model-facing views of `chat.history` must drop
 * those rows, and must drop the same ones — `runTurn` aligns its suffix persist
 * on `store.load().messages.length`, so a filtered array against an unfiltered
 * count re-appends or skips rows.
 */

import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { Chat, Message } from '../../src/types.ts';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { createSessionTranscriptStore } from '../../src/agents/session-transcript-store.ts';
import { overlayMultimodalHistoryForRunTurn } from '../../src/chat/build-api-messages.ts';

const CHAT_ID = '22222222-2222-2222-2222-222222222222';

/** History with a brain-notes injection and a context notice between real turns. */
function makeChatWithNotices(): Chat {
  const chat = createEmptyChatObject('m1');
  chat.id = CHAT_ID;
  chat.history = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'ok' },
    {
      role: 'injection',
      kind: 'brain-notes',
      body: '<<<UNTRUSTED_SOURCE_DATA source="memory">>>\nnotes',
      createdAt: 1,
    },
    {
      role: 'context',
      policy: 'trim',
      droppedTurns: 2,
      createdAt: 2,
    },
    { role: 'user', content: 'second' },
  ] as Message[];
  chat.historyLoaded = true;
  return chat;
}

function install(chat: Chat): void {
  setSessionStateForTests({
    version: 3,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
}

describe('UI-only transcript rows are not model-facing', () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('transcript store load drops injection and context rows', () => {
    const chat = makeChatWithNotices();
    install(chat);

    const loaded = createSessionTranscriptStore().load(CHAT_ID);
    const roles = (loaded?.messages ?? []).map((m) => (m as Message).role);

    assert.deepEqual(roles, ['user', 'assistant', 'user']);
    // The rows stay on the chat — they are UI history, just not outbound.
    assert.equal(chat.history.length, 5);
  });

  test('multimodal overlay drops the same rows, so persist stays aligned', () => {
    const chat = makeChatWithNotices();
    install(chat);

    const overlay = overlayMultimodalHistoryForRunTurn(chat, {
      modelId: 'm1',
      vision: false,
      attachments: [],
    });
    const store = createSessionTranscriptStore();

    assert.deepEqual(
      overlay.map((m) => m.role),
      ['user', 'assistant', 'user'],
    );
    // `runTurn` computes its persist offset from the store count while sending
    // this array; a mismatch here silently duplicates or drops persisted rows.
    assert.equal(overlay.length, store.load(CHAT_ID)?.messages.length);
  });

  test('a history with no notices is passed through unchanged', () => {
    const chat = createEmptyChatObject('m1');
    chat.id = CHAT_ID;
    chat.history = [
      { role: 'user', content: 'only' },
      { role: 'assistant', content: 'reply' },
    ] as Message[];
    chat.historyLoaded = true;
    install(chat);

    assert.equal(createSessionTranscriptStore().load(CHAT_ID)?.messages.length, 2);
    assert.equal(overlayMultimodalHistoryForRunTurn(chat, { attachments: [] }).length, 2);
  });
});
