import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  cancelSubAgent,
  getSubAgentRun,
  resetSubAgentOrchestrator,
  spawnSubAgent,
  waitForSubAgent,
} from '../../src/agents/orchestrator.ts';
import {
  resetSubAgentConfigCache,
  setRuntimeSubAgentOverrides,
} from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import {
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} from '../../src/agents/sub-agent-runner.ts';
import {
  createMockSubAgentRunner,
  FIXED_RUN_ID,
  nextFixedRunId,
  resetRunIdCounter,
} from './test-helpers.mts';

describe('orchestrator cancel', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    resetRunIdCounter();
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 5000 }));
  });

  test('cancel running run sets cancelled and frees slot', async () => {
    await spawnSubAgent({ type: 'explore', task: 'long task', wait: false });

    const cancelled = cancelSubAgent(FIXED_RUN_ID, 'test');
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.status, 'cancelled');

    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(run?.status, 'cancelled');
    assert.equal(run?.cancelled, true);
  });

  test('queued run can be cancelled before start', async () => {
    setRuntimeSubAgentOverrides({ globalMaxConcurrent: 1 });
    setSubAgentRunIdFactory(() => nextFixedRunId());
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 5000 }));

    await spawnSubAgent({ type: 'explore', task: 'first', wait: false });
    const second = await spawnSubAgent({ type: 'explore', task: 'second', wait: false });

    const cancelled = cancelSubAgent(second.runId, 'queued_cancel');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(getSubAgentRun(second.runId)?.status, 'cancelled');
  });

  test('waitForSubAgent rejects with AbortError on signal abort instead of resolving with the cancelled aggregate', async () => {
    await spawnSubAgent({ type: 'explore', task: 'long task', wait: false });

    const controller = new AbortController();
    const waitPromise = waitForSubAgent(FIXED_RUN_ID, controller.signal);
    controller.abort();

    // Before the fail-before-cancel fix, cancelSubAgent's synchronous settle
    // resolved this wait with a cancelled aggregate first, making the reject
    // a no-op — callers relying on AbortError (e.g. Super Plan's review-stage
    // timeout) never saw it.
    await assert.rejects(
      waitPromise,
      (err: unknown) => err instanceof Error && err.name === 'AbortError',
    );

    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(run?.status, 'cancelled');
    assert.equal(run?.error, 'parent_abort');
  });

  test('spawn-level timeoutMs override arms the run timer instead of the (much longer) type default', async () => {
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 5000 }));

    // "explore" ships with a 300000ms default — the override must win.
    const spawned = await spawnSubAgent({
      type: 'explore',
      task: 'long task',
      wait: false,
      timeoutMs: 30,
    });

    const deadline = Date.now() + 2000;
    let run = getSubAgentRun(spawned.runId);
    while (run && run.status === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      run = getSubAgentRun(spawned.runId);
    }

    assert.equal(run?.status, 'cancelled');
    assert.equal(run?.error, 'timeout');
  });
});
