import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildClientStats,
  reconcileCompletionStats,
  resolveDecodeSeconds,
} from '../../src/api/chat.ts';

test('resolveDecodeSeconds uses full stream time when first token arrives in a burst', () => {
  const timings = resolveDecodeSeconds(0, 45999, 46000, 172);
  assert.ok(timings);
  assert.equal(timings.genTime, 46);
  assert.ok(Math.abs(172 / timings.genTime - 3.74) < 0.1);
});

test('resolveDecodeSeconds keeps measured window when throughput is plausible', () => {
  const timings = resolveDecodeSeconds(0, 50, 46000, 2181);
  assert.ok(timings);
  assert.ok(timings.genTime > 40);
  assert.ok(2181 / timings.genTime < 500);
});

test('buildClientStats matches chat-style burst correction', () => {
  const stats = buildClientStats(0, 45999, 46000, { completion_tokens: 172 }, 'stop');

  assert.ok(stats.tokens_per_second != null && stats.tokens_per_second < 100);
  assert.ok(Math.abs(stats.tokens_per_second! - 172 / 46) < 0.1);
});

test('buildClientStats uses first output token timing for reasoning-heavy streams', () => {
  const stats = buildClientStats(0, 100, 10_000, { completion_tokens: 500 }, 'stop');

  assert.equal(stats.time_to_first_token, 0.1);
  assert.ok(stats.generation_time != null && stats.generation_time > 9);
  assert.ok(stats.tokens_per_second != null && stats.tokens_per_second < 60);
});

test('reconcileCompletionStats does not pin tok/s to 2000', () => {
  const client = buildClientStats(0, 45999, 46000, { completion_tokens: 172 }, 'stop');
  const stats = reconcileCompletionStats(client, {}, { completion_tokens: 172 });

  assert.ok(stats.tokens_per_second != null && stats.tokens_per_second < 500);
  assert.notEqual(stats.tokens_per_second, 2000);
});
