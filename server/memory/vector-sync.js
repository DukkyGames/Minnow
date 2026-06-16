/**
 * Memory adapter: binds vector store + config patching into the shared vector-sync engine.
 */

import { readConfigJson, writeConfigJson } from '../config/store.js';
import { createVectorStore } from '../engine/vector-store.js';
import { createVectorSync } from '../engine/vector-sync.js';
import { getEnginePaths } from './engine-paths.js';
import { isValidEntryId } from './paths.js';
import { DEFAULT_MEMORY_CONFIG } from './store.js';

const vectorStore = createVectorStore(getEnginePaths, { isValidEntryId });

/** Patch memory.embeddings fields in config.json without importing store CRUD. */
async function patchEmbeddingsConfig(patch) {
  const config = (await readConfigJson('config.json')) ?? {};
  const memory =
    config.memory && typeof config.memory === 'object'
      ? { ...DEFAULT_MEMORY_CONFIG, ...config.memory }
      : { ...DEFAULT_MEMORY_CONFIG };
  const embeddings =
    memory.embeddings && typeof memory.embeddings === 'object'
      ? { ...memory.embeddings }
      : {};
  config.memory = {
    ...memory,
    embeddings: { ...embeddings, ...patch },
  };
  await writeConfigJson('config.json', config);
}

const vectorSync = createVectorSync(vectorStore, { patchEmbeddingsConfig });

export const {
  markReindexNeeded,
  clearReindexNeeded,
  entryEmbedText,
  syncEntryVector,
  scheduleEntryVectorSync,
  syncDeleteEntryVector,
} = vectorSync;
