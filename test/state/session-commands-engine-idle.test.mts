/**
 * waitForEngineTurnIdle — used by secondary callers that must not double-drive.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { Chat } from '../../src/types.ts';
import { waitForEngineTurnIdle } from '../../src/state/session-commands.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';

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
});
