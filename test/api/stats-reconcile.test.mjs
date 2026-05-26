import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildClientStats,
  finalizeResponseMeta,
  reconcileCompletionStats,
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
});
