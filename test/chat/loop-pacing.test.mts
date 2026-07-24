import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  clearLoopAwaitingPace,
  clampLoopAutoDelayMs,
  digestLoopOutput,
  markLoopAwaitingPace,
  maybeRescheduleLoopsAfterTurn,
  nextAutoDelayMs,
} from '../../src/chat/loop/pacing.ts';
import {
  INITIAL_LOOP_AUTO_DELAY_MS,
  MAX_LOOP_AUTO_DELAY_MS,
  MIN_LOOP_INTERVAL_MS,
} from '../../src/chat/loop/parse-command.ts';
import {
  addActiveLoop,
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  getActiveLoops,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '22222222-2222-2222-2222-222222222222';
const FIXED_NOW = 1_700_000_000_000;

function seedChat() {
  const chat = createEmptyChatObject('m1');
  chat.id = FIXED_CHAT_ID;
  setSessionStateForTests({
    version: 3,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return chat;
}

describe('loop pacing', () => {
  afterEach(() => {
    clearLoopAwaitingPace(FIXED_CHAT_ID);
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('digest is stable for equivalent whitespace', () => {
    assert.equal(digestLoopOutput('hello   world'), digestLoopOutput('hello world'));
    assert.notEqual(digestLoopOutput('hello world'), digestLoopOutput('hello worlds'));
  });

  test('delay halves on change and doubles on same, with clamps', () => {
    assert.equal(nextAutoDelayMs(120_000, true), 60_000);
    assert.equal(nextAutoDelayMs(60_000, true), MIN_LOOP_INTERVAL_MS);
    assert.equal(nextAutoDelayMs(120_000, false), 240_000);
    assert.equal(
      nextAutoDelayMs(MAX_LOOP_AUTO_DELAY_MS, false),
      MAX_LOOP_AUTO_DELAY_MS,
    );
    assert.equal(clampLoopAutoDelayMs(500), MIN_LOOP_INTERVAL_MS);
    assert.equal(clampLoopAutoDelayMs(99_000_000), MAX_LOOP_AUTO_DELAY_MS);
  });

  test('maybeRescheduleLoopsAfterTurn doubles delay when output unchanged', () => {
    const chat = seedChat();
    const loop = addActiveLoop(chat, {
      promptText: 'ping',
      kind: 'auto',
      currentDelayMs: INITIAL_LOOP_AUTO_DELAY_MS,
      dueAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    const digest = digestLoopOutput('same output');
    chat.activeLoops![0].lastOutputDigest = digest;
    chat.history = [{ role: 'assistant', content: 'same   output' }];
    markLoopAwaitingPace(chat.id, loop.id);

    maybeRescheduleLoopsAfterTurn(chat, FIXED_NOW);

    const updated = getActiveLoops(chat)[0];
    assert.equal(updated.currentDelayMs, INITIAL_LOOP_AUTO_DELAY_MS * 2);
    assert.equal(updated.dueAt, FIXED_NOW + INITIAL_LOOP_AUTO_DELAY_MS * 2);
    assert.equal(updated.lastOutputDigest, digest);
  });

  test('maybeRescheduleLoopsAfterTurn halves delay when output changes', () => {
    const chat = seedChat();
    const loop = addActiveLoop(chat, {
      promptText: 'ping',
      kind: 'auto',
      currentDelayMs: 240_000,
      dueAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    chat.activeLoops![0].lastOutputDigest = digestLoopOutput('old');
    chat.history = [{ role: 'assistant', content: 'new result' }];
    markLoopAwaitingPace(chat.id, loop.id);

    maybeRescheduleLoopsAfterTurn(chat, FIXED_NOW);

    const updated = getActiveLoops(chat)[0];
    assert.equal(updated.currentDelayMs, 120_000);
    assert.equal(updated.dueAt, FIXED_NOW + 120_000);
  });

  test('ignores chats with no pending pace marker', () => {
    const chat = seedChat();
    addActiveLoop(chat, {
      promptText: 'ping',
      kind: 'auto',
      currentDelayMs: 120_000,
      dueAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 7 * 86_400_000,
    });
    chat.history = [{ role: 'assistant', content: 'x' }];
    maybeRescheduleLoopsAfterTurn(chat, FIXED_NOW);
    assert.equal(getActiveLoops(chat)[0].currentDelayMs, 120_000);
  });
});
