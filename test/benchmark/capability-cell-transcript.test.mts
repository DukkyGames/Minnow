import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BenchmarkCampaign } from '../../src/benchmark/campaign-types.ts';
import type { BenchmarkRun } from '../../src/benchmark/types.ts';
import {
  capabilityCellHasTranscriptDrillDown,
  findLatestCapabilityProbeResult,
  resolveCapabilityProbeLookup,
} from '../../src/benchmark/capabilities/cell-transcript.ts';

const TARGET_KEY = 'openai::gpt-test';
const CAP_ID = 'core-streaming';

function matrixRun(verdict: 'pass' | 'fail', startedAt: string): BenchmarkRun {
  return {
    id: 'run-1',
    startedAt,
    durationMs: 1,
    preset: 'custom',
    provider: { id: 'openai', baseUrl: 'http://127.0.0.1' },
    model: { id: 'gpt-test' },
    totalScore: 0,
    headlineTokPerSec: 0,
    headlineTtftMs: 0,
    modeMatrixPassed: 0,
    toolsPassed: 0,
    skillsPassed: 0,
    suites: [
      {
        id: 'capability-matrix',
        label: 'Capability matrix',
        passed: verdict === 'pass' ? 1 : 0,
        failed: verdict === 'pass' ? 0 : 1,
        skipped: 0,
        score: 1,
        tests: [
          {
            testId: `cap-matrix/${CAP_ID}`,
            suite: 'capability-matrix',
            label: CAP_ID,
            passed: verdict === 'pass',
            skipped: false,
            durationMs: 1,
            score: verdict === 'pass' ? 1 : 0,
            verdict,
            details: verdict === 'fail' ? 'stream stalled' : undefined,
          },
        ],
      },
    ],
  };
}

function campaignWithRuns(
  runs: BenchmarkRun[],
  id: string,
  endedAt: string,
): BenchmarkCampaign {
  return {
    id,
    startedAt: '2026-06-01T00:00:00.000Z',
    endedAt,
    durationMs: 1,
    preset: 'custom',
    targets: [{ providerId: 'openai', modelId: 'gpt-test' }],
    suites: [{ family: 'integration', id: 'capability-matrix' }],
    status: 'completed',
    cells: [],
    aggregates: [],
    runs,
    kind: 'capability-matrix',
  };
}

describe('capability cell transcript lookup', () => {
  test('findLatestCapabilityProbeResult picks newest campaign', () => {
    const older = campaignWithRuns(
      [matrixRun('pass', '2026-06-01T00:00:00.000Z')],
      'old',
      '2026-06-01T00:00:00.000Z',
    );
    const newer = campaignWithRuns(
      [matrixRun('fail', '2026-06-01T12:00:00.000Z')],
      'new',
      '2026-06-03T00:00:00.000Z',
    );
    const lookup = findLatestCapabilityProbeResult([older, newer], TARGET_KEY, CAP_ID);
    assert.ok(lookup);
    assert.equal(lookup.campaignId, 'new');
    assert.equal(lookup.test.verdict, 'fail');
  });

  test('capabilityCellHasTranscriptDrillDown when probe data exists', () => {
    const lookup = findLatestCapabilityProbeResult(
      [campaignWithRuns([matrixRun('fail', '2026-06-01T00:00:00.000Z')], 'c1', '2026-06-02T00:00:00.000Z')],
      TARGET_KEY,
      CAP_ID,
    );
    assert.equal(capabilityCellHasTranscriptDrillDown(lookup), true);
    assert.equal(capabilityCellHasTranscriptDrillDown(null), false);
  });

  test('resolveCapabilityProbeLookup prefers in-flight probe', () => {
    const passLookup = findLatestCapabilityProbeResult(
      [campaignWithRuns([matrixRun('pass', '2026-06-01T00:00:00.000Z')], 'c1', '2026-06-02T00:00:00.000Z')],
      TARGET_KEY,
      CAP_ID,
    );
    const failLookup = findLatestCapabilityProbeResult(
      [campaignWithRuns([matrixRun('fail', '2026-06-01T00:00:00.000Z')], 'c2', '2026-06-03T00:00:00.000Z')],
      TARGET_KEY,
      CAP_ID,
    );
    const resolved = resolveCapabilityProbeLookup(
      [campaignWithRuns([matrixRun('pass', '2026-06-01T00:00:00.000Z')], 'c1', '2026-06-02T00:00:00.000Z')],
      TARGET_KEY,
      CAP_ID,
      failLookup,
    );
    assert.equal(resolved?.test.verdict, 'fail');
    assert.equal(passLookup?.test.verdict, 'pass');
  });
});
