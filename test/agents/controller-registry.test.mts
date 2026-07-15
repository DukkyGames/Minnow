/**
 * Sub-agent run registry — browser-safe eviction scheduling.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  clearRegistry,
  registerRun,
  scheduleRunEviction,
} from '../../src/agents/controller/registry.ts';
import type { RunInternals } from '../../src/agents/controller/types.ts';

const RUN_ID = '11111111-1111-1111-1111-111111111111';

function makeTerminalInternals(runId: string): RunInternals {
  return {
    run: {
      runId,
      type: 'worker',
      task: 'done',
      status: 'completed',
      parentChatId: null,
      parentToolCallId: null,
      parentTurnId: null,
      summary: '',
      error: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      toolTurns: 0,
      maxToolTurns: 10,
      cancelled: false,
      messages: [],
    },
    abort: new AbortController(),
    timeoutId: null,
    nudgeTimeoutId: null,
    toolCallLog: [],
    queued: false,
    holdsConcurrencySlot: false,
  };
}

beforeEach(() => {
  delete process.env.MINNOW_TEST;
  clearRegistry();
});

afterEach(() => {
  clearRegistry();
});

describe('controller registry scheduleRunEviction', () => {
  test('does not throw when global process is undefined (renderer)', () => {
    registerRun(RUN_ID, makeTerminalInternals(RUN_ID));
    const saved = globalThis.process;
    try {
      // Simulate Vite/browser bundles where Node's process global is absent.
      Reflect.deleteProperty(globalThis, 'process');
      assert.doesNotThrow(() => scheduleRunEviction(RUN_ID));
    } finally {
      if (saved !== undefined) {
        globalThis.process = saved;
      }
    }
  });

  test('skips scheduling when MINNOW_TEST=1', () => {
    process.env.MINNOW_TEST = '1';
    registerRun(RUN_ID, makeTerminalInternals(RUN_ID));
    assert.doesNotThrow(() => scheduleRunEviction(RUN_ID));
  });
});
