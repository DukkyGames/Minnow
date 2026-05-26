import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildClientStats, reconcileCompletionStats } from '../../src/api/chat.ts';

test('buildClientStats floors decode window when prose arrives in one chunk', () => {
  const stats = buildClientStats(0, 45999, 46000, { completion_tokens: 172 }, 'stop');

  assert.ok(stats.generation_time != null && stats.generation_time < 1);
  assert.ok(stats.tokens_per_second != null && stats.tokens_per_second <= 2000.01);
  assert.ok(Math.abs(stats.tokens_per_second! - 172 / stats.generation_time!) < 0.01);
});

test('reconcileCompletionStats clamps after tiny client decode window', () => {
  const client = buildClientStats(0, 45999, 46000, { completion_tokens: 172 }, 'stop');
  const stats = reconcileCompletionStats(client, {}, { completion_tokens: 172 });

  assert.ok(stats.tokens_per_second != null && stats.tokens_per_second <= 2000);
});
