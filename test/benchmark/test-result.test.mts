import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BENCHMARK_RUN_SIZE_SOFT_CAP,
  buildTestResult,
  prepareBenchmarkRunForPersistence,
  reportTest,
  truncateTranscriptForPersistence,
  TRANSCRIPT_TOOL_CONTENT_CAP,
} from '../../src/benchmark/test-result.ts';
import type { BenchmarkRun, BenchmarkRunContext, TestResult } from '../../src/benchmark/types.ts';
import type { ApiMessage } from '../../src/types.ts';

describe('reportTest', () => {
  test('appends result and invokes onTestDone in order', () => {
    const tests: TestResult[] = [];
    const seen: string[] = [];
    const ctx: BenchmarkRunContext = {
      providerId: 'p',
      modelId: 'm',
      localServer: true,
      signal: new AbortController().signal,
      onTestDone: (r) => {
        seen.push(r.testId);
      },
    };

    reportTest(ctx, tests, {
      testId: 'a',
      suite: 'speed',
      label: 'A',
      passed: true,
      skipped: false,
      durationMs: 1,
      score: 1,
    });
    reportTest(ctx, tests, {
      testId: 'b',
      suite: 'speed',
      label: 'B',
      passed: false,
      skipped: false,
      durationMs: 2,
      score: 0,
    });

    assert.equal(tests.length, 2);
    assert.deepEqual(seen, ['a', 'b']);
    assert.equal(tests[0]?.testId, 'a');
    assert.equal(tests[1]?.testId, 'b');
  });

  test('does not throw when onTestDone is omitted', () => {
    const tests: TestResult[] = [];
    const ctx: BenchmarkRunContext = {
      providerId: 'p',
      modelId: 'm',
      localServer: false,
      signal: new AbortController().signal,
    };
    reportTest(ctx, tests, {
      testId: 'x',
      suite: 'tools',
      label: 'X',
      passed: true,
      skipped: false,
      durationMs: 1,
      score: 1,
    });
    assert.equal(tests.length, 1);
  });
});

describe('buildTestResult', () => {
  test('maps driver messages to transcript with finishReason meta', () => {
    const messages: ApiMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const result = buildTestResult(
      {
        testId: 't1',
        suite: 'speed',
        label: 'Probe',
        passed: true,
        skipped: false,
        durationMs: 10,
        score: 1,
      },
      {
        text: 'hello',
        toolCalls: [],
        finishReason: 'stop',
        timing: {
          ttftMs: 1,
          totalMs: 2,
          tokPerSec: 3,
          usage: {},
          stats: {},
        },
        messages,
      },
    );

    assert.deepEqual(result.transcript, messages);
    assert.equal(result.transcriptMeta?.finishReason, 'stop');
  });

  test('truncates large system and tool content for persistence', () => {
    const long = 'x'.repeat(TRANSCRIPT_TOOL_CONTENT_CAP + 50);
    const truncated = truncateTranscriptForPersistence([
      { role: 'system', content: 's'.repeat(900) },
      { role: 'tool', tool_call_id: 'a', content: long },
    ]);

    assert.match(String(truncated[0]?.content), /characters total\)$/);
    assert.match(String(truncated[1]?.content), /truncated$/);
  });
});

describe('prepareBenchmarkRunForPersistence', () => {
  test('round-trips transcript fields when under size cap', () => {
    const run: BenchmarkRun = {
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
          id: 'speed',
          label: 'Speed',
          passed: 1,
          failed: 0,
          skipped: 0,
          score: 1,
          tests: [
            {
              testId: 'speed-short-1',
              suite: 'speed',
              label: 'Short',
              passed: true,
              skipped: false,
              durationMs: 1,
              score: 1,
              transcript: [{ role: 'assistant', content: 'ok' }],
            },
          ],
        },
      ],
    };

    const prepared = prepareBenchmarkRunForPersistence(run);
    const test = prepared.suites[0]?.tests[0] as TestResult;
    assert.equal(test.transcript?.[0]?.content, 'ok');
    assert.ok(JSON.stringify(prepared).length < BENCHMARK_RUN_SIZE_SOFT_CAP);
  });
});
