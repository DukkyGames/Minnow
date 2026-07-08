/**
 * Anthropic provider runtime — gateway model config hardening.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildAnthropicProvider } from '../../server/generations/anthropic/provider-runtime.js';

describe('buildAnthropicProvider gateway wrapper', () => {
  test('disables structured output betas for OpenCode Zen hosts', () => {
    const provider = buildAnthropicProvider({
      profile: { baseUrl: 'https://opencode.ai/zen', authStyle: 'bearer' },
      paths: { chatCompletionsPath: '/v1/chat/completions', messagesPath: '/v1/messages' },
      secrets: { apiKey: 'test-token' },
    });

    const model = provider('claude-opus-4-6');
    assert.equal(model.config.supportsNativeStructuredOutput, false);
    assert.equal(model.config.supportsStrictTools, false);
    assert.equal(typeof model.config.transformRequestBody, 'function');
  });

  test('derives Zen messages URL from baseUrl path prefix', () => {
    const provider = buildAnthropicProvider({
      profile: { baseUrl: 'https://opencode.ai/zen', authStyle: 'bearer' },
      paths: { chatCompletionsPath: '/v1/chat/completions' },
      secrets: { apiKey: 'test-token' },
    });

    const model = provider('claude-opus-4-8');
    assert.equal(model.config.baseURL, 'https://opencode.ai/zen/v1');
  });

  test('leaves native Anthropic hosts unchanged', () => {
    const provider = buildAnthropicProvider({
      profile: { baseUrl: 'https://api.anthropic.com', authStyle: 'x-api-key' },
      paths: { chatCompletionsPath: '/v1/messages' },
      secrets: { apiKey: 'test-key' },
    });

    const model = provider('claude-opus-4-6');
    assert.equal(model.config.supportsNativeStructuredOutput, undefined);
    assert.equal(model.config.supportsStrictTools, undefined);
    assert.equal(model.config.transformRequestBody, undefined);
  });
});
