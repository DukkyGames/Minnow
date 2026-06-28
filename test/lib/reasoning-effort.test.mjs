/**
 * Unit tests for reasoning effort helpers (`src/lib/reasoning-effort.ts`).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  inferReasoningOptionsFromModelId,
  modelHasSelectableReasoningEffort,
  normalizeReasoningAllowedOptions,
  resolveEffectiveReasoningEffort,
} from '../../src/lib/reasoning-effort.ts';

describe('normalizeReasoningAllowedOptions', () => {
  test('preserves low, medium, and high in canonical order', () => {
    const result = normalizeReasoningAllowedOptions([
      'high',
      'invalid',
      'low',
      'medium',
      'bogus',
    ]);
    assert.deepEqual(result, ['low', 'medium', 'high']);
  });

  test('drops unknown values and keeps off/on when present', () => {
    const result = normalizeReasoningAllowedOptions(['on', 'nope', 'off']);
    assert.deepEqual(result, ['off', 'on']);
  });

  test('returns empty array when nothing is valid', () => {
    assert.deepEqual(normalizeReasoningAllowedOptions(['x', 1, null]), []);
  });
});

describe('modelHasSelectableReasoningEffort', () => {
  test('returns false with zero or one allowed option', () => {
    assert.equal(modelHasSelectableReasoningEffort(null), false);
    assert.equal(modelHasSelectableReasoningEffort({}), false);
    assert.equal(
      modelHasSelectableReasoningEffort({ reasoningAllowedOptions: ['medium'] }),
      false,
    );
  });

  test('returns true when two or more options are allowed', () => {
    assert.equal(
      modelHasSelectableReasoningEffort({
        reasoningAllowedOptions: ['off', 'on'],
      }),
      true,
    );
    assert.equal(
      modelHasSelectableReasoningEffort({
        reasoningAllowedOptions: ['low', 'medium', 'high'],
      }),
      true,
    );
  });
});

describe('inferReasoningOptionsFromModelId', () => {
  test('infers off/low/medium/high for any openai-v1 model without catalog', () => {
    const expected = ['off', 'low', 'medium', 'high'];
    assert.deepEqual(
      inferReasoningOptionsFromModelId('openai/o3-mini', 'openai-v1'),
      expected,
    );
    assert.deepEqual(
      inferReasoningOptionsFromModelId('gpt-5-preview', 'openai-v1'),
      expected,
    );
    assert.deepEqual(
      inferReasoningOptionsFromModelId('meta-llama/Llama-3.2-3B', 'openai-v1'),
      expected,
    );
    assert.deepEqual(
      inferReasoningOptionsFromModelId('qwen/qwen3-32b', 'openai-v1'),
      expected,
    );
  });

  test('uses off/on for thinking-type-only vendors on openai-v1', () => {
    assert.deepEqual(
      inferReasoningOptionsFromModelId('moonshot/kimi-k2', 'openai-v1'),
      ['off', 'on'],
    );
    assert.deepEqual(
      inferReasoningOptionsFromModelId('deepseek/deepseek-chat', 'openai-v1'),
      ['off', 'on'],
    );
  });

  test('returns empty for lm-studio-v0 (catalog should drive options)', () => {
    assert.deepEqual(
      inferReasoningOptionsFromModelId('openai/o3-mini', 'lm-studio-v0'),
      [],
    );
    assert.deepEqual(
      inferReasoningOptionsFromModelId('meta-llama/Llama-3.2-3B', 'lm-studio-v0'),
      [],
    );
  });
});

describe('resolveEffectiveReasoningEffort', () => {
  const caps = {
    reasoningAllowedOptions: ['off', 'low', 'medium', 'high'],
    reasoningDefault: 'medium',
  };

  test('prefers chat.reasoningEffort when allowed', () => {
    assert.equal(
      resolveEffectiveReasoningEffort({ reasoningEffort: 'high' }, caps, 'off'),
      'high',
    );
  });

  test('falls back to catalog default when chat override is unset', () => {
    assert.equal(resolveEffectiveReasoningEffort({}, caps, 'off'), 'medium');
  });

  test('ignores chat override that is not in allowed list', () => {
    assert.equal(
      resolveEffectiveReasoningEffort({ reasoningEffort: 'on' }, caps, 'off'),
      'medium',
    );
  });

  test('maps resolved brain on to medium when catalog default is absent', () => {
    const effortOnly = { reasoningAllowedOptions: ['off', 'low', 'medium', 'high'] };
    assert.equal(resolveEffectiveReasoningEffort({}, effortOnly, 'on'), 'medium');
  });

  test('maps resolved brain off to off when catalog default is absent', () => {
    const effortOnly = { reasoningAllowedOptions: ['off', 'low', 'medium', 'high'] };
    assert.equal(resolveEffectiveReasoningEffort({}, effortOnly, 'off'), 'off');
  });

  test('uses first allowed option as last resort', () => {
    const minimal = { reasoningAllowedOptions: ['low', 'high'] };
    assert.equal(resolveEffectiveReasoningEffort({}, minimal, 'on'), 'low');
  });

  test('returns undefined when model exposes no allowed options', () => {
    assert.equal(resolveEffectiveReasoningEffort({}, {}, 'on'), undefined);
    assert.equal(resolveEffectiveReasoningEffort({}, {}, 'off'), undefined);
  });
});
