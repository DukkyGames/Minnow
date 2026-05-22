/**
 * report_orchestrator_status validation and stamping.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { executeReportOrchestratorStatus } from '../../src/agents/supervisor/report-tool.ts';
import { getSupervisorChatState, resetSupervisorStateForTests } from '../../src/agents/supervisor/state.ts';

describe('executeReportOrchestratorStatus', () => {
  test('rejects invalid payload', async () => {
    const text = await executeReportOrchestratorStatus({}, 'c1');
    assert.match(text, /error/);
  });

  test('stamps lastReportAt on valid payload', async () => {
    resetSupervisorStateForTests();
    const chatId = '33333333-3333-3333-3333-333333333333';
    const text = await executeReportOrchestratorStatus(
      {
        phase: 'x',
        next_action: 'go',
        active_tasks: ['A'],
        blocked_tasks: [],
        confidence: 0.2,
      },
      chatId,
    );
    assert.match(text, /warning|instruct|ok/);
    const sup = getSupervisorChatState(chatId);
    assert.ok(sup.lastReportAt);
    assert.equal(sup.lastReport?.phase, 'x');
  });
});
