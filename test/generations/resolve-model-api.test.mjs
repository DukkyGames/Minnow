/**
 * Per-model API resolution for mixed gateways (OpenCode Zen, OpenRouter).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  modelLooksAnthropic,
  resolveModelApi,
} from '../../src/lib/resolve-model-api.mjs';

const openAiGateway = {
  apiKind: 'openai-v1',
  autoApi: true,
};

const pureAnthropic = {
  apiKind: 'anthropic-v1',
};

const pureOpenAi = {
  apiKind: 'openai-v1',
  autoApi: false,
};

describe('modelLooksAnthropic', () => {
  test('detects OpenRouter namespace prefix', () => {
    assert.equal(modelLooksAnthropic('anthropic/claude-sonnet-4', null), true);
  });

  test('detects Zen claude ids', () => {
    assert.equal(modelLooksAnthropic('claude-sonnet-4-5', null), true);
    assert.equal(modelLooksAnthropic('claude-opus-4-6', null), true);
  });

  test('detects owned_by metadata', () => {
    assert.equal(modelLooksAnthropic('custom-id', { owned_by: 'anthropic' }), true);
  });

  test('rejects gpt models', () => {
    assert.equal(modelLooksAnthropic('gpt-4o-mini', null), false);
    assert.equal(modelLooksAnthropic('openai/gpt-4o', { owned_by: 'openai' }), false);
  });
});

describe('resolveModelApi', () => {
  test('manual override wins on gateway providers', () => {
    assert.equal(
      resolveModelApi(
        {
          ...openAiGateway,
          modelApiOverrides: { 'gpt-4o': 'anthropic-v1' },
        },
        'gpt-4o',
        null,
      ),
      'anthropic-v1',
    );
  });

  test('autoApi routes claude to anthropic on openai-v1 gateway', () => {
    assert.equal(resolveModelApi(openAiGateway, 'claude-sonnet-4-5', null), 'anthropic-v1');
    assert.equal(
      resolveModelApi(openAiGateway, 'anthropic/claude-3-5-sonnet', null),
      'anthropic-v1',
    );
    assert.equal(resolveModelApi(openAiGateway, 'gpt-4o-mini', null), 'openai-v1');
  });

  test('non-auto openai provider uses profile apiKind for all models', () => {
    assert.equal(resolveModelApi(pureOpenAi, 'claude-sonnet-4-5', null), 'openai-v1');
  });

  test('pure anthropic provider routes all models to anthropic-v1', () => {
    assert.equal(resolveModelApi(pureAnthropic, 'gpt-4o', null), 'anthropic-v1');
  });

  test('accepts runtime wrapper with profile field', () => {
    assert.equal(
      resolveModelApi({ profile: openAiGateway }, 'claude-haiku-4-5', null),
      'anthropic-v1',
    );
  });
});
