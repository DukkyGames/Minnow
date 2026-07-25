import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  advanceLoopSchedule,
  computeLoopWakeDelayMs,
  findNextLoopWakeAt,
  isLoopDue,
  isLoopExpired,
  runLoopTick,
  startLoopTicker,
  stopLoopTicker,
} from '../../src/chat/loop/ticker.ts';
import { clearLoopAwaitingPace } from '../../src/chat/loop/pacing.ts';
import { MIN_LOOP_INTERVAL_MS } from '../../src/chat/loop/parse-command.ts';
import {
  addActiveLoop,
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  getActiveLoops,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import type { Chat } from '../../src/types.ts';

const FIXED_NOW = 1_700_000_000_000;
const CHAT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CHAT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function seedChats(...chats: Chat[]) {
  setSessionStateForTests({
    version: 3,
    activeId: chats[0]?.id ?? '',
    sidebarCollapsed: false,
    chats,
  });
}

function makeChat(id: string): Chat {
  const chat = createEmptyChatObject('m1');
  chat.id = id;
  return chat;
}

describe('loop ticker', () => {
  afterEach(() => {
    stopLoopTicker();
    clearLoopAwaitingPace(CHAT_A);
    clearLoopAwaitingPace(CHAT_B);
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('isLoopDue / isLoopExpired', () => {
    const loop = {
      id: 1,
      promptText: 'x',
      kind: 'interval' as const,
      intervalMs: 60_000,
      dueAt: FIXED_NOW,
      createdAt: FIXED_NOW - 1000,
      expiresAt: FIXED_NOW + 1000,
      runCount: 0,
    };
    assert.equal(isLoopDue(loop, FIXED_NOW), true);
    assert.equal(isLoopDue(loop, FIXED_NOW - 1), false);
    assert.equal(isLoopExpired(loop, FIXED_NOW + 1001), true);
    assert.equal(isLoopExpired(loop, FIXED_NOW + 1000), false);
  });

  test('advanceLoopSchedule bumps dueAt and runCount', () => {
    const interval = {
      id: 1,
      promptText: 'x',
      kind: 'interval' as const,
      intervalMs: 120_000,
      dueAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
      runCount: 3,
    };
    assert.deepEqual(advanceLoopSchedule(interval, FIXED_NOW), {
      dueAt: FIXED_NOW + 120_000,
      runCount: 4,
    });

    const auto = {
      id: 2,
      promptText: 'y',
      kind: 'auto' as const,
      currentDelayMs: MIN_LOOP_INTERVAL_MS,
      dueAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
      runCount: 0,
    };
    assert.deepEqual(advanceLoopSchedule(auto, FIXED_NOW), {
      dueAt: FIXED_NOW + MIN_LOOP_INTERVAL_MS,
      runCount: 1,
      currentDelayMs: MIN_LOOP_INTERVAL_MS,
    });
  });

  test('fires due loop when idle and advances schedule', async () => {
    const chat = makeChat(CHAT_A);
    addActiveLoop(chat, {
      promptText: 'say hi',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW - 1,
      createdAt: FIXED_NOW - 10_000,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    seedChats(chat);

    const sent: string[] = [];
    const result = await runLoopTick({
      now: FIXED_NOW,
      chats: [chat],
      isIdle: () => true,
      syncHint: false,
      send: async (_c, text) => {
        sent.push(text);
      },
      reportStatus: () => undefined,
    });

    assert.equal(result.fired, 1);
    assert.deepEqual(sent, ['say hi']);
    const loop = getActiveLoops(chat)[0];
    assert.equal(loop.runCount, 1);
    assert.equal(loop.dueAt, FIXED_NOW + 60_000);
  });

  test('skips when not idle (keeps dueAt)', async () => {
    const chat = makeChat(CHAT_A);
    addActiveLoop(chat, {
      promptText: 'say hi',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW - 1,
      createdAt: FIXED_NOW - 10_000,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    seedChats(chat);

    const result = await runLoopTick({
      now: FIXED_NOW,
      chats: [chat],
      isIdle: () => false,
      syncHint: false,
      send: async () => {
        throw new Error('should not send');
      },
      reportStatus: () => undefined,
    });

    assert.equal(result.fired, 0);
    assert.equal(getActiveLoops(chat)[0].dueAt, FIXED_NOW - 1);
    assert.equal(getActiveLoops(chat)[0].runCount, 0);
  });

  test('removes expired loops', async () => {
    const chat = makeChat(CHAT_A);
    addActiveLoop(chat, {
      promptText: 'old',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW - 1,
      createdAt: FIXED_NOW - 8 * 86_400_000,
      expiresAt: FIXED_NOW - 1000,
    });
    seedChats(chat);

    const notes: string[] = [];
    const result = await runLoopTick({
      now: FIXED_NOW,
      chats: [chat],
      isIdle: () => true,
      syncHint: false,
      send: async () => undefined,
      reportStatus: (_level, message) => {
        notes.push(message);
      },
    });

    assert.equal(result.expired, 1);
    assert.equal(result.fired, 0);
    assert.equal(getActiveLoops(chat).length, 0);
    assert.match(notes[0] ?? '', /expired after 7 days/);
  });

  test('one fire per chat per tick', async () => {
    const chat = makeChat(CHAT_A);
    addActiveLoop(chat, {
      promptText: 'first',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW - 100,
      createdAt: FIXED_NOW - 10_000,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    addActiveLoop(chat, {
      promptText: 'second',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW - 50,
      createdAt: FIXED_NOW - 10_000,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    seedChats(chat);

    const sent: string[] = [];
    const result = await runLoopTick({
      now: FIXED_NOW,
      chats: [chat],
      isIdle: () => true,
      syncHint: false,
      send: async (_c, text) => {
        sent.push(text);
      },
      reportStatus: () => undefined,
    });

    assert.equal(result.fired, 1);
    assert.deepEqual(sent, ['first']);
    assert.equal(getActiveLoops(chat)[0].runCount, 1);
    assert.equal(getActiveLoops(chat)[1].runCount, 0);
  });

  test('not-due loops are skipped', async () => {
    const chat = makeChat(CHAT_A);
    addActiveLoop(chat, {
      promptText: 'later',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW + 60_000,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    seedChats(chat);

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
  });

  test('findNextLoopWakeAt ignores paused and expired loops', () => {
    const chat = makeChat(CHAT_A);
    addActiveLoop(chat, {
      promptText: 'paused',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW + 5_000,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    addActiveLoop(chat, {
      promptText: 'due soon',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW + 2_000,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    addActiveLoop(chat, {
      promptText: 'expired',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt: FIXED_NOW - 1,
      createdAt: FIXED_NOW - 8 * 86_400_000,
      expiresAt: FIXED_NOW - 100,
    });
    getActiveLoops(chat)[0].paused = true;

    assert.equal(findNextLoopWakeAt([chat], FIXED_NOW), FIXED_NOW + 2_000);
  });

  test('computeLoopWakeDelayMs returns retry when overdue', () => {
    assert.equal(computeLoopWakeDelayMs(FIXED_NOW + 5_000, FIXED_NOW), 5_000);
    assert.equal(computeLoopWakeDelayMs(FIXED_NOW - 1, FIXED_NOW), 1_000);
  });

  test('wake timer fires when dueAt arrives (not only on 15s poll)', async () => {
    const chat = makeChat(CHAT_A);
    const dueAt = Date.now() + 200;
    addActiveLoop(chat, {
      promptText: 'wake me',
      kind: 'interval',
      intervalMs: 60_000,
      dueAt,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 86_400_000,
    });
    seedChats(chat);

    const sent: string[] = [];
    startLoopTicker({
      intervalMs: 60_000,
      send: async (_c, text) => {
        sent.push(text);
      },
    });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });

    stopLoopTicker();
    assert.deepEqual(sent, ['wake me']);
  });
});
