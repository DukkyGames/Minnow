/**
 * OpenAI-safe completion body sanitization for sub-agents.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sanitizeCompletionBodyForProvider } from '../../src/providers/sanitize-completion-body.ts';
import type { ProviderPublic } from '../../src/providers/types.ts';

const OPENAI: ProviderPublic = {
  id: 'openai-v1',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com',
  apiKind: 'openai-v1',
  enabled: true,
  hasApiKey: true,
  hasBearer: false,
};

const LM_STUDIO: ProviderPublic = {
  id: 'lm-studio-local',
  label: 'LM Studio',
  baseUrl: 'http://127.0.0.1:1234',
  apiKind: 'lm-studio-v0',
  enabled: true,
  hasApiKey: false,
  hasBearer: false,
};

describe('sanitizeCompletionBodyForProvider', () => {
  test('strips LM Studio sampler fields for openai-v1', () => {
    const out = sanitizeCompletionBodyForProvider(
      {
        model: 'gpt-4o-mini',
        messages: [],
        temperature: 0.7,
        top_k: 20,
        min_p: 0.05,
        repetition_penalty: 1.1,
        enable_thinking: false,
      },
      OPENAI,
    );
    assert.equal(out.top_k, undefined);
    assert.equal(out.min_p, undefined);
    assert.equal(out.repetition_penalty, undefined);
    assert.equal(out.enable_thinking, undefined);
    assert.equal(out.temperature, 0.7);
  });

  test('removes thinking when model has no reasoning capability', () => {
    const out = sanitizeCompletionBodyForProvider(
      {
        model: 'gpt-4o-mini',
        thinking: { type: 'disabled' },
        reasoning: { effort: 'medium' },
        reasoning_effort: 'medium',
      },
      OPENAI,
      { reasoning: false },
    );
    assert.equal(out.thinking, undefined);
    assert.equal(out.reasoning, undefined);
    assert.equal(out.reasoning_effort, undefined);
  });

  test('preserves reasoning fields when model supports reasoning options', () => {
    const out = sanitizeCompletionBodyForProvider(
      {
        model: 'o3-mini',
        reasoning_effort: 'high',
        reasoning: { effort: 'high' },
      },
      OPENAI,
      { reasoning: true, reasoningAllowedOptions: ['low', 'medium', 'high'] },
    );
    assert.equal(out.reasoning_effort, 'high');
    assert.deepEqual(out.reasoning, { effort: 'high' });
  });

  test('maps max_tokens to max_completion_tokens for o-series models', () => {
    const out = sanitizeCompletionBodyForProvider(
      { model: 'o3-mini', max_tokens: 1024 },
      OPENAI,
    );
    assert.equal(out.max_completion_tokens, 1024);
    assert.equal(out.max_tokens, undefined);
  });

  test('strips temperature and top_p for gpt-5 models on openai-v1', () => {
    const out = sanitizeCompletionBodyForProvider(
      { model: 'gpt-5.4', temperature: 0.7, top_p: 0.9 },
      OPENAI,
    );
    assert.equal(out.temperature, undefined);
    assert.equal(out.top_p, undefined);
  });

  test('leaves body unchanged for lm-studio-v0', () => {
    const body = { model: 'local', top_k: 20, max_tokens: 512 };
    const out = sanitizeCompletionBodyForProvider(body, LM_STUDIO);
    assert.deepEqual(out, body);
  });

  test('forces temperature=1 for Kimi models on openai-v1', () => {
    const out = sanitizeCompletionBodyForProvider(
      { model: 'kimi-k2', temperature: 0.7 },
      OPENAI,
    );
    assert.equal(out.temperature, 1);
  });

  test('leaves temperature unchanged for Kimi models on lm-studio-v0', () => {
    const out = sanitizeCompletionBodyForProvider(
      { model: 'moonshotai/Kimi-K2-Instruct', temperature: 0.7 },
      LM_STUDIO,
    );
    assert.equal(out.temperature, 0.7);
  });

  test('does not alter temperature=1 for Kimi models', () => {
    const out = sanitizeCompletionBodyForProvider(
      { model: 'kimi-k2', temperature: 1 },
      OPENAI,
    );
    assert.equal(out.temperature, 1);
  });
});
