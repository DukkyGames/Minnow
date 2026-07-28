/**
 * Fake model server — request context, nth counters, missing-report nudges.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createFakeModelServer,
  defaultEmitForContext,
  extractRequestContext,
  isMissingBoardReportNudge,
  pickScenarioEmit,
} from '../../scripts/fake-model-server.mjs';

const BUILD_SEED =
  'Execute this orchestrate task.\n\nTask: W1-A — Greet util\nWhen done, call board_report({ task_id: "W1-A", outcome: "pass", summary: "..." }).';

const NUDGE_BODY = {
  messages: [
    { role: 'user', content: BUILD_SEED },
    { role: 'assistant', content: 'Done.' },
    {
      role: 'user',
      content: [
        'Continue the orchestrate task W1-A — Greet util where you left off.',
        'Your last turn ended without calling board_report, so the board cannot advance.',
        'Continue where you left off and call board_report with pass, fail, or env_blocked when the build phase is complete.',
      ].join('\n'),
    },
  ],
};

function emitHasBoardReport(chunks) {
  return chunks.some((chunk) => chunk.includes('board_report'));
}

describe('fake-model-server', () => {
  test('extractRequestContext detects builder seed and nudge history', () => {
    const seedCtx = extractRequestContext({ messages: [{ role: 'user', content: BUILD_SEED }] });
    assert.deepEqual(seedCtx, { role: 'builder', taskId: 'W1-A' });

    const nudgeCtx = extractRequestContext(NUDGE_BODY);
    assert.equal(nudgeCtx.role, 'builder');
    assert.equal(nudgeCtx.taskId, 'W1-A');
    assert.equal(isMissingBoardReportNudge(NUDGE_BODY), true);
  });

  test('builder nth=0 emits board_report; nth=1 is prose unless nudge', () => {
    const ctx = { role: 'builder', taskId: 'W1-A' };
    assert.equal(emitHasBoardReport(defaultEmitForContext(ctx, 0)), true);
    assert.equal(emitHasBoardReport(defaultEmitForContext(ctx, 1)), false);
  });

  test('pickScenarioEmit returns board_report on missing-report nudge after nth=0', () => {
    const fake = createFakeModelServer();
    fake.reset();
    const ctx = { role: 'builder', taskId: 'W1-A' };

    const first = pickScenarioEmit([], ctx, { messages: [{ role: 'user', content: BUILD_SEED }] });
    assert.equal(emitHasBoardReport(first), true);

    const nudge = pickScenarioEmit([], ctx, NUDGE_BODY);
    assert.equal(emitHasBoardReport(nudge), true);

    fake.reset();
  });

  test('reset clears per-task nth so a second board run gets board_report again', () => {
    const fake = createFakeModelServer();
    fake.reset();
    const ctx = { role: 'builder', taskId: 'W1-A' };
    const body = { messages: [{ role: 'user', content: BUILD_SEED }] };

    assert.equal(emitHasBoardReport(pickScenarioEmit([], ctx, body)), true);
    assert.equal(emitHasBoardReport(pickScenarioEmit([], ctx, body)), false);

    fake.reset();
    assert.equal(emitHasBoardReport(pickScenarioEmit([], ctx, body)), true);
  });
});
