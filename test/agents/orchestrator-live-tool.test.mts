/**
 * Sub-agent liveCurrentToolName is set on nested tool invoke.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  getSubAgentRun,
  recordToolCallForRun,
  resetSubAgentOrchestrator,
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
} from '../sub-agents/test-helpers.mts';

describe('orchestrator liveCurrentToolName', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 5000 }));
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
  });

  test('recordToolCallForRun sets liveCurrentToolName', async () => {
    await spawnSubAgent({
      type: 'explore',
      task: 'Find auth code',
      wait: false,
      parentChatId: '11111111-1111-1111-1111-111111111111',
      parentTurnId: 'turn-test-1',
    });
    recordToolCallForRun(FIXED_RUN_ID, 'Grep', { pattern: 'auth' });
    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.equal(run?.liveCurrentToolName, 'Grep');
  });
});
