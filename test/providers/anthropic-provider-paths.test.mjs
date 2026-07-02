/**
 * Default paths and base URL derivation for anthropic-v1 providers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getDefaultPaths,
  getProviderCapabilities,
} from '../../server/providers/paths.js';
import { deriveAnthropicBaseUrl } from '../../server/generations/anthropic/provider-runtime.js';

describe('anthropic-v1 default paths', () => {
  test('uses messages path and omits load/unload paths', () => {
    const paths = getDefaultPaths('anthropic-v1');

    assert.equal(paths.modelsPath, '/v1/models');
    assert.equal(paths.chatCompletionsPath, '/v1/messages');
    assert.equal(paths.embeddingsPath, '/v1/embeddings');
    assert.equal(paths.modelsLoadPath, undefined);
    assert.equal(paths.modelsUnloadPath, undefined);
  });

  test('does not support model load/unload', () => {
    assert.equal(getProviderCapabilities('anthropic-v1').supportsModelLoadUnload, false);
  });
});

describe('deriveAnthropicBaseUrl', () => {
  test('derives Zen gateway base from opencode.ai messages path', () => {
    assert.equal(
      deriveAnthropicBaseUrl('https://opencode.ai', '/zen/v1/messages'),
      'https://opencode.ai/zen/v1',
    );
  });

  test('derives native Anthropic base from /v1/messages', () => {
    assert.equal(
      deriveAnthropicBaseUrl('https://api.anthropic.com', '/v1/messages'),
      'https://api.anthropic.com/v1',
    );
  });
});
