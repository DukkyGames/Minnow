/**
 * Sub-agent max tool turn outcome detection.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isMaxToolTurnFailure,
  isMaxToolTurnSummary,
  isSubAgentRunSuccessful,
  SUB_AGENT_MAX_TOOL_TURNS_ERROR,
} from '../../src/agents/sub-agent-outcome.ts';
import type { SubAgentRun } from '../../src/agents/types.ts';

function minimalRun(overrides: Partial<SubAgentRun>): SubAgentRun {
  return {
    runId: 'run-1',
    type: 'explore',
    task: 't',
    status: 'completed',
    parentChatId: null,
    parentToolCallId: null,
    parentTurnId: null,
    summary: '',
    error: null,
    startedAt: null,
    endedAt: null,
    toolTurns: 0,
    maxToolTurns: 8,
    cancelled: false,
    messages: [],
    ...overrides,
  };
}

describe('sub-agent-outcome', () => {
  test('isMaxToolTurnSummary matches exhaustion summary', () => {
    assert.equal(
      isMaxToolTurnSummary('Sub-agent reached maximum tool turns (8).'),
      true,
    );
    assert.equal(isMaxToolTurnSummary('FIXED_SUMMARY'), false);
  });

  test('isMaxToolTurnFailure uses error and summary', () => {
    assert.equal(isMaxToolTurnFailure('', SUB_AGENT_MAX_TOOL_TURNS_ERROR), true);
    assert.equal(
      isMaxToolTurnFailure('Sub-agent reached maximum tool turns (4).', null),
      true,
    );
    assert.equal(isMaxToolTurnFailure('done', null), false);
  });

  test('isSubAgentRunSuccessful rejects completed max-turn runs', () => {
    assert.equal(
      isSubAgentRunSuccessful(
        minimalRun({
          status: 'completed',
          summary: 'Sub-agent reached maximum tool turns (8).',
        }),
      ),
      false,
    );
    assert.equal(
      isSubAgentRunSuccessful(
        minimalRun({ status: 'failed', summary: 'Sub-agent reached maximum tool turns (8).' }),
      ),
      false,
    );
    assert.equal(
      isSubAgentRunSuccessful(minimalRun({ status: 'completed', summary: 'All done.' })),
      true,
    );
  });
});
