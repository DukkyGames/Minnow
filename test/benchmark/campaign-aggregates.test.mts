/**
 * Tests for campaign aggregate helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  aggregateFromRun,
  buildModelScoreIndex,
  computeCampaignAggregates,
  pickCampaignInsight,
} from '../../src/benchmark/aggregates.ts';
import type { BenchmarkCampaign } from '../../src/benchmark/campaign-types.ts';

describe('campaign aggregates', () => {
  test('aggregateFromRun uses integration score as total', () => {
    const agg = aggregateFromRun(
      { providerId: 'lmstudio', modelId: 'qwen-test' },
      {
        id: 'run-1',
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 1000,
        preset: 'quick',
        provider: { id: 'lmstudio', baseUrl: 'http://localhost:1234' },
        model: { id: 'qwen-test' },
        totalScore: 0.85,
        headlineTokPerSec: 120,
        headlineTtftMs: 500,
        modeMatrixPassed: 3,
        toolsPassed: 0,
        skillsPassed: 0,
        suites: [],
      },
    );
    assert.equal(agg.totalScore, 0.85);
    assert.equal(agg.headlineTokPerSec, 120);
    assert.equal(agg.integrationScore, 0.85);
  });

  test('buildModelScoreIndex keeps latest campaign per model', () => {
    const campaigns: BenchmarkCampaign[] = [
      {
        id: 'c-old',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:05:00.000Z',
        durationMs: 300000,
        preset: 'quick',
        targets: [{ providerId: 'p', modelId: 'm1' }],
        suites: [],
        status: 'completed',
        cells: [],
        runs: [],
        aggregates: [
          {
            targetKey: 'p::m1',
            providerId: 'p',
            modelId: 'm1',
            label: 'm1',
            totalScore: 0.5,
            headlineTokPerSec: 50,
            headlineTtftMs: 100,
            integrationScore: 0.5,
            standardScore: 0,
            customScore: 0,
          },
        ],
      },
      {
        id: 'c-new',
        startedAt: '2026-01-02T00:00:00.000Z',
        endedAt: '2026-01-02T00:05:00.000Z',
        durationMs: 300000,
        preset: 'quick',
        targets: [{ providerId: 'p', modelId: 'm1' }],
        suites: [],
        status: 'completed',
        cells: [],
        runs: [],
        aggregates: [
          {
            targetKey: 'p::m1',
            providerId: 'p',
            modelId: 'm1',
            label: 'm1',
            totalScore: 0.9,
            headlineTokPerSec: 100,
            headlineTtftMs: 80,
            integrationScore: 0.9,
            standardScore: 0,
            customScore: 0,
          },
        ],
      },
    ];
    const index = buildModelScoreIndex(campaigns);
    assert.equal(index.length, 1);
    assert.equal(index[0]!.campaignId, 'c-new');
    assert.equal(index[0]!.totalScore, 0.9);
  });

  test('pickCampaignInsight finds fastest and quality leaders', () => {
    const { fastest, quality } = pickCampaignInsight([
      {
        targetKey: 'a',
        providerId: 'p',
        modelId: 'fast',
        label: 'Fast',
        totalScore: 0.7,
        headlineTokPerSec: 200,
        headlineTtftMs: 100,
        integrationScore: 0.7,
        standardScore: 0,
        customScore: 0,
      },
      {
        targetKey: 'b',
        providerId: 'p',
        modelId: 'smart',
        label: 'Smart',
        totalScore: 0.95,
        headlineTokPerSec: 80,
        headlineTtftMs: 400,
        integrationScore: 0.95,
        standardScore: 0,
        customScore: 0,
      },
    ]);
    assert.equal(fastest?.label, 'Fast');
    assert.equal(quality?.label, 'Smart');
  });

  test('computeCampaignAggregates matches a run rewritten by its serve', () => {
    const aggregates = computeCampaignAggregates({
      targets: [{ providerId: 'minnow-library', modelId: 'mlx:org/repo' }],
      cells: [],
      runs: [
        {
          id: 'run-1',
          startedAt: '2026-01-01T00:00:00.000Z',
          durationMs: 1000,
          preset: 'custom',
          // Provider and model hold the serve binding, not the roster row.
          provider: { id: 'mlx-lm-local', baseUrl: 'http://127.0.0.1:8087' },
          model: { id: '/Users/me/.cache/models/snapshots/abc' },
          targetKey: 'minnow-library::mlx:org/repo',
          totalScore: 0.6,
          headlineTokPerSec: 40,
          headlineTtftMs: 300,
          modeMatrixPassed: 0,
          toolsPassed: 0,
          skillsPassed: 0,
          suites: [],
        },
      ],
    });
    assert.equal(aggregates[0]?.totalScore, 0.6);
    assert.equal(aggregates[0]?.runId, 'run-1');
  });
});
