import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  isLoopPaused,
  pauseActiveLoop,
  resumeActiveLoop,
} from '../../src/chat/loop/pause.ts';
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

describe('loop pause', () => {
  afterEach(() => {
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('pause freezes remaining time and resume restores dueAt', () => {
    const chat = seedChat();
    addActiveLoop(chat, {
      promptText: 'x',
      kind: 'interval',
      intervalMs: 120_000,
      dueAt: FIXED_NOW + 45_000,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });

    pauseActiveLoop(chat, 1, FIXED_NOW);
    const paused = getActiveLoops(chat)[0];
    assert.equal(paused.paused, true);
    assert.equal(paused.pausedRemainingMs, 45_000);
    assert.equal(isLoopPaused(paused), true);

    resumeActiveLoop(chat, 1, FIXED_NOW + 10_000);
    const resumed = getActiveLoops(chat)[0];
    assert.equal(resumed.paused, false);
    assert.equal(resumed.pausedRemainingMs, undefined);
    assert.equal(resumed.dueAt, FIXED_NOW + 10_000 + 45_000);
  });

  test('ticker skips paused loops even when due', async () => {
    const chat = seedChat();
    addActiveLoop(chat, {
      promptText: 'paused due',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW - 1,
      createdAt: FIXED_NOW - 10_000,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    pauseActiveLoop(chat, 1, FIXED_NOW);

    const result = await runLoopTick({
      now: FIXED_NOW,
      chats: [chat],
      isIdle: () => true,
      syncHint: false,
      send: async () => {
        throw new Error('should not send');
      },
      reportStatus: () => undefined,
    });

    assert.equal(result.fired, 0);
    assert.equal(getActiveLoops(chat)[0].runCount, 0);
  });
});
