import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  getSubAgentRun,
  resetSubAgentOrchestrator,
  restartSubAgent,
  spawnSubAgent,
} from '../../src/agents/orchestrator.ts';
import { resetSubAgentConfigCache } from '../../src/agents/sub-agent-config.ts';
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

describe('orchestrator restart', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    resetRunIdCounter();
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 5000 }));
  });

  test('restartSubAgent produces new runId and empty child history', async () => {
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    await spawnSubAgent({ type: 'explore', task: 'original', wait: false });

    setSubAgentRunIdFactory(() => nextFixedRunId());
    const restarted = await restartSubAgent(FIXED_RUN_ID, {
      note: 'Avoid repetition',
    });

    assert.notEqual(restarted.runId, FIXED_RUN_ID);

    const oldRun = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(oldRun?.status, 'cancelled');

    const newRun = getSubAgentRun(restarted.runId);
    assert.ok(newRun);
    assert.equal(newRun?.messages.length, 0);
    assert.ok(newRun?.task.includes('Avoid repetition'));
  });
});
