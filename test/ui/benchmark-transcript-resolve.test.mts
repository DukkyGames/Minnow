import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  clearLiveStandardCellsForTests,
  clearLiveTranscriptStateForTests,
  resolveStandardCellForTranscript,
  resolveTestForTranscript,
  resolveTestResultForCard,
  seedLiveStandardCellsForTests,
  seedLiveTranscriptStateForTests,
} from '../../src/ui/benchmark-page.ts';
import type { BenchmarkRun } from '../../src/benchmark/types.ts';

const SAMPLE_RUN: BenchmarkRun = {
  id: 'run-1',
  startedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 1,
  preset: 'quick',
  provider: { id: 'p', baseUrl: 'http://localhost' },
  model: { id: 'm' },
  totalScore: 1,
  headlineTokPerSec: 1,
  headlineTtftMs: 1,
  modeMatrixPassed: 1,
  toolsPassed: 1,
  skillsPassed: 1,
  suites: [
    {
      id: 'skills',
      label: 'Skills',
      passed: 0,
      failed: 1,
      skipped: 0,
      score: 0,
      tests: [
        {
          testId: 'skill-ask-user',
          suite: 'skills',
          label: 'Ask user',
          passed: false,
          skipped: false,
          durationMs: 1,
          score: 0,
          transcript: [{ role: 'assistant', content: 'What do you prefer?' }],
        },
      ],
    },
  ],
};

describe('resolveTestResultForCard', () => {
  test('finds test by id across suites', () => {
    const found = resolveTestResultForCard(SAMPLE_RUN, 'skill-ask-user');
    assert.equal(found?.label, 'Ask user');
    assert.equal(found?.transcript?.[0]?.content, 'What do you prefer?');
  });

  test('returns null when run or id missing', () => {
    assert.equal(resolveTestResultForCard(null, 'skill-ask-user'), null);
    assert.equal(resolveTestResultForCard(SAMPLE_RUN, 'missing'), null);
  });
});

describe('resolveTestForTranscript', () => {
  test('prefers live results over a previous saved run', () => {
    seedLiveTranscriptStateForTests({
      meta: { preset: 'quick', modelId: 'live-model', startedAt: '2026-02-01T00:00:00.000Z' },
      results: [
        {
          testId: 'skill-ask-user',
          suite: 'skills',
          label: 'Ask user (live)',
          passed: true,
          skipped: false,
          durationMs: 2,
          score: 1,
          transcript: [{ role: 'assistant', content: 'live transcript' }],
        },
      ],
    });

    const found = resolveTestForTranscript('skill-ask-user');
    assert.equal(found?.label, 'Ask user (live)');
    assert.equal(found?.transcript?.[0]?.content, 'live transcript');

    clearLiveTranscriptStateForTests();
  });

  test('returns null when neither live nor saved run has the test', () => {
    clearLiveTranscriptStateForTests();
    assert.equal(resolveTestForTranscript('missing'), null);
  });
});

describe('resolveStandardCellForTranscript', () => {
  test('finds Academic cell by cellId with transcript', () => {
    seedLiveStandardCellsForTests([
      {
        cellId: 'p::m__mmlu-1',
        targetKey: 'p::m',
        family: 'standard',
        suiteId: 'mmlu-mini',
        testId: 'mmlu-1',
        label: 'mmlu-1',
        passed: true,
        skipped: false,
        score: 1,
        durationMs: 3700,
        transcript: [
          { role: 'user', content: 'Question?' },
          { role: 'assistant', content: 'A' },
        ],
      },
    ]);

    const cell = resolveStandardCellForTranscript('p::m__mmlu-1');
    assert.equal(cell?.label, 'mmlu-1');
    assert.equal(cell?.transcript?.[1]?.content, 'A');

    clearLiveStandardCellsForTests();
  });

  test('returns null when cell id is missing', () => {
    clearLiveStandardCellsForTests();
    assert.equal(resolveStandardCellForTranscript('missing'), null);
  });
});
