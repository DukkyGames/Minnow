/**
 * terminalReason on status payloads for parent orchestration.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildSubAgentStatusPayload,
  deriveSubAgentTerminalReason,
} from '../../src/agents/orchestrator.ts';
import type { SubAgentRun } from '../../src/agents/types.ts';

function run(partial: Partial<SubAgentRun>): SubAgentRun {
  return {
    runId: 'sub-1',
    type: 'explore',
    task: 'task',
    status: 'completed',
    parentChatId: null,
    parentToolCallId: null,
    parentTurnId: null,
    summary: 'done',
    error: null,
    startedAt: null,
    endedAt: null,
    toolTurns: 1,
    maxToolTurns: 12,
    cancelled: false,
    messages: [],
    ...partial,
  };
}

describe('deriveSubAgentTerminalReason', () => {
  test('success for completed run', () => {
    assert.equal(deriveSubAgentTerminalReason(run({ status: 'completed' })), 'success');
  });

  test('max_tool_turns for failed exhaustion', () => {
    assert.equal(
      deriveSubAgentTerminalReason(
        run({
          status: 'failed',
          error: 'maximum tool turns reached',
          summary: 'Sub-agent reached maximum tool turns (8).',
        }),
      ),
      'max_tool_turns',
    );
  });

  test('cancelled for cancelled run', () => {
    assert.equal(deriveSubAgentTerminalReason(run({ status: 'cancelled' })), 'cancelled');
  });

  test('payload includes terminalReason when terminal', () => {
    const payload = buildSubAgentStatusPayload(
      run({ status: 'failed', error: 'maximum tool turns reached', summary: '' }),
    );
    assert.equal(payload.terminalReason, 'max_tool_turns');
    assert.equal(payload.success, false);
  });
});
