import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildLiveStreamMeta,
  buildLiveStreamStats,
  buildLiveStreamUsage,
  LIVE_STREAM_STATS_THROTTLE_MS,
} from '../../src/chat/streaming-stats.ts';

describe('buildLiveStreamUsage', () => {
  test('estimates completion tokens from partial assistant text', () => {
    const usage = buildLiveStreamUsage({
      streamMeta: {},
      t0: 0,
      tFirst: 10,
      partialText: 'x'.repeat(400),
      partialThinking: '',
    });

    assert.equal(usage.completion_tokens, 100);
    assert.equal(usage.total_tokens, 100);
  });

  test('does not estimate completion from thinking text (provider reports it)', () => {
    const usage = buildLiveStreamUsage({
      streamMeta: {},
      t0: 0,
      tFirst: 10,
      partialText: 'abcd',
      partialThinking: 'efgh',
    });

    assert.equal(usage.completion_tokens, 1);
  });

  test('prefers provider usage from stream meta when present', () => {
    const usage = buildLiveStreamUsage({
      streamMeta: {
        usage: { prompt_tokens: 1200, completion_tokens: 42, total_tokens: 1242 },
      },
      t0: 0,
      tFirst: 10,
      partialText: 'ignored for count',
      partialThinking: '',
    });

    assert.equal(usage.completion_tokens, 42);
    assert.equal(usage.prompt_tokens, 1200);
    assert.equal(usage.total_tokens, 1242);
  });

  test('sums prior tool-loop segments with the live round', () => {
    const usage = buildLiveStreamUsage({
      streamMeta: {},
      t0: 0,
      tFirst: 10,
      partialText: 'abcd',
      partialThinking: '',
      priorSegments: [{ prompt_tokens: 500, completion_tokens: 80, total_tokens: 580 }],
    });

    assert.equal(usage.prompt_tokens, 500);
    assert.equal(usage.completion_tokens, 81);
    assert.equal(usage.total_tokens, 581);
  });

  test('does not sum prompt tokens across completed tool-loop rounds', () => {
    const usage = buildLiveStreamUsage({
      streamMeta: {
        usage: { prompt_tokens: 12_000, completion_tokens: 40, total_tokens: 12_040 },
      },
      t0: 0,
      tFirst: 10,
      partialText: '',
      priorSegments: [
        { prompt_tokens: 10_000, completion_tokens: 80, total_tokens: 10_080 },
        { prompt_tokens: 11_000, completion_tokens: 60, total_tokens: 11_060 },
      ],
    });

    assert.equal(usage.prompt_tokens, 12_000);
    assert.equal(usage.completion_tokens, 180);
    assert.equal(usage.total_tokens, 12_180);
  });
});

describe('buildLiveStreamStats', () => {
  test('computes tok/s during an in-flight stream', () => {
    const stats = buildLiveStreamStats(
      {
        streamMeta: {},
        t0: 0,
        tFirst: 0,
        partialText: 'x'.repeat(400),
      },
      2000,
    );

    assert.equal(stats.time_to_first_token, 0);
    assert.ok(stats.generation_time != null && stats.generation_time > 0);
    assert.ok(stats.tokens_per_second != null && stats.tokens_per_second > 0);
    assert.ok(stats.tokens_per_second! < 200);
  });

  test('prior segments increase token totals but do not inflate live tok/s', () => {
    const stats = buildLiveStreamStats(
      {
        streamMeta: {
          usage: { completion_tokens: 40 },
        },
        t0: 0,
        tFirst: 0,
        partialText: '',
        priorSegments: [{ completion_tokens: 200 }],
        priorStatsSegments: [
          {
            stats: { tokens_per_second: 10, generation_time: 20 },
            usage: { completion_tokens: 200 },
          },
        ],
      },
      4000,
    );

    assert.ok(stats.tokens_per_second != null && stats.tokens_per_second < 15);
    assert.ok(stats.tokens_per_second! > 8);
  });
});

describe('buildLiveStreamMeta', () => {
  test('returns both usage and timing stats for the strip', () => {
    const meta = buildLiveStreamMeta(
      {
        streamMeta: {},
        t0: 0,
        tFirst: 0,
        partialText: 'x'.repeat(80),
      },
      1000,
    );

    assert.equal(meta.usage.completion_tokens, 20);
    assert.ok(meta.stats.tokens_per_second != null);
  });
});

describe('LIVE_STREAM_STATS_THROTTLE_MS', () => {
  test('uses a small throttle to limit strip repaint churn', () => {
    assert.equal(LIVE_STREAM_STATS_THROTTLE_MS, 100);
  });
});
