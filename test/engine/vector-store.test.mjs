/**
 * Engine vector store smoke test — arbitrary rootDir, no memory dir coupling.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createVectorStore } from '../../server/engine/vector-store.js';

const ENTRY_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** @type {string} */
let rootDir;

/** @type {ReturnType<typeof createVectorStore>} */
let vectorStore;

before(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-engine-vector-'));
  const vectorsPath = path.join(rootDir, 'vectors.json');
  const getPaths = () => ({
    rootDir,
    vectorsPath,
    proposalsPath: path.join(rootDir, 'proposals.json'),
    backupsDir: path.join(rootDir, 'backups'),
  });
  vectorStore = createVectorStore(getPaths);
});

after(async () => {
  await fs.rm(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('engine vector store', () => {
  test('round-trips a vector under the injected rootDir', async () => {
    const vector = [0.6, 0.8, 0.0];
    await vectorStore.upsertEntryVector(ENTRY_ID, vector, {
      model: 'smoke-model',
      backend: 'local',
      dim: 3,
    });

    const stored = await vectorStore.getEntryVector(ENTRY_ID);
    assert.deepEqual(stored, vector);
    assert.equal(await vectorStore.getVectorCount(), 1);

    const vectorsFile = path.join(rootDir, 'vectors.json');
    const raw = await fs.readFile(vectorsFile, 'utf8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.vectors[ENTRY_ID], vector);
    assert.equal(vectorStore.getVectorStorePath(), vectorsFile);
    assert.equal(path.dirname(vectorsFile), rootDir);
  });
});
