import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  getSubAgentRun,
  resetSubAgentOrchestrator,
  spawnSubAgent,
} from '../../src/agents/orchestrator.ts';
import { resetSubAgentConfigCache, setRuntimeSubAgentOverrides } from '../../src/agents/sub-agent-config.ts';
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

describe('orchestrator spawn', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    resetRunIdCounter();
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 30 }));
    setSubAgentRunIdFactory(() => nextFixedRunId());
  });

  test('spawn returns runId and completes with mock runner', async () => {
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    const result = await spawnSubAgent({
      type: 'explore',
      task: 'find files',
      wait: true,
    });

    if (!('summary' in result)) {
      assert.fail('expected aggregate result');
    }
    assert.equal(result.runId, FIXED_RUN_ID);
    assert.equal(result.status, 'completed');
    assert.equal(result.summary, 'FIXED_SUMMARY');
  });

  test('respects globalMaxConcurrent and queues excess', async () => {
    setRuntimeSubAgentOverrides({ globalMaxConcurrent: 1 });
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 200 }));

    const first = await spawnSubAgent({
      type: 'explore',
      task: 'task one',
      wait: false,
    });
    const second = await spawnSubAgent({
      type: 'explore',
      task: 'task two',
      wait: false,
    });

    assert.equal(first.status, 'running');
    assert.equal(second.status, 'queued');

    const run2 = getSubAgentRun(second.runId);
    assert.equal(run2?.status, 'queued');
  });
});
