/**
 * Server mirror of the completion-body sanitizer — this is the copy that runs on
 * the /api/generations upstream path, so the local-runtime gating has to match
 * src/providers/sanitize-completion-body.ts.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sanitizeCompletionBodyForProvider } from '../../server/providers/sanitize-completion-body.js';

const OPENAI = { apiKind: 'openai-v1', id: 'opencode-zen' };

describe('server sanitizeCompletionBodyForProvider', () => {
  test('keeps chat_template_kwargs only for local runtime providers', () => {
    const body = () => ({
      model: 'qwen3',
      chat_template_kwargs: { enable_thinking: false },
    });

    for (const id of ['llama-cpp-local', 'mlx-lm-local']) {
      const kept = sanitizeCompletionBodyForProvider(body(), { ...OPENAI, id }, {
        reasoning: true,
      });
      assert.deepEqual(kept.chat_template_kwargs, { enable_thinking: false });
    }

    const stripped = sanitizeCompletionBodyForProvider(body(), OPENAI, {
      reasoning: true,
    });
    assert.equal(stripped.chat_template_kwargs, undefined);
  });

  test('leaves non-openai-v1 bodies untouched', () => {
    const body = { model: 'qwen3', chat_template_kwargs: { enable_thinking: false } };
    const out = sanitizeCompletionBodyForProvider(body, {
      apiKind: 'lm-studio-v0',
      id: 'lm-studio-local',
    });
    assert.deepEqual(out.chat_template_kwargs, { enable_thinking: false });
  });

  test('keeps an explicit thinking disable through sanitization', () => {
    const out = sanitizeCompletionBodyForProvider(
      {
        model: 'qwen3',
        thinking: { type: 'disabled' },
        chat_template_kwargs: { enable_thinking: false },
      },
      { ...OPENAI, id: 'llama-cpp-local' },
      { reasoning: false },
    );
    assert.deepEqual(out.thinking, { type: 'disabled' });
    assert.deepEqual(out.chat_template_kwargs, { enable_thinking: false });
  });
});
