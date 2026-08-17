/**
 * Live execute_command stdout/stderr must count as stream activity so a long
 * but chatty tool does not false-stall the board watchdog.
 */

import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  resetStreamActivityCoalesceForTests,
  subscribeChatStreamActivity,
} from '../../src/chat/streaming-state.ts';
import { notifyProgressFromTerminalChunk } from '../../src/ui/terminal-panel.ts';

const CHAT_ID = 'eeee-eeee-terminal-progress';

async function flushStreamActivityCoalesce(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    queueMicrotask(() => resolve());
  });
}

let domWindow: Window | undefined;
let activityCalls: string[] = [];
let unsubscribeActivity: (() => void) | undefined;

beforeEach(() => {
  activityCalls = [];
  resetStreamActivityCoalesceForTests();
  unsubscribeActivity = subscribeChatStreamActivity((chatId) => {
    activityCalls.push(chatId);
  });

  domWindow = new Window();
  globalThis.document = domWindow.document;
  globalThis.window = domWindow as unknown as Window & typeof globalThis.window;
  globalThis.requestAnimationFrame = (cb) =>
    domWindow!.window.requestAnimationFrame(cb);
});

afterEach(() => {
  unsubscribeActivity?.();
  unsubscribeActivity = undefined;
  resetStreamActivityCoalesceForTests();
  domWindow?.close();
  domWindow = undefined;
  // @ts-expect-error test cleanup
  delete globalThis.document;
  // @ts-expect-error test cleanup
  delete globalThis.window;
});

describe('terminal chunk stall activity', () => {
  test('stdout/stderr chunks notify stream activity for the owning chat', async () => {
    notifyProgressFromTerminalChunk(CHAT_ID, 'running tests...\n');
    notifyProgressFromTerminalChunk(CHAT_ID, 'FAIL src/foo.test.ts\n');
    await flushStreamActivityCoalesce();
    assert.ok(activityCalls.length >= 1);
    assert.ok(activityCalls.every((id) => id === CHAT_ID));
  });

  test('empty chunks do not count as progress', async () => {
    notifyProgressFromTerminalChunk(CHAT_ID, '');
    await flushStreamActivityCoalesce();
    assert.deepEqual(activityCalls, []);
  });
});
