import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  cancelSubAgent,
  getSubAgentRun,
  resetSubAgentOrchestrator,
  spawnSubAgent,
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
});
