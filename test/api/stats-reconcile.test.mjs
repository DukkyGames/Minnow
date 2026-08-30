import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildClientStats,
  finalizeResponseMeta,
  mergeStreamMeta,
  reconcileCompletionStats,
  statsFromLlamaTimings,
} from '../../src/api/chat.ts';

describe('reconcileCompletionStats', () => {
  test('rejects implausible LM Studio stats (high tps, tiny gen vs usage)', () => {
    const client = buildClientStats(0, 50, 46_000, { completion_tokens: 2181 }, 'stop');
    const server = {
      tokens_per_second: 72_709,
      time_to_first_token: 0.021,
      generation_time: 0.03,
    };
    const usage = { completion_tokens: 2181, total_tokens: 21_199 };

    const stats = reconcileCompletionStats(client, server, usage);

    assert.ok(stats.generation_time > 1, 'uses wall-clock generation time');
    assert.ok(stats.tokens_per_second < 500, 'tok/s is realistic');
    assert.ok(Math.abs(stats.tokens_per_second - 2181 / stats.generation_time) < 0.01);
  });

  test('keeps consistent server stats when they match usage', () => {
    const client = buildClientStats(0, 100, 5_100, { completion_tokens: 500 }, 'stop');
    const server = {
      tokens_per_second: 100,
      time_to_first_token: 0.1,
      generation_time: 5,
      stop_reason: 'eos',
    };

    const stats = reconcileCompletionStats(client, server, { completion_tokens: 500 });

    assert.equal(stats.tokens_per_second, 100);
    assert.equal(stats.generation_time, 5);
    assert.equal(stats.time_to_first_token, 0.1);
    assert.equal(stats.stop_reason, 'eos');
  });

  test('reconcile uses wall-clock decode when first token arrives in a burst', () => {
    const client = buildClientStats(0, 45999, 46000, { completion_tokens: 172 }, 'stop');
    const stats = reconcileCompletionStats(client, {}, { completion_tokens: 172 });

    assert.ok(stats.tokens_per_second < 100);
    assert.notEqual(stats.tokens_per_second, 2000);
  });

  test('finalizeResponseMeta applies reconciliation', () => {
    const meta = finalizeResponseMeta(
      {
        stats: {
          tokens_per_second: 72_709,
          time_to_first_token: 0.021,
          generation_time: 0.03,
        },
        usage: { completion_tokens: 2181, total_tokens: 21_199 },
        finish_reason: 'stop',
      },
      0,
      50,
      46_000
    );

    assert.ok(meta.stats.generation_time > 1);
    assert.ok(meta.stats.tokens_per_second < 500);
  });

  test('partial trust keeps server decode timing when client prose window is shorter', () => {
    // Reasoning model: server measured full decode; client tFirst was prose-only.
    const client = buildClientStats(0, 8_000, 10_000, { completion_tokens: 500 }, 'stop');
    const server = {
      tokens_per_second: 72_709,
      time_to_first_token: 0.5,
      generation_time: 5,
    };

    const stats = reconcileCompletionStats(client, server, { completion_tokens: 500 });

    assert.equal(stats.generation_time, 5);
    assert.equal(stats.time_to_first_token, 0.5);
    assert.ok(Math.abs(stats.tokens_per_second - 100) < 0.01);
  });
});

describe('llama.cpp timings', () => {
  test('ignores the opening chunk, which reports 1 token in 0.001 ms', () => {
    // Taken verbatim from a b9628 stream: this is not a million tokens per second.
    assert.equal(
      statsFromLlamaTimings({ predicted_n: 1, predicted_ms: 0.001, predicted_per_second: 1000000 }),
      null,
    );
    assert.equal(statsFromLlamaTimings({ predicted_n: 0, predicted_ms: 0 }), null);
    assert.equal(statsFromLlamaTimings(undefined), null);
  });

  test('turns a completed timings block into server stats', () => {
    const stats = statsFromLlamaTimings({
      prompt_n: 7797,
      prompt_ms: 1446.591,
      prompt_per_second: 5389.91,
      predicted_n: 200,
      predicted_ms: 1364.676,
      predicted_per_second: 146.55,
      draft_n: 206,
      draft_n_accepted: 130,
    });
    assert.ok(stats);
    assert.ok(Math.abs(stats.generation_time - 1.364676) < 1e-6);
    assert.equal(stats.tokens_per_second, 146.55);
    assert.ok(Math.abs(stats.time_to_first_token - 1.446591) < 1e-6);
    assert.equal(stats.prompt_tokens_per_second, 5389.91);
    assert.ok(Math.abs(stats.draft_acceptance - 130 / 206) < 1e-9);
  });

  test('mergeStreamMeta folds timings into stats so the reconciler can weigh them', () => {
    let meta = mergeStreamMeta(null, {
      timings: { predicted_n: 1, predicted_ms: 0.001 },
    });
    assert.equal(meta.stats, undefined, 'the bogus opening sample is not adopted');

    meta = mergeStreamMeta(meta, {
      timings: { predicted_n: 200, predicted_ms: 2000, predicted_per_second: 100 },
    });
    assert.equal(meta.stats.tokens_per_second, 100);
    assert.equal(meta.stats.generation_time, 2);
    assert.equal(meta.timings.predicted_n, 200);
  });

  test('mergeStreamMeta keeps the latest prompt_progress for the live status row', () => {
    let meta = mergeStreamMeta(null, {
      prompt_progress: { total: 16360, cache: 0, processed: 2048, time_ms: 288 },
    });
    meta = mergeStreamMeta(meta, {
      prompt_progress: { total: 16360, cache: 0, processed: 8192, time_ms: 1047 },
    });
    assert.equal(meta.prompt_progress.processed, 8192);
  });

  test('an explicit stats block still wins over derived timings', () => {
    const meta = mergeStreamMeta(null, {
      timings: { predicted_n: 200, predicted_ms: 2000, predicted_per_second: 100 },
      stats: { tokens_per_second: 42 },
    });
    assert.equal(meta.stats.tokens_per_second, 42);
  });

  test('mergeStreamMeta counts text deltas when timings.predicted_n is absent', () => {
    let meta = mergeStreamMeta(null, {
      choices: [{ delta: { content: 'Hel' } }],
    });
    meta = mergeStreamMeta(meta, {
      choices: [{ delta: { content: 'lo' } }],
    });
    meta = mergeStreamMeta(meta, {
      choices: [{ delta: { reasoning: 'think' } }],
    });
    // Tool-call-only deltas must not bump the live GEN count.
    meta = mergeStreamMeta(meta, {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1' }] } }],
    });
    assert.equal(meta.timings.predicted_n, 3);
  });

  test('mergeStreamMeta does not invent predicted_n when llama timings are present', () => {
    const meta = mergeStreamMeta(null, {
      timings: { predicted_n: 12, predicted_ms: 100 },
      choices: [{ delta: { content: 'x' } }],
    });
    assert.equal(meta.timings.predicted_n, 12);
  });
});
