import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';
import { mergeConfigMeta } from '../../server/config/validators.js';
import {
  clampGenerationIdleTimeoutMs,
  clampGenerationMaxDurationMs,
  DEFAULT_GENERATION_IDLE_TIMEOUT_MS,
  DEFAULT_GENERATION_MAX_DURATION_MS,
} from '../../server/generations/timeouts.js';

describe('generation timeout clamps (server)', () => {
  test('idle timeout defaults and bounds', () => {
    assert.equal(DEFAULT_GENERATION_IDLE_TIMEOUT_MS, 25 * 60_000);
    assert.equal(clampGenerationIdleTimeoutMs(undefined), 25 * 60_000);
    assert.equal(clampGenerationIdleTimeoutMs(10_000), 30_000);
    assert.equal(clampGenerationIdleTimeoutMs(60 * 60_000), 30 * 60_000);
  });

  test('max duration defaults and bounds', () => {
    assert.equal(DEFAULT_GENERATION_MAX_DURATION_MS, 60 * 60_000);
    assert.equal(clampGenerationMaxDurationMs(undefined), 60 * 60_000);
    assert.equal(clampGenerationMaxDurationMs(1_000), 60_000);
    assert.equal(clampGenerationMaxDurationMs(10 * 60 * 60_000), 4 * 60 * 60_000);
  });
});

describe('config.json chat block merge', () => {
  test('DEFAULT_META seeds chat block for new homes', () => {
    assert.equal(DEFAULT_META.chat?.generationIdleTimeoutMs, 25 * 60_000);
    assert.equal(DEFAULT_META.chat?.generationMaxDurationMs, 3_600_000);
    assert.equal(DEFAULT_META.chat?.maxToolTurns, undefined);
  });

  test('mergeConfigMeta defaults chat block when patch provides empty object', () => {
    const merged = mergeConfigMeta({}, { chat: {} });
    assert.equal(merged.chat.generationIdleTimeoutMs, 25 * 60_000);
    assert.equal(merged.chat.generationMaxDurationMs, 3_600_000);
    assert.equal(merged.chat.maxToolTurns, undefined);
  });

  test('mergeConfigMeta drops legacy chat.maxToolTurns', () => {
    const merged = mergeConfigMeta(
      { chat: { maxToolTurns: 600, generationIdleTimeoutMs: 240_000 } },
      { chat: { maxToolTurns: 24 } },
    );
    assert.equal(merged.chat.maxToolTurns, undefined);
    assert.equal(merged.chat.generationIdleTimeoutMs, 240_000);
  });

  test('mergeConfigMeta clamps generation timeouts', () => {
    const merged = mergeConfigMeta(
      {},
      {
        chat: {
          generationIdleTimeoutMs: 5_000,
          generationMaxDurationMs: 10 * 60 * 60_000,
        },
      },
    );
    assert.equal(merged.chat.generationIdleTimeoutMs, 30_000);
    assert.equal(merged.chat.generationMaxDurationMs, 4 * 60 * 60_000);
  });

  test('mergeConfigMeta partial chat patch keeps other chat fields', () => {
    const merged = mergeConfigMeta(
      {
        chat: {
          generationIdleTimeoutMs: 240_000,
          generationMaxDurationMs: 1_800_000,
        },
      },
      { chat: { generationIdleTimeoutMs: 300_000 } },
    );
    assert.equal(merged.chat.generationIdleTimeoutMs, 300_000);
    assert.equal(merged.chat.generationMaxDurationMs, 1_800_000);
  });
});
