import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';
import { mergeConfigMeta } from '../../server/config/validators.js';
import {
  clampGenerationIdleTimeoutMs,
  clampGenerationMaxDurationMs,
  DEFAULT_GENERATION_IDLE_TIMEOUT_MS,
  DEFAULT_GENERATION_MAX_DURATION_MS,
  isGenerationTimeoutEnabled,
} from '../../server/generations/timeouts.js';

describe('generation timeout clamps (server)', () => {
  test('idle timeout defaults and bounds', () => {
    assert.equal(DEFAULT_GENERATION_IDLE_TIMEOUT_MS, 60 * 60_000);
    assert.equal(clampGenerationIdleTimeoutMs(undefined), 60 * 60_000);
    assert.equal(clampGenerationIdleTimeoutMs(0), 0);
    assert.equal(clampGenerationIdleTimeoutMs(10_000), 10_000);
    assert.equal(clampGenerationIdleTimeoutMs(12 * 60 * 60_000), 12 * 60 * 60_000);
  });

  test('max duration defaults and bounds', () => {
    assert.equal(DEFAULT_GENERATION_MAX_DURATION_MS, 240 * 60_000);
    assert.equal(clampGenerationMaxDurationMs(undefined), 240 * 60_000);
    assert.equal(clampGenerationMaxDurationMs(0), 0);
    assert.equal(clampGenerationMaxDurationMs(1_000), 1_000);
    assert.equal(clampGenerationMaxDurationMs(24 * 60 * 60_000), 24 * 60 * 60_000);
  });

  test('isGenerationTimeoutEnabled treats zero as off', () => {
    assert.equal(isGenerationTimeoutEnabled({ idleMs: 0, maxMs: 0 }), false);
    assert.equal(isGenerationTimeoutEnabled({ idleMs: 60_000, maxMs: 0 }), true);
    assert.equal(isGenerationTimeoutEnabled({ idleMs: 0, maxMs: 60_000 }), true);
  });
});

describe('config.json chat block merge', () => {
  test('DEFAULT_META seeds chat block for new homes', () => {
    assert.equal(DEFAULT_META.chat?.generationIdleTimeoutMs, 60 * 60_000);
    assert.equal(DEFAULT_META.chat?.generationMaxDurationMs, 240 * 60_000);
    assert.equal(DEFAULT_META.chat?.maxToolTurns, undefined);
  });

  test('mergeConfigMeta defaults chat block when patch provides empty object', () => {
    const merged = mergeConfigMeta({}, { chat: {} });
    assert.equal(merged.chat.generationIdleTimeoutMs, 60 * 60_000);
    assert.equal(merged.chat.generationMaxDurationMs, 240 * 60_000);
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

  test('mergeConfigMeta preserves zero generation timeouts', () => {
    const merged = mergeConfigMeta(
      {},
      {
        chat: {
          generationIdleTimeoutMs: 0,
          generationMaxDurationMs: 0,
        },
      },
    );
    assert.equal(merged.chat.generationIdleTimeoutMs, 0);
    assert.equal(merged.chat.generationMaxDurationMs, 0);
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
