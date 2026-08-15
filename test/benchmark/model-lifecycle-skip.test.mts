/**
 * ensureBenchmarkTargetLoaded skip gate (no network).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('localModelLoadBlockedReason', () => {
  test('returns skip copy when server is down for local targets', async () => {
    const { localModelLoadBlockedReason } = await import(
      '../../src/benchmark/model-lifecycle.ts'
    );

    const reason = localModelLoadBlockedReason(false, {
      providerId: 'lm-studio',
      modelId: 'qwen-test',
    });

    assert.match(reason ?? '', /Tool server unavailable/);
  });

  test('allows cloud targets when server is down', async () => {
    const { localModelLoadBlockedReason } = await import(
      '../../src/benchmark/model-lifecycle.ts'
    );

    assert.equal(
      localModelLoadBlockedReason(false, { providerId: 'openai', modelId: 'gpt-4' }),
      null,
    );
  });
});
