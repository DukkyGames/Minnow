/**
 * OpenCode Zen path normalization (MIN-330).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  normalizeOpenCodeZenRelativePath,
  resolveOpenCodeZenUpstreamUrl,
} from '../../server/providers/opencode-zen.js';
import { sanitizeCompletionBodyForProvider } from '../../server/providers/sanitize-completion-body.js';

describe('normalizeOpenCodeZenRelativePath', () => {
  test('strips duplicate /v1 when base already ends with /v1', () => {
    assert.equal(
      normalizeOpenCodeZenRelativePath('https://opencode.ai/zen/v1', '/v1/chat/completions'),
      '/chat/completions',
    );
    assert.equal(
      normalizeOpenCodeZenRelativePath('https://opencode.ai/zen/v1', '/v1/models'),
      '/models',
    );
  });

  test('leaves full zen paths when base is the opencode.ai root', () => {
    assert.equal(
      normalizeOpenCodeZenRelativePath('https://opencode.ai', '/zen/v1/chat/completions'),
      '/zen/v1/chat/completions',
    );
    assert.equal(
      normalizeOpenCodeZenRelativePath('https://opencode.ai', '/zen/v1/models'),
      '/zen/v1/models',
    );
  });

  test('leaves paths unchanged for non-OpenCode hosts', () => {
    assert.equal(
      normalizeOpenCodeZenRelativePath('https://api.openai.com', '/v1/chat/completions'),
      '/v1/chat/completions',
    );
  });
});

describe('resolveOpenCodeZenUpstreamUrl', () => {
  test('uses configured zen paths from opencode.ai root (common setup)', () => {
    assert.equal(
      resolveOpenCodeZenUpstreamUrl('https://opencode.ai', '/zen/v1/chat/completions'),
      'https://opencode.ai/zen/v1/chat/completions',
    );
    assert.equal(
      resolveOpenCodeZenUpstreamUrl('https://opencode.ai', '/zen/v1/models'),
      'https://opencode.ai/zen/v1/models',
    );
  });

  test('normalizes duplicate /v1 when base ends with /zen/v1', () => {
    assert.equal(
      resolveOpenCodeZenUpstreamUrl('https://opencode.ai/zen/v1', '/v1/chat/completions'),
      'https://opencode.ai/zen/v1/chat/completions',
    );
  });

  test('passes through non-OpenCode providers unchanged', () => {
    assert.equal(
      resolveOpenCodeZenUpstreamUrl('https://api.openai.com', '/v1/chat/completions'),
      'https://api.openai.com/v1/chat/completions',
    );
  });
});

describe('sanitizeCompletionBodyForProvider (server)', () => {
  test('strips temperature for gpt-5 on openai-v1', () => {
    const out = sanitizeCompletionBodyForProvider(
      { model: 'gpt-5.4', temperature: 0.7, top_p: 0.9, max_tokens: 512 },
      { apiKind: 'openai-v1' },
    );
    assert.equal(out.temperature, undefined);
    assert.equal(out.top_p, undefined);
    assert.equal(out.max_completion_tokens, 512);
    assert.equal(out.max_tokens, undefined);
  });
});
