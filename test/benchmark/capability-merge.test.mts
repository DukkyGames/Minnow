import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BenchmarkCampaign } from '../../src/benchmark/campaign-types.ts';
import type { BenchmarkRun } from '../../src/benchmark/types.ts';
import {
  extractAutoVerdictsFromCampaign,
  extractAutoVerdictsFromProbeResults,
  mergeCapabilityCell,
  mergeCapabilityMatrix,
  parseCapabilityProbeKey,
} from '../../src/benchmark/capabilities/merge.ts';
import type { ManualVerdictStore } from '../../src/benchmark/capabilities/manual-verdicts.ts';

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
          },
        ],
      },
    ],
  };
}

function campaignWithRuns(runs: BenchmarkRun[], id = 'camp-1'): BenchmarkCampaign {
  return {
    id,
    startedAt: '2026-06-01T00:00:00.000Z',
    endedAt: '2026-06-01T01:00:00.000Z',
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

describe('capability merge', () => {
  test('manual verdict wins over auto', () => {
    const manual: ManualVerdictStore = {
      [`${TARGET_KEY}::${CAP_ID}`]: {
        targetKey: TARGET_KEY,
        capabilityId: CAP_ID,
        verdict: 'partial',
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
    };
    const merged = mergeCapabilityMatrix({
      targetKeys: [TARGET_KEY],
      capabilityIds: [CAP_ID],
      manualStore: manual,
      campaigns: [campaignWithRuns([matrixRun('pass', '2026-06-01T00:00:00.000Z')])],
    });
    assert.equal(merged[0]?.verdict, 'partial');
    assert.equal(merged[0]?.source, 'manual');
    assert.equal(merged[0]?.overridesAuto, true);
    assert.equal(merged[0]?.autoVerdict, 'pass');
  });

  test('second campaign does not clear manual when auto changes', () => {
    const manual: ManualVerdictStore = {
      [`${TARGET_KEY}::${CAP_ID}`]: {
        targetKey: TARGET_KEY,
        capabilityId: CAP_ID,
        verdict: 'pass',
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
    };
    const merged = mergeCapabilityMatrix({
      targetKeys: [TARGET_KEY],
      capabilityIds: [CAP_ID],
      manualStore: manual,
      campaigns: [
        campaignWithRuns([matrixRun('fail', '2026-06-01T00:00:00.000Z')], 'older'),
        campaignWithRuns([matrixRun('fail', '2026-06-03T00:00:00.000Z')], 'newer'),
      ],
    });
    assert.equal(merged[0]?.verdict, 'pass');
    assert.equal(merged[0]?.source, 'manual');
    assert.equal(merged[0]?.overridesAuto, true);
  });

  test('latest auto by ranAt when no manual', () => {
    const cell = mergeCapabilityCell({
      targetKey: TARGET_KEY,
      capabilityId: CAP_ID,
      autos: [
        {
          targetKey: TARGET_KEY,
          capabilityId: CAP_ID,
          verdict: 'pass',
          ranAt: '2026-06-01T00:00:00.000Z',
          campaignId: 'a',
        },
        {
          targetKey: TARGET_KEY,
          capabilityId: CAP_ID,
          verdict: 'fail',
          ranAt: '2026-06-02T00:00:00.000Z',
          campaignId: 'b',
        },
      ],
    });
    assert.equal(cell.verdict, 'fail');
    assert.equal(cell.source, 'auto');
  });

  test('extractAutoVerdictsFromCampaign reads runs not cells', () => {
    const autos = extractAutoVerdictsFromCampaign(
      campaignWithRuns([matrixRun('pass', '2026-06-01T00:00:00.000Z')]),
    );
    assert.equal(autos.length, 1);
    assert.equal(autos[0]?.capabilityId, CAP_ID);
    assert.equal(autos[0]?.targetKey, TARGET_KEY);
  });

  test('extraAutos merge in-flight probes before campaign save', () => {
    const merged = mergeCapabilityMatrix({
      targetKeys: [TARGET_KEY],
      capabilityIds: [CAP_ID],
      manualStore: {},
      campaigns: [],
      extraAutos: extractAutoVerdictsFromProbeResults([
        {
          targetKey: TARGET_KEY,
          result: {
            testId: `cap-matrix/${CAP_ID}`,
            suite: 'capability-matrix',
            label: CAP_ID,
            passed: true,
            skipped: false,
            durationMs: 1,
            score: 1,
            verdict: 'pass',
          },
          campaignId: 'in-flight',
          ranAt: '2026-06-04T00:00:00.000Z',
        },
      ]),
    });
    assert.equal(merged[0]?.verdict, 'pass');
    assert.equal(merged[0]?.source, 'auto');
  });

  test('parseCapabilityProbeKey splits target and capability id', () => {
    const parsed = parseCapabilityProbeKey(`${TARGET_KEY}::${CAP_ID}`);
    assert.deepEqual(parsed, { targetKey: TARGET_KEY, capabilityId: CAP_ID });
  });
});
