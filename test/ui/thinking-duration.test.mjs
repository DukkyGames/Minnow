import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { formatThinkingDuration, ThinkingDurationTracker } = await import(
  '../../src/ui/thinking-duration.ts'
);

describe('formatThinkingDuration', () => {
  test('zero and sub-100ms clamp', () => {
    assert.equal(formatThinkingDuration(0), '0.0s');
    assert.equal(formatThinkingDuration(50), '0.1s');
    assert.equal(formatThinkingDuration(99), '0.1s');
  });

  test('sub-second and second precision', () => {
    assert.equal(formatThinkingDuration(350), '0.35s');
    assert.equal(formatThinkingDuration(12400), '12.4s');
  });
});

describe('ThinkingDurationTracker', () => {
  test('single segment accumulates wall time', () => {
    let now = 1000;
    const original = performance.now;
    performance.now = () => now;

    const ticks = [];
    const tracker = new ThinkingDurationTracker((ms) => ticks.push(ms));
    tracker.startSegment();
    now += 500;
    tracker.endSegment();

    assert.equal(tracker.getElapsedMs(), 500);
    assert.ok(ticks.length >= 1);

    performance.now = original;
  });

  test('two segments sum without counting the gap', () => {
    let now = 0;
    const original = performance.now;
    performance.now = () => now;

    const tracker = new ThinkingDurationTracker();
    tracker.startSegment();
    now += 300;
    tracker.endSegment();
    now += 10_000;
    tracker.startSegment();
    now += 200;
    tracker.endSegment();

    assert.equal(tracker.getElapsedMs(), 500);
    assert.equal(tracker.finalize(), 500);

    performance.now = original;
  });

  test('abort clears accumulated time', () => {
    let now = 0;
    const original = performance.now;
    performance.now = () => now;

    const tracker = new ThinkingDurationTracker();
    tracker.startSegment();
    now += 400;
    tracker.abort();

    assert.equal(tracker.getElapsedMs(), 0);
    assert.equal(tracker.finalize(), 0);

    performance.now = original;
  });

  test('finalizeRound returns elapsed time and resets for the next response', () => {
    let now = 0;
    const original = performance.now;
    performance.now = () => now;

    const tracker = new ThinkingDurationTracker();
    tracker.startSegment();
    now += 300;
    tracker.endSegment();
    now += 5000;
    tracker.startSegment();
    now += 200;

    assert.equal(tracker.finalizeRound(), 500);
    assert.equal(tracker.getElapsedMs(), 0);

    tracker.startSegment();
    now += 100;
    assert.equal(tracker.finalizeRound(), 100);
    assert.equal(tracker.getElapsedMs(), 0);

    performance.now = original;
  });
});
