/**
 * Vector store cosine math and CRUD tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  cosineSimilarity,
  upsertEntryVector,
  deleteEntryVector,
  loadVectorStore,
  getVectorCount,
  isVectorStoreCompatible,
  reindexAllMemoryEntries,
} from '../../server/memory/vector-store.js';

const ENTRY_A = '11111111-1111-1111-1111-111111111111';
const ENTRY_B = '22222222-2222-2222-2222-222222222222';

let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-vector-store-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
});

after(async () => {
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('vector store', () => {
  test('cosineSimilarity returns 1 for identical unit vectors', () => {
    const v = [1, 0, 0];
    assert.equal(cosineSimilarity(v, v), 1);
  });

  test('cosineSimilarity returns 0 for orthogonal vectors', () => {
    assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
  });

  test('cosineSimilarity returns 0 for dimension mismatch', () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
  });

  test('cosineSimilarity returns 0 for zero vectors', () => {
    assert.equal(cosineSimilarity([0, 0, 0], [1, 0, 0]), 0);
  });

  test('upsert and delete entry vectors', async () => {
    await upsertEntryVector(ENTRY_A, [0.6, 0.8], {
      model: 'test-model',
      backend: 'local',
      dim: 2,
    });
    assert.equal(await getVectorCount(), 1);

    const store = await loadVectorStore();
    assert.equal(store.model, 'test-model');
    assert.deepEqual(store.vectors[ENTRY_A], [0.6, 0.8]);

    await upsertEntryVector(ENTRY_B, [1, 0], { model: 'test-model', backend: 'local', dim: 2 });
    assert.equal(await getVectorCount(), 2);

    const removed = await deleteEntryVector(ENTRY_A);
    assert.equal(removed, true);
    assert.equal(await getVectorCount(), 1);
  });

  test('reject invalid entry id', async () => {
    await assert.rejects(() => upsertEntryVector('bad-id', [1, 0]), /Invalid memory entry id/);
  });

  test('model mismatch detection', async () => {
    const store = {
      version: 1,
      model: 'model-a',
      backend: 'local',
      dim: 3,
      vectors: {},
    };
    assert.equal(
      isVectorStoreCompatible(store, { modelId: 'model-a', backend: 'local', dim: 3 }),
      true,
    );
    assert.equal(
      isVectorStoreCompatible(store, { modelId: 'model-b', backend: 'local', dim: 3 }),
      false,
    );
    assert.equal(
      isVectorStoreCompatible(store, { modelId: 'model-a', backend: 'provider', dim: 3 }),
      false,
    );
  });

  test('reindexAllMemoryEntries rebuilds sidecar', async () => {
    const entries = [
      {
        meta: { id: ENTRY_A, title: 'Alpha' },
        body: 'First body',
      },
      {
        meta: { id: ENTRY_B, title: 'Beta' },
        body: 'Second body',
      },
    ];

    const result = await reindexAllMemoryEntries(
      async (text) => (text.includes('Alpha') ? [1, 0, 0] : [0, 1, 0]),
      entries,
      { model: 'fixture-model', backend: 'local', dim: 3 },
    );

    assert.equal(result.indexed, 2);
    assert.equal(result.failed, 0);
    const store = await loadVectorStore();
    assert.equal(store.model, 'fixture-model');
    assert.deepEqual(store.vectors[ENTRY_A], [1, 0, 0]);
    assert.deepEqual(store.vectors[ENTRY_B], [0, 1, 0]);
  });
});
