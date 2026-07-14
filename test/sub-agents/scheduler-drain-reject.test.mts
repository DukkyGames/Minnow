/**
 * drainQueue must survive a loadSubAgentConfig rejection: the failure is logged
 * (not an unhandled rejection), the queue is retained, and the next drain —
 * e.g. on slot release — still dispatches the queued run.
 *
 * Run with --experimental-test-module-mocks (mock.module).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import type { RunInternals } from '../../src/agents/controller/types.ts';

let configLoadCalls = 0;
let failNextConfigLoad = false;

mock.module('../../src/agents/sub-agent-config.ts', {
  namedExports: {
    loadSubAgentConfig: async () => {
      configLoadCalls += 1;
      if (failNextConfigLoad) {
        failNextConfigLoad = false;
        throw new Error('config load boom');
      }
      return {
        globalMaxConcurrent: 4,
        types: { worker: { maxConcurrent: 2 } },
      };
    },
  },
});

const scheduler = await import('../../src/agents/controller/scheduler.ts');
const registry = await import('../../src/agents/controller/registry.ts');

const RUN_ID = '99999999-9999-9999-9999-999999999999';

function makeQueuedInternals(runId: string): RunInternals {
  return {
    run: {
      runId,
      type: 'worker',
      task: 'do the thing',
      status: 'queued',
      parentChatId: null,
      parentToolCallId: null,
      parentTurnId: null,
      summary: '',
      error: null,
      startedAt: null,
      endedAt: null,
      toolTurns: 0,
      maxToolTurns: 10,
      cancelled: false,
      messages: [],
    },
    abort: new AbortController(),
    timeoutId: null,
    nudgeTimeoutId: null,
    toolCallLog: [],
    queued: true,
    holdsConcurrencySlot: false,
  };
}

const unhandledRejections: unknown[] = [];
function onUnhandledRejection(err: unknown): void {
  unhandledRejections.push(err);
}

async function settle(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  process.env.MINNOW_TEST = '1';
  configLoadCalls = 0;
  failNextConfigLoad = false;
  unhandledRejections.length = 0;
  process.on('unhandledRejection', onUnhandledRejection);
  scheduler.clearScheduler();
  registry.clearRegistry();
});

afterEach(() => {
  process.removeListener('unhandledRejection', onUnhandledRejection);
  scheduler.clearScheduler();
  registry.clearRegistry();
});

describe('drainQueue config-load rejection', () => {
  test('rejection is contained and a later drain still dispatches the queued run', async () => {
    const dispatched: string[] = [];
    scheduler.setQueueDispatch((internals) => {
      dispatched.push(internals.run.runId);
    });

    registry.registerRun(RUN_ID, makeQueuedInternals(RUN_ID));
    scheduler.enqueueRun(RUN_ID, 'build');

    const errorSpy = mock.method(console, 'error', () => {});
    try {
      failNextConfigLoad = true;
      scheduler.drainQueue();
      await settle();

      assert.equal(configLoadCalls, 1, 'config load attempted');
      assert.equal(dispatched.length, 0, 'failed drain must not dispatch');
      assert.equal(unhandledRejections.length, 0, 'rejection must be handled');
      assert.ok(
        errorSpy.mock.calls.some((c) =>
          String(c.arguments[0]).includes('drainQueue config load failed'),
        ),
        'failure must be logged',
      );

      // Queue retained → the next drain (e.g. on slot release) dispatches.
      scheduler.drainQueue();
      await settle();

      assert.equal(configLoadCalls, 2, 'later drain retries the config load');
      assert.deepEqual(dispatched, [RUN_ID], 'queued run dispatched on retry');
      assert.equal(unhandledRejections.length, 0);
    } finally {
      errorSpy.mock.restore();
    }
  });
});
