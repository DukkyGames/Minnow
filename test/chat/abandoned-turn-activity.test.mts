/**
 * A setup throw after the activity row is emitted must not leave the chat
 * "running" forever in the agent activity panel.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import type { Attachment, Chat } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function installDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.performance = window.performance;
  globalThis.localStorage = window.localStorage;
  globalThis.window = window as unknown as Window & typeof globalThis;

  const modelSelect = document.createElement('select');
  modelSelect.id = 'modelSelect';
  const opt = document.createElement('option');
  opt.value = 'm1';
  modelSelect.appendChild(opt);
  modelSelect.value = 'm1';
  document.body.appendChild(modelSelect);

  for (const [id, value] of [
    ['temperature', '0.7'],
    ['maxTokens', '512'],
  ] as const) {
    const input = document.createElement('input');
    input.id = id;
    input.value = value;
    document.body.appendChild(input);
  }

  const systemPrompt = document.createElement('textarea');
  systemPrompt.id = 'systemPrompt';
  document.body.appendChild(systemPrompt);

  for (const id of ['chatArea', 'sDot', 'sText']) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
}

function makeChat(): Chat {
  return {
    id: CHAT_ID,
    name: 'stuck-turn',
    workspacePath: '',
    modelId: 'm1',
    history: [{ role: 'user', content: 'hi' }],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1710000000000,
  };
}

describe('runChatTurn abandoned setup', () => {
  afterEach(async () => {
    const { setChatAbort, setStreaming } = await import('../../src/app-state.ts');
    const { endChatTurnSetup } = await import('../../src/chat/chat-turn-guard.ts');
    const { setSessionStateForTests } = await import('../../src/state/sessions.ts');
    setChatAbort(CHAT_ID, null);
    setStreaming(false, CHAT_ID);
    endChatTurnSetup(CHAT_ID);
    setSessionStateForTests(null);
  });

  test('releases activity row, abort handle and streaming flag when setup throws', async () => {
    installDom();

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/models/cached')) return Response.json({ models: [] });
      if (url.includes('/api/models/serve')) return Response.json({ serves: [] });
      if (url.includes('/api/memory/')) return Response.json({ enabled: false });
      return Response.json({});
    };

    const { setSessionStateForTests } = await import('../../src/state/sessions.ts');
    const chat = makeChat();
    setSessionStateForTests({
      version: 2,
      activeId: CHAT_ID,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const { getChatAbort } = await import('../../src/app-state.ts');
    const { getMainTurnActivity } = await import('../../src/chat/main-turn-activity.ts');
    const { isChatStreaming } = await import('../../src/chat/streaming-state.ts');
    const { runChatTurn } = await import('../../src/chat/run-turn-chat.ts');

    /*
     * `pushUser: false` leaves the outbound-prompt build (well after the activity
     * row is emitted, well before the streaming try/finally) as the first read of
     * an attachment's workspacePath — a throwing getter lands the failure there.
     */
    const explodingAttachment = {
      kind: 'text',
      name: 'boom.txt',
      get workspacePath(): string {
        throw new Error('setup exploded');
      },
    } as unknown as Attachment;

    await assert.rejects(
      runChatTurn({
        chat,
        pushUser: false,
        rawText: 'hi',
        userText: 'hi',
        skillId: null,
        historyContent: 'hi',
        validAttachments: [explodingAttachment],
      }),
      /setup exploded/,
      'the throw must land after the activity row is emitted',
    );

    assert.equal(getMainTurnActivity(CHAT_ID), undefined, 'activity row must be released');
    assert.equal(getChatAbort(CHAT_ID), undefined, 'abort handle must be released');
    assert.equal(isChatStreaming(CHAT_ID), false, 'streaming flag must be released');
  });
});
