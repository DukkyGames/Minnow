/**
 * Unit tests for reasoning effort helpers (`src/lib/reasoning-effort.ts`).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  defaultComposerReasoningLevel,
  getComposerReasoningLevelOptions,
  inferReasoningOptionsFromModelId,
  isQwen38ModelId,
  modelHasSelectableReasoningEffort,
  modelShowsComposerBrainToggle,
  modelUsesComposerReasoningBinaryDropdown,
  modelUsesComposerReasoningDropdown,
  modelUsesComposerThinkingToggle,
  normalizeReasoningAllowedOptions,
  normalizeReasoningCatalogValue,
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

  test('maps xhigh onto high so the composer can show High', () => {
    assert.deepEqual(
      normalizeReasoningAllowedOptions(['xhigh', 'medium', 'low', 'off']),
      ['off', 'low', 'medium', 'high'],
    );
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

describe('composer reasoning control helpers', () => {
  test('dropdown when low/medium/high are allowed', () => {
    const caps = { reasoningAllowedOptions: ['low', 'medium', 'high'] };
    assert.equal(modelUsesComposerReasoningDropdown(caps), true);
    assert.equal(modelUsesComposerThinkingToggle(caps), false);
    assert.equal(modelShowsComposerBrainToggle(caps), true);
  });

  test('brain toggle when only off/on are allowed (no binary effort select)', () => {
    const caps = { reasoningAllowedOptions: ['off', 'on'] };
    assert.equal(modelUsesComposerReasoningDropdown(caps), false);
    assert.equal(modelUsesComposerReasoningBinaryDropdown(caps), false);
    assert.equal(modelUsesComposerThinkingToggle(caps), true);
    assert.equal(modelShowsComposerBrainToggle(caps), true);
  });

  test('brain toggle when reasoning is advertised without explicit options', () => {
    assert.equal(modelUsesComposerThinkingToggle({ reasoning: true }), true);
    assert.equal(modelUsesComposerThinkingToggle({ reasoning: false }), false);
  });

  test('level options exclude off and on', () => {
    assert.deepEqual(
      getComposerReasoningLevelOptions(['off', 'low', 'medium', 'high', 'on']),
      ['low', 'medium', 'high'],
    );
  });

  test('defaultComposerReasoningLevel prefers catalog default', () => {
    assert.equal(
      defaultComposerReasoningLevel({
        reasoningAllowedOptions: ['low', 'medium', 'high'],
        reasoningDefault: 'high',
      }),
      'high',
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

  test('infers off/low/medium/high for Qwen3.8 on any api kind', () => {
    const expected = ['off', 'low', 'medium', 'high'];
    assert.deepEqual(
      inferReasoningOptionsFromModelId('qwen/qwen3.8-27b', 'lm-studio-v0'),
      expected,
    );
    assert.deepEqual(
      inferReasoningOptionsFromModelId('Qwen/Qwen3.8-27B', 'openai-v1'),
      expected,
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

  test('honors explicit off even when catalog omits off from allowed list', () => {
    assert.equal(
      resolveEffectiveReasoningEffort(
        { reasoningEffort: 'off' },
        { reasoningAllowedOptions: ['low', 'medium', 'high'] },
        'on',
      ),
      'off',
    );
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

  test('inherited on beats catalog default off', () => {
    assert.equal(
      resolveEffectiveReasoningEffort(
        {},
        { reasoningAllowedOptions: ['off', 'low', 'medium', 'high'], reasoningDefault: 'off' },
        'on',
      ),
      'medium',
    );
  });

  test('inherited on uses catalog default high when present', () => {
    assert.equal(
      resolveEffectiveReasoningEffort(
        {},
        {
          reasoningAllowedOptions: ['off', 'low', 'medium', 'high'],
          reasoningDefault: 'high',
        },
        'on',
      ),
      'high',
    );
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

describe('isQwen38ModelId', () => {
  test('matches dotted and underscored 3.8 ids, not Qwen3-8B', () => {
    assert.equal(isQwen38ModelId('qwen/qwen3.8-27b'), true);
    assert.equal(isQwen38ModelId('qwen3.8-27b'), true);
    assert.equal(isQwen38ModelId('Qwen/Qwen3.8-27B'), true);
    assert.equal(isQwen38ModelId('qwen3_8-27b'), true);
    assert.equal(isQwen38ModelId('Qwen/Qwen3-8B'), false);
    assert.equal(isQwen38ModelId('qwen/qwen3-32b'), false);
    assert.equal(isQwen38ModelId('qwen3.5-27b'), false);
  });

  test('normalizeReasoningCatalogValue maps xhigh to high', () => {
    assert.equal(normalizeReasoningCatalogValue('xhigh'), 'high');
    assert.equal(normalizeReasoningCatalogValue('medium'), 'medium');
    assert.equal(normalizeReasoningCatalogValue('nope'), undefined);
  });
});
