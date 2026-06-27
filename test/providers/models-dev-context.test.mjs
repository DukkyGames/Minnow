/**
 * OpenCode providers enrich model context from models.dev.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichOpenCodeModelsFromModelsDev,
  isOpenCodeProviderBaseUrl,
  resetModelsDevContextCacheForTests,
} from '../../server/providers/models-dev-context.js';

describe('models-dev-context', () => {
  beforeEach(() => {
    resetModelsDevContextCacheForTests();
  });

  it('isOpenCodeProviderBaseUrl matches opencode.ai hosts', () => {
    assert.equal(isOpenCodeProviderBaseUrl('https://opencode.ai/zen/v1'), true);
    assert.equal(isOpenCodeProviderBaseUrl('https://opencode.ai/zen/go/v1'), true);
    assert.equal(isOpenCodeProviderBaseUrl('http://localhost:1234/v1'), false);
    assert.equal(isOpenCodeProviderBaseUrl('https://openrouter.ai/api/v1'), false);
  });

  it('enrichOpenCodeModelsFromModelsDev attaches limit.context by exact id', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.equal(String(url), 'https://models.dev/api.json');
      return {
        ok: true,
        async json() {
          return {
            opencode: {
              models: {
                'claude-opus-4-8': { limit: { context: 1_000_000, output: 128_000 } },
                'big-pickle': { limit: { context: 200_000, output: 32_000 } },
              },
            },
          };
        },
      };
    };

    try {
      const out = await enrichOpenCodeModelsFromModelsDev({
        data: [
          { id: 'claude-opus-4-8', type: 'llm', state: 'loaded' },
          { id: 'big-pickle', type: 'llm', state: 'loaded' },
          { id: 'unknown-model', type: 'llm', state: 'loaded' },
        ],
      });

      assert.equal(out.data[0].max_context_length, 1_000_000);
      assert.equal(out.data[1].max_context_length, 200_000);
      assert.equal(out.data[2].max_context_length, undefined);
    } finally {
      globalThis.fetch = originalFetch;
      resetModelsDevContextCacheForTests();
    }
  });

  it('enrichOpenCodeModelsFromModelsDev overrides stale substring fallback values', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      async json() {
        return {
          opencode: {
            models: {
              'gpt-5.5': { limit: { context: 1_050_000, output: 128_000 } },
            },
          },
        };
      },
    });

    try {
      const out = await enrichOpenCodeModelsFromModelsDev({
        data: [{ id: 'gpt-5.5', type: 'llm', state: 'loaded', max_context_length: 400_000 }],
      });
      assert.equal(out.data[0].max_context_length, 1_050_000);
    } finally {
      globalThis.fetch = originalFetch;
      resetModelsDevContextCacheForTests();
    }
  });
});
