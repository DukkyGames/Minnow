import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BenchmarkCampaign } from '../../src/benchmark/campaign-types.ts';
import {
  CAMPAIGN_CELL_TRANSCRIPT_MAX_BYTES,
  prepareCampaignForPersistence,
} from '../../src/benchmark/campaign-persist-prep.ts';

function baseCampaign(): BenchmarkCampaign {
  return {
    id: 'campaign-test',
    startedAt: '2026-06-01T00:00:00.000Z',
    endedAt: '2026-06-01T01:00:00.000Z',
    durationMs: 1,
    preset: 'custom',
    targets: [{ providerId: 'openai', modelId: 'gpt-test' }],
    suites: [],
    status: 'completed',
    cells: [],
    aggregates: [],
    runs: [
      {
        id: 'run-1',
        startedAt: '2026-06-01T00:00:00.000Z',
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
            label: 'Matrix',
            passed: 1,
            failed: 1,
            skipped: 0,
            score: 0.5,
            tests: [
              {
                testId: 'cap-matrix/core-streaming',
                suite: 'capability-matrix',
                label: 'pass row',
                passed: true,
                skipped: false,
                durationMs: 1,
                score: 1,
                verdict: 'pass',
                transcript: [{ role: 'user', content: 'hello' }],
              },
              {
                testId: 'cap-matrix/core-tool-calling',
                suite: 'capability-matrix',
                label: 'fail row',
                passed: false,
                skipped: false,
                durationMs: 1,
                score: 0,
                verdict: 'fail',
                transcript: [
                  { role: 'user', content: 'probe prompt' },
                  { role: 'assistant', content: 'failed attempt' },
                  { role: 'tool', content: 'tool output '.repeat(200) },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('prepareCampaignForPersistence', () => {
  test('drops transcripts for pass cells, trims fail/partial', () => {
    const prepared = prepareCampaignForPersistence(baseCampaign());
    const tests = prepared.runs[0]!.suites[0]!.tests;
    assert.equal(tests[0]?.transcript, undefined);
    assert.ok(tests[1]?.transcript);
    const size = JSON.stringify(tests[1]?.transcript).length;
    assert.ok(size <= CAMPAIGN_CELL_TRANSCRIPT_MAX_BYTES);
  });

  test('stripAllTranscripts removes every transcript', () => {
    const prepared = prepareCampaignForPersistence(baseCampaign(), {
      stripAllTranscripts: true,
    });
    for (const test of prepared.runs[0]!.suites[0]!.tests) {
      assert.equal(test.transcript, undefined);
    }
  });
});
