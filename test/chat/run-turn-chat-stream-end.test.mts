/**
 * P6-D: stream-end order on the runTurn path is setStreaming(false)
 * before notifyChatStreamEnded (PRD §1.3).
 */

import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { Chat } from '../../src/types.ts';
import {
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { endChatTurnSetup } from '../../src/chat/chat-turn-guard.ts';
import { getChatAbort, setChatAbort, setStreaming } from '../../src/app-state.ts';
import { DEFAULT_TITLES_CONFIG, setTitlesConfigForTests } from '../../src/config/titles-meta.ts';
import { notifyChatStreamEnded } from '../../src/chat/streaming-state.ts';
import {
  maybeRunChatTurnViaRunner,
  resetRunTurnForTests,
  setRunTurnChatEndStreamingForTests,
  setRunTurnForTests,
} from '../../src/chat/run-turn-chat.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function installChatDom(): void {
  document.body.replaceChildren();
  const chatArea = document.createElement('div');
  chatArea.id = 'chatArea';
  document.body.appendChild(chatArea);
  const sDot = document.createElement('span');
  sDot.id = 'sDot';
  document.body.appendChild(sDot);
  const sText = document.createElement('span');
  sText.id = 'sText';
  document.body.appendChild(sText);
  const msgInput = document.createElement('textarea');
  msgInput.id = 'msgInput';
  document.body.appendChild(msgInput);
}

function makeChat(): Chat {
  const chat = createEmptyChatObject('m1');
  chat.id = CHAT_ID;
  chat.providerId = 'vite-fallback';
  chat.modelId = 'm1';
  return chat;
}

describe('P6-D stream-end order (MIN-726)', () => {
  afterEach(() => {
    setRunTurnChatEndStreamingForTests(null);
    resetRunTurnForTests();
    getChatAbort(CHAT_ID)?.abort();
    setChatAbort(CHAT_ID, null);
    setStreaming(false, CHAT_ID);
    endChatTurnSetup(CHAT_ID);
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('setStreaming(false) runs before notifyChatStreamEnded', async () => {
    setTitlesConfigForTests({ ...DEFAULT_TITLES_CONFIG, enabled: false });
    installChatDom();
    const order: string[] = [];
    setRunTurnChatEndStreamingForTests({
      setStreaming: (value, chatId) => {
        if (value === false) order.push('setStreaming(false)');
        setStreaming(value, chatId);
      },
      notifyChatStreamEnded: (chatId) => {
        order.push('notifyChatStreamEnded');
        notifyChatStreamEnded(chatId);
      },
    });
    setRunTurnForTests(async () => ({ outcome: 'no_report' }));

    const chat = makeChat();
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    await maybeRunChatTurnViaRunner({
      chat,
      pushUser: true,
      rawText: 'Hi',
      userText: 'Hi',
      skillId: null,
      historyContent: 'Hi',
      validAttachments: [],
      ownsGlobalStreaming: true,
    });

    assert.deepEqual(order, ['setStreaming(false)', 'notifyChatStreamEnded']);
  });
});
