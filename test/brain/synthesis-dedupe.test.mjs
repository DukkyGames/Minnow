/**
 * isDuplicateMemory — vector dedupe must threshold on similarity, not top-k hits.
 *
 * Regression: with embeddings enabled, hybrid top-k retrieval returned ids for
 * ANY query once one page existed (no score cutoff + recent/pinned fallback),
 * so every new fact was marked duplicate and synthesis never wrote again.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isDuplicateMemory,
  VECTOR_DUPLICATE_THRESHOLD,
} from '../../server/brain/synthesis.js';

const PAGE_ID = '11111111-1111-4111-8111-111111111111';

function makeExisting(title, body) {
  return [{ meta: { id: PAGE_ID, title, path: 'facts/x.md' }, body }];
}

const EMB_ON = {
  embeddings: { enabled: true, backend: 'local', modelId: 'test-model', queryTimeoutMs: 100 },
};
const EMB_OFF = { embeddings: { enabled: false } };

function makeDeps({ storedVector, queryVector }) {
  return {
    getEmbedder: async () => ({ id: 'test-model', dim: queryVector.length }),
    embedTexts: async () => [queryVector],
    loadVectorStore: async () => ({
      model: 'test-model',
      backend: 'local',
      dim: queryVector.length,
      vectors: storedVector ? { [PAGE_ID]: storedVector } : {},
    }),
    getEntryVector: async () => storedVector ?? null,
  };
}

describe('isDuplicateMemory', () => {
  test('threshold is meaningfully high', () => {
    assert.ok(VECTOR_DUPLICATE_THRESHOLD >= 0.85 && VECTOR_DUPLICATE_THRESHOLD < 1);
  });

  test('embeddings off: distinct fact is not a duplicate', async () => {
    const dup = await isDuplicateMemory(
      'Favorite editor',
      'The user prefers Neovim',
      makeExisting('Lives in Berlin', 'The user lives in Berlin'),
      EMB_OFF,
    );
    assert.equal(dup, false);
  });

  test('embeddings off: contained fact is a duplicate', async () => {
    const dup = await isDuplicateMemory(
      'Lives in Berlin',
      'The user lives in Berlin',
      makeExisting('Location', 'Note: Lives in Berlin The user lives in Berlin — confirmed twice'),
      EMB_OFF,
    );
    assert.equal(dup, true);
  });

  test('embeddings on: dissimilar vector is NOT a duplicate (regression)', async () => {
    const dup = await isDuplicateMemory(
      'Favorite editor',
      'The user prefers Neovim',
      makeExisting('Lives in Berlin', 'The user lives in Berlin'),
      EMB_ON,
      makeDeps({ storedVector: [1, 0, 0], queryVector: [0, 1, 0] }),
    );
    assert.equal(dup, false);
  });

  test('embeddings on: near-identical vector is a duplicate', async () => {
    const dup = await isDuplicateMemory(
      'Home city',
      'User is based in Berlin',
      makeExisting('Lives in Berlin', 'The user lives in Berlin'),
      EMB_ON,
      makeDeps({ storedVector: [1, 0.01, 0], queryVector: [1, 0, 0] }),
    );
    assert.equal(dup, true);
  });

  test('embeddings on but embedder unavailable: falls back to keyword check', async () => {
    const dup = await isDuplicateMemory(
      'Favorite editor',
      'The user prefers Neovim',
      makeExisting('Lives in Berlin', 'The user lives in Berlin'),
      EMB_ON,
      {
        getEmbedder: async () => {
          throw new Error('no model');
        },
      },
    );
    assert.equal(dup, false);
  });

  test('embeddings on with incompatible store: falls back to keyword check', async () => {
    const deps = makeDeps({ storedVector: [1, 0, 0], queryVector: [1, 0, 0] });
    deps.loadVectorStore = async () => ({
      model: 'other-model',
      backend: 'local',
      dim: 3,
      vectors: {},
    });
    const dup = await isDuplicateMemory(
      'Favorite editor',
      'The user prefers Neovim',
      makeExisting('Lives in Berlin', 'The user lives in Berlin'),
      EMB_ON,
      deps,
    );
    assert.equal(dup, false);
  });
});
