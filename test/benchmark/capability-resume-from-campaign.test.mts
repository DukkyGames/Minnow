import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BenchmarkCampaign } from '../../src/benchmark/campaign-types.ts';
import {
  buildResumePayloadFromCampaign,
  canResumeCapabilityMatrixCampaign,
} from '../../src/benchmark/capabilities/resume-from-campaign.ts';

const cancelledCampaign: BenchmarkCampaign = {
  id: 'campaign-2026-08-12T20-44-15-756Z',
  startedAt: '2026-08-12T20:44:15.756Z',
  endedAt: '2026-08-12T20:45:00.000Z',
  durationMs: 44_244,
  preset: 'custom',
  kind: 'capability-matrix',
  status: 'cancelled',
  targets: [
    { providerId: 'openai', modelId: 'gpt-test-a', label: 'A' },
    { providerId: 'openai', modelId: 'gpt-test-b', label: 'B' },
  ],
  suites: [{ family: 'integration', id: 'capability-matrix' }],
  cells: [],
  aggregates: [],
  runs: [
    {
      id: 'run-a',
      startedAt: '2026-08-12T20:44:16.000Z',
      durationMs: 1000,
      preset: 'custom',
      provider: { id: 'openai', baseUrl: 'https://example.com' },
      model: { id: 'gpt-test-a' },
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
          tests: [
            {
              testId: 'cap-matrix/core-streaming',
              suite: 'capability-matrix',
              label: 'Streaming',
              passed: true,
              skipped: false,
              durationMs: 100,
              score: 1,
              verdict: 'pass',
            },
          ],
        },
      ],
    },
  ],
};

describe('capability resume-from-campaign', () => {
  it('builds resume payload for cancelled sweeps with remaining targets', () => {
    assert.equal(canResumeCapabilityMatrixCampaign(cancelledCampaign), true);
    const payload = buildResumePayloadFromCampaign(cancelledCampaign);
    assert.ok(payload);
    assert.equal(payload.campaignId, cancelledCampaign.id);
    assert.deepEqual(payload.completedTargetKeys, ['openai::gpt-test-a']);
    assert.deepEqual(payload.completedProbeKeys, ['openai::gpt-test-a::core-streaming']);
    assert.equal(payload.targets.length, 2);
  });

  it('returns null for completed campaigns', () => {
    const completed = { ...cancelledCampaign, status: 'completed' as const };
    assert.equal(canResumeCapabilityMatrixCampaign(completed), false);
    assert.equal(buildResumePayloadFromCampaign(completed), null);
  });

  it('returns null when every target finished before cancel', () => {
    const allDone = {
      ...cancelledCampaign,
      runs: [
        ...cancelledCampaign.runs,
        {
          ...cancelledCampaign.runs[0]!,
          id: 'run-b',
          model: { id: 'gpt-test-b' },
        },
      ],
    };
    assert.equal(canResumeCapabilityMatrixCampaign(allDone), false);
  });
});
