/**
 * Server mirror of the completion-body sanitizer — this is the copy that runs on
 * the /api/generations upstream path, so the local-runtime gating has to match
 * src/providers/sanitize-completion-body.ts.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sanitizeCompletionBodyForProvider } from '../../server/providers/sanitize-completion-body.js';
import {
  EXTENDED_SAMPLER_BODY,
  EXTENDED_SAMPLER_CASES,
} from './sanitize-extended-samplers.fixtures.mjs';

const OPENAI = { apiKind: 'openai-v1', id: 'opencode-zen' };

describe('server sanitizeCompletionBodyForProvider', () => {
  test('keeps chat_template_kwargs for local runtime and loopback openai-v1 providers', () => {
    const body = () => ({
      model: 'qwen3',
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
    });

    for (const id of ['llama-cpp-local', 'mlx-lm-local']) {
      const kept = sanitizeCompletionBodyForProvider(body(), { ...OPENAI, id }, {
        reasoning: true,
      });
      assert.deepEqual(kept.chat_template_kwargs, { enable_thinking: false });
      assert.equal(kept.enable_thinking, false);
    }

    const mtplx = sanitizeCompletionBodyForProvider(body(), {
      ...OPENAI,
      id: 'mtplx-local',
      baseUrl: 'http://127.0.0.1:8000',
    }, {
      reasoning: true,
    });
    assert.deepEqual(mtplx.chat_template_kwargs, { enable_thinking: false });
    assert.equal(mtplx.enable_thinking, false);

    const stripped = sanitizeCompletionBodyForProvider(body(), OPENAI, {
      reasoning: true,
    });
    assert.equal(stripped.chat_template_kwargs, undefined);
    assert.equal(stripped.enable_thinking, undefined);
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

describe('extended sampler keep vs strip (shared fixtures)', () => {
  for (const fixture of EXTENDED_SAMPLER_CASES) {
    test(fixture.name, () => {
      const out = sanitizeCompletionBodyForProvider(
        { ...EXTENDED_SAMPLER_BODY },
        fixture.provider,
      );
      for (const key of fixture.keep) {
        assert.equal(out[key], EXTENDED_SAMPLER_BODY[key], `expected to keep ${key}`);
      }
      for (const key of fixture.strip) {
        assert.equal(out[key], undefined, `expected to strip ${key}`);
      }
    });
  }
});
