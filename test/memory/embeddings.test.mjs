/**
 * Embedder timeout and provider fetch tests (no model download).
 */

import assert from 'node:assert/strict';
import { after, describe, mock, test } from 'node:test';

describe('embeddings', () => {
  after(() => {
    mock.restoreAll();
  });

  test('withTimeout rejects slow promises', async () => {
    const { withTimeout } = await import('../../server/memory/embeddings.js');
    await assert.rejects(
      () =>
        withTimeout(
          new Promise((resolve) => {
            setTimeout(() => resolve('late'), 200);
          }),
          20,
        ),
      /timed out/,
    );
  });

  test('withTimeout resolves fast promises', async () => {
    const { withTimeout } = await import('../../server/memory/embeddings.js');
    const value = await withTimeout(Promise.resolve('ok'), 500);
    assert.equal(value, 'ok');
  });

  test('configureTransformersCache points env.cacheDir at ~/.minnow/models/embeddings', async () => {
    const { configureTransformersCache, getEmbeddingsModelDir } = await import(
      '../../server/engine/embeddings.js'
    );
    const cacheDir = await configureTransformersCache();
    assert.equal(cacheDir, getEmbeddingsModelDir());
    const { env } = await import('@xenova/transformers');
    assert.equal(env.cacheDir, cacheDir);
  });

  test('provider embedder uses OpenAI-compatible response shape', async () => {
    mock.method(globalThis, 'fetch', async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      assert.equal(body.model, 'text-embedding-test');
      assert.deepEqual(body.input, ['hello']);
      return {
        ok: true,
        async json() {
          return { data: [{ index: 0, embedding: [0.6, 0.8] }] };
        },
      };
    });

    const runtime = {
      profile: { baseUrl: 'http://127.0.0.1:9999', apiKind: 'openai-v1' },
      headers: { Authorization: 'Bearer test-token' },
    };

    const url = `${runtime.profile.baseUrl}/v1/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...runtime.headers },
      body: JSON.stringify({ model: 'text-embedding-test', input: ['hello'] }),
    });
    const json = await res.json();
    const vector = json.data[0].embedding;
    assert.deepEqual(vector, [0.6, 0.8]);
  });
});
