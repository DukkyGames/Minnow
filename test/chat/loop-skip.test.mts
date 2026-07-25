import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { skipActiveLoop } from '../../src/chat/loop/skip.ts';
import { pauseActiveLoop } from '../../src/chat/loop/pause.ts';
import { runLoopTick } from '../../src/chat/loop/ticker.ts';
import {
  addActiveLoop,
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  getActiveLoops,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const FIXED_NOW = 1_700_000_000_000;
const CHAT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function seedChat() {
  const chat = createEmptyChatObject('m1');
  chat.id = CHAT_ID;
  setSessionStateForTests({
    version: 3,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return chat;
}

describe('loop skip', () => {
  afterEach(() => {
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('skip sets dueAt to now for running loops', () => {
    const chat = seedChat();
    addActiveLoop(chat, {
      promptText: 'check deploy',
      kind: 'interval',
      intervalMs: 120_000,
      dueAt: FIXED_NOW + 45_000,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });

    skipActiveLoop(chat, 1, FIXED_NOW);
    const loop = getActiveLoops(chat)[0];
    assert.equal(loop.dueAt, FIXED_NOW);
    assert.equal(loop.paused, false);
  });

  test('skip unpauses and marks due immediately', () => {
    const chat = seedChat();
    addActiveLoop(chat, {
      promptText: 'paused',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW + 30_000,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    pauseActiveLoop(chat, 1, FIXED_NOW);

    skipActiveLoop(chat, 1, FIXED_NOW + 5_000);
    const loop = getActiveLoops(chat)[0];
    assert.equal(loop.paused, false);
    assert.equal(loop.pausedRemainingMs, undefined);
    assert.equal(loop.dueAt, FIXED_NOW + 5_000);
  });

  test('ticker fires immediately after skip', async () => {
    const chat = seedChat();
    addActiveLoop(chat, {
      promptText: 'run now',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW + 120_000,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });

    skipActiveLoop(chat, 1, FIXED_NOW);

    let sent = '';
    const result = await runLoopTick({
      now: FIXED_NOW,
      chats: [chat],
      isIdle: () => true,
      syncHint: false,
      send: async (_chat, text) => {
        sent = text;
      },
      reportStatus: () => undefined,
    });

    assert.equal(result.fired, 1);
    assert.equal(sent, 'run now');
    assert.equal(getActiveLoops(chat)[0].runCount, 1);
  });
});
