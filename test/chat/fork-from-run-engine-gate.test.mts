/**
 * forkFromUserIndex must not call renderer runChatTurn when Session Engine is on.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import type { Chat } from '../../src/types.ts';
import { forkFromUserIndex } from '../../src/chat/fork-from-run.ts';
import { setServerEngineFlagForTests } from '../../src/state/server-engine-flag.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const STARTED = 1710000000000;

describe('forkFromUserIndex engine gate', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setServerEngineFlagForTests(null);
    setSessionStateForTests(null);
  });

  test('dispatches send_message with pushUser:false when engine is on', async () => {
    setServerEngineFlagForTests(true);

    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chatArea = document.createElement('div');
    chatArea.id = 'chatArea';
    document.body.appendChild(chatArea);
    const sDot = document.createElement('span');
    sDot.id = 'sDot';
    document.body.appendChild(sDot);
    const sText = document.createElement('span');
    sText.id = 'sText';
    document.body.appendChild(sText);

    const chat: Chat = {
      id: CHAT_ID,
      name: 't',
      workspacePath: '',
      modelId: 'm1',
      providerId: 'p1',
      history: [
        { role: 'user', content: 'Hello fork' },
        { role: 'assistant', content: 'Hi' },
      ],
      lastStats: null,
      modelInfo: {},
      updatedAt: STARTED,
    };
    setSessionStateForTests({
      version: 2,
      activeId: CHAT_ID,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const bodies: unknown[] = [];
    const urls: string[] = [];
    globalThis.fetch = async (input, init) => {
      urls.push(String(input));
      const raw = init?.body != null ? String(init.body) : '';
      if (raw) bodies.push(JSON.parse(raw));
      return new Response(JSON.stringify({ rev: 1, accepted: true }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // Re-assert flag immediately before the call (parallel suites may clear it).
    setServerEngineFlagForTests(true);
    await forkFromUserIndex(CHAT_ID, 0);

    assert.ok(
      bodies.length >= 1,
      `expected send_message body, urls=${JSON.stringify(urls)} bodies=${JSON.stringify(bodies)}`,
    );
    const cmd = bodies.find(
      (b) => (b as { type?: string }).type === 'send_message',
    ) as {
      type: string;
      pushUser?: boolean;
      chatId: string;
      text: string;
    };
    assert.ok(cmd, `send_message missing; urls=${JSON.stringify(urls)}`);
    assert.equal(cmd.pushUser, false);
    assert.equal(cmd.chatId, CHAT_ID);
    assert.equal(cmd.text, 'Hello fork');
  });
});
