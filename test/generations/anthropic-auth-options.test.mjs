/**
 * Anthropic bridge auth — OpenCode Zen uses x-api-key on Messages API.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildAuthOptions } from '../../server/generations/anthropic/provider-runtime.js';

describe('buildAuthOptions', () => {
  test('OpenCode Zen uses x-api-key from apiKey secret with bearer authStyle', () => {
    assert.deepEqual(
      buildAuthOptions(
        { baseUrl: 'https://opencode.ai/zen', authStyle: 'bearer' },
        { apiKey: 'zen-key-123' },
      ),
      { apiKey: 'zen-key-123' },
    );
  });

  test('OpenCode Zen falls back to bearerToken secret', () => {
    assert.deepEqual(
      buildAuthOptions(
        { baseUrl: 'https://opencode.ai/zen/go', authStyle: 'bearer' },
        { bearerToken: 'zen-token-456' },
      ),
      { apiKey: 'zen-token-456' },
    );
  });

  test('native Anthropic with x-api-key authStyle uses apiKey', () => {
    assert.deepEqual(
      buildAuthOptions(
        { baseUrl: 'https://api.anthropic.com', authStyle: 'x-api-key' },
        { apiKey: 'sk-ant-123' },
      ),
      { apiKey: 'sk-ant-123' },
    );
  });

  test('OpenRouter gateway keeps Bearer authToken for anthropic bridge', () => {
    assert.deepEqual(
      buildAuthOptions(
        { baseUrl: 'https://openrouter.ai/api', authStyle: 'bearer' },
        { apiKey: 'sk-or-123' },
      ),
      { authToken: 'sk-or-123' },
    );
  });
});
