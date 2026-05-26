import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveTestResultForCard } from '../../src/ui/benchmark-page.ts';
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
