/**
 * waitForEngineTurnIdle — used by secondary callers that must not double-drive.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { Chat } from '../../src/types.ts';
import {
  dispatchSendMessage,
  waitForEngineTurnIdle,
} from '../../src/state/session-commands.ts';
import {
  scheduleSaveSessions,
  sessionState,
  setSessionStateForTests,
  touchChat,
} from '../../src/state/sessions.ts';
import { setStorageModeForTests } from '../../src/config/storage-mode.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const STARTED = 1710000000000;

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 't',
    workspacePath: '',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: STARTED,
    ...overrides,
  };
}

function installChat(chat: Chat): void {
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
}

describe('waitForEngineTurnIdle', () => {
  afterEach(() => {
    setSessionStateForTests(null);
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
    setStorageModeForTests('localStorage');
  });

  test('resolves when engineTurnActive clears after being busy', async () => {
    const chat = makeChat({ engineTurnActive: true });
    installChat(chat);

    const wait = waitForEngineTurnIdle(CHAT_ID, { timeoutMs: 2000 });
    setTimeout(() => {
      chat.engineTurnActive = false;
    }, 40);
    await wait;
    assert.equal(chat.engineTurnActive, false);
  });

  test('assumeStarted resolves after miss-busy grace when never marked active', async () => {
    const chat = makeChat();
    installChat(chat);
    const started = Date.now();
    await waitForEngineTurnIdle(CHAT_ID, {
      assumeStarted: true,
      timeoutMs: 2000,
      missBusyGraceMs: 80,
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 70, `expected grace wait, got ${elapsed}ms`);
  });

  test('resolves when currentGenerationId clears', async () => {
    const chat = makeChat({
      engineTurnActive: false,
      currentGenerationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    installChat(chat);

    const wait = waitForEngineTurnIdle(CHAT_ID, { timeoutMs: 2000 });
    setTimeout(() => {
      chat.currentGenerationId = undefined;
    }, 40);
    await wait;
    assert.equal(chat.currentGenerationId, undefined);
  });

  test('dispatchSendMessage flushes debounced session save before POST', async () => {
    setStorageModeForTests('server');
    const chat = makeChat();
    installChat(chat);

    const order: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/config/sessions') && method === 'PATCH') {
        order.push('patch');
        return new Response(JSON.stringify({ rev: 2 }), { status: 200 });
      }
      if (url.includes('/api/session/commands') && method === 'POST') {
        order.push('command');
        return new Response(JSON.stringify({ rev: 3, accepted: true }), {
          status: 202,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    touchChat(chat);
    scheduleSaveSessions();
    await dispatchSendMessage({ chatId: chat.id, text: 'hello' });
    assert.deepEqual(order, ['patch', 'command']);
  });

  test('dispatchSendMessage upserts client-only chats before POST', async () => {
    setStorageModeForTests('server');
    const known = makeChat();
    installChat(known);

    const orphan = makeChat({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' });
    if (!sessionState) throw new Error('sessionState missing');
    sessionState.chats.unshift(orphan);
    sessionState.activeId = orphan.id;

    const order: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/config/sessions') && method === 'PATCH') {
        order.push('patch');
        return new Response(JSON.stringify({ rev: 2 }), { status: 200 });
      }
      if (url.includes('/api/session/commands') && method === 'POST') {
        order.push('command');
        return new Response(JSON.stringify({ rev: 3, accepted: true }), {
          status: 202,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await dispatchSendMessage({ chatId: orphan.id, text: 'hello' });
    assert.deepEqual(order, ['patch', 'command']);
  });
});
