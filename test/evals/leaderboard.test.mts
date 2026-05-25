/**
 * Leaderboard aggregation unit tests (static fixtures).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeLeaderboard } from '../../src/evals/leaderboard.ts';
import type { EvalCellResult, EvalModelTarget } from '../../src/evals/types.ts';

const targets: EvalModelTarget[] = [
  { providerId: 'lm-studio-local', modelId: 'test-model', label: 'Test' },
];

const cells: EvalCellResult[] = [
  {
    cellId: 'task-a__lm-studio-local__test-model',
    taskId: 'task-a',
    modelKey: 'lm-studio-local__test-model',
    providerId: 'lm-studio-local',
    modelId: 'test-model',
    modelLabel: 'Test',
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:10.000Z',
    durationMs: 10_000,
    summary: 'ok',
    toolTurns: 1,
    grader: { score: 80, pass: true, rationale: 'good' },
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  },
  {
    cellId: 'task-b__lm-studio-local__test-model',
    taskId: 'task-b',
    modelKey: 'lm-studio-local__test-model',
    providerId: 'lm-studio-local',
    modelId: 'test-model',
    modelLabel: 'Test',
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:20.000Z',
    durationMs: 20_000,
    summary: 'ok',
    toolTurns: 0,
    grader: { score: 60, pass: false, rationale: 'weak' },
    usage: { prompt_tokens: 200, completion_tokens: 30 },
  },
];

const EXPECTED_LEADERBOARD = `[{"modelKey":"lm-studio-local__test-model","label":"Test","providerId":"lm-studio-local","modelId":"test-model","meanScore":70,"passRate":0.5,"medianDurationMs":15000,"totalPromptTokens":300,"totalCompletionTokens":80,"failedCells":0,"completedCells":2}]`;

describe('computeLeaderboard', () => {
  it('matches static expected JSON', () => {
    const rows = computeLeaderboard(cells, targets);
    assert.equal(JSON.stringify(rows), EXPECTED_LEADERBOARD);
  });
});
