/**
 * Anthropic adaptive-thinking model detection and providerOptions normalization.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  anthropicBudgetTokensToEffort,
  anthropicModelUsesAdaptiveThinking,
  normalizeAnthropicProviderOptions,
} from '../../src/lib/anthropic-thinking-style.mjs';

describe('anthropicModelUsesAdaptiveThinking', () => {
  test('matches newer Claude families that require adaptive thinking', () => {
    for (const modelId of [
      'claude-sonnet-5',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-fable-5',
    ]) {
      assert.equal(anthropicModelUsesAdaptiveThinking(modelId), true, modelId);
    }
  });

  test('does not match legacy Claude families that use enabled budgets', () => {
    for (const modelId of [
      'claude-sonnet-4-5',
      'claude-opus-4-5',
      'claude-haiku-4-5',
      'claude-3-5-sonnet',
    ]) {
      assert.equal(anthropicModelUsesAdaptiveThinking(modelId), false, modelId);
    }
  });
});

describe('anthropicBudgetTokensToEffort', () => {
  test('maps budget token tiers to adaptive effort', () => {
    assert.equal(anthropicBudgetTokensToEffort(1024), 'low');
    assert.equal(anthropicBudgetTokensToEffort(10240), 'medium');
    assert.equal(anthropicBudgetTokensToEffort(32768), 'high');
  });
});

describe('normalizeAnthropicProviderOptions', () => {
  test('rewrites enabled thinking to adaptive for sonnet-5', () => {
    const normalized = normalizeAnthropicProviderOptions('claude-sonnet-5', {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 10240 },
      },
    });

    assert.deepEqual(normalized?.anthropic?.thinking, { type: 'adaptive' });
    assert.equal(normalized?.anthropic?.effort, 'medium');
  });

  test('leaves enabled thinking for sonnet-4-5', () => {
    const input = {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 10240 },
      },
    };
    const normalized = normalizeAnthropicProviderOptions('claude-sonnet-4-5', input);
    assert.deepEqual(normalized, input);
  });
});
