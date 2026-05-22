import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  buildAggregateResult,
  formatAggregateResult,
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
import { createMockSubAgentRunner, FIXED_RUN_ID } from './test-helpers.mts';

const EXPECTED_SHAPE = `{
  "runId": "11111111-1111-1111-1111-111111111111",
  "type": "explore",
  "status": "completed",
  "summary": "FIXED_SUMMARY",
  "startedAt": null,
  "endedAt": null,
  "toolTurns": 0,
  "cancelled": false,
  "terminalReason": "success"
}`;

describe('orchestrator aggregate', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    setSubAgentRunnerFactory(() => createMockSubAgentRunner());
  });

  test('mock runner aggregate JSON static shape (timestamps nulled)', async () => {
    const result = await spawnSubAgent({
      type: 'explore',
      task: 'static test',
      wait: true,
    });

    if (!('summary' in result)) {
      assert.fail('expected aggregate');
    }

    const forCompare = { ...result, startedAt: null, endedAt: null };
    const json = formatAggregateResult(forCompare);
    assert.equal(json, EXPECTED_SHAPE);
  });

  test('buildAggregateResult includes error when set', () => {
    const agg = buildAggregateResult({
      runId: FIXED_RUN_ID,
      type: 'explore',
      task: 't',
      status: 'failed',
      parentChatId: null,
      parentToolCallId: null,
      parentTurnId: null,
      summary: '',
      error: 'boom',
      startedAt: '2026-05-19T12:00:00.000Z',
      endedAt: '2026-05-19T12:01:00.000Z',
      toolTurns: 0,
      cancelled: false,
      messages: [],
    });
    assert.equal(agg.error, 'boom');
  });
});
