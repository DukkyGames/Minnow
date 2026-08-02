import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  getEditorAiMetrics,
  recordCompletionEvent,
  resetEditorAiMetricsForTests,
} from '../../src/ui/editor-ai-telemetry.ts';

afterEach(() => {
  resetEditorAiMetricsForTests();
});

describe('editor AI telemetry', () => {
  test('aggregates requests, cache hits, shown, accepted, and reject reasons', () => {
    recordCompletionEvent({ type: 'request' });
    recordCompletionEvent({ type: 'request' });
    recordCompletionEvent({ type: 'cache_hit' });
    recordCompletionEvent({ type: 'shown' });
    recordCompletionEvent({ type: 'shown' });
    recordCompletionEvent({ type: 'accepted' });
    recordCompletionEvent({ type: 'reject', reason: 'prose' });
    recordCompletionEvent({ type: 'reject', reason: 'prose' });
    recordCompletionEvent({ type: 'reject', reason: 'prefix_echo' });

    const metrics = getEditorAiMetrics();
    assert.equal(metrics.requests, 2);
    assert.equal(metrics.cacheHits, 1);
    assert.equal(metrics.shown, 2);
    assert.equal(metrics.accepted, 1);
    assert.equal(metrics.acceptRate, 0.5);
    assert.deepEqual(metrics.rejectByReason, { prose: 2, prefix_echo: 1 });
  });

  test('records timing percentiles', () => {
    for (const ms of [10, 20, 30, 40, 100]) {
      recordCompletionEvent({ type: 'timing', firstTokenMs: ms, totalMs: ms * 2 });
    }
    const metrics = getEditorAiMetrics();
    assert.equal(metrics.firstTokenMs.p50, 30);
    assert.equal(metrics.firstTokenMs.p95, 100);
    assert.equal(metrics.totalMs.p50, 60);
    assert.equal(metrics.totalMs.p95, 200);
  });

  test('reset clears counters', () => {
    recordCompletionEvent({ type: 'request' });
    resetEditorAiMetricsForTests();
    const metrics = getEditorAiMetrics();
    assert.equal(metrics.requests, 0);
    assert.equal(metrics.acceptRate, null);
  });
});
