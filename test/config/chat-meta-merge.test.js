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

/** Mirror of {@link ../../src/config/chat-meta.ts} `clampMaxToolTurns` for contract tests. */
function clampMaxToolTurns(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(500, Math.max(1, Math.round(n)));
}

describe('chat.maxToolTurns clamp (client contract)', () => {
  test('clampMaxToolTurns enforces [1, 500]', () => {
    assert.equal(clampMaxToolTurns(0), 1);
    assert.equal(clampMaxToolTurns(600), 500);
    assert.equal(clampMaxToolTurns(24), 24);
    assert.equal(clampMaxToolTurns('nope'), 100);
  });
});

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

describe('config.json chat.maxToolTurns merge', () => {
  test('DEFAULT_META seeds chat block for new homes', () => {
    assert.equal(DEFAULT_META.chat?.maxToolTurns, 100);
    assert.equal(DEFAULT_META.chat?.generationIdleTimeoutMs, 25 * 60_000);
    assert.equal(DEFAULT_META.chat?.generationMaxDurationMs, 3_600_000);
  });

  test('mergeConfigMeta defaults chat block when patch provides empty object', () => {
    const merged = mergeConfigMeta({}, { chat: {} });
    assert.equal(merged.chat.maxToolTurns, 100);
    assert.equal(merged.chat.generationIdleTimeoutMs, 25 * 60_000);
    assert.equal(merged.chat.generationMaxDurationMs, 3_600_000);
  });

  test('mergeConfigMeta clamps chat.maxToolTurns to 500', () => {
    const merged = mergeConfigMeta({}, { chat: { maxToolTurns: 600 } });
    assert.equal(merged.chat.maxToolTurns, 500);
  });

  test('mergeConfigMeta clamps chat.maxToolTurns to at least 1', () => {
    const merged = mergeConfigMeta({}, { chat: { maxToolTurns: 0 } });
    assert.equal(merged.chat.maxToolTurns, 1);
  });

  test('mergeConfigMeta preserves valid value', () => {
    const merged = mergeConfigMeta(
      { chat: { maxToolTurns: 8 } },
      { chat: { maxToolTurns: 24 } },
    );
    assert.equal(merged.chat.maxToolTurns, 24);
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
          maxToolTurns: 12,
          generationIdleTimeoutMs: 240_000,
          generationMaxDurationMs: 1_800_000,
        },
      },
      { chat: { maxToolTurns: 16 } },
    );
    assert.equal(merged.chat.maxToolTurns, 16);
    assert.equal(merged.chat.generationIdleTimeoutMs, 240_000);
    assert.equal(merged.chat.generationMaxDurationMs, 1_800_000);
  });
});
