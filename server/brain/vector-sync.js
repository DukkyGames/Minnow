/**
 * Brain adapter: binds vector store + config patching into the shared vector-sync engine.
 */

import { readConfigJson, writeConfigJson } from '../config/store.js';
import { createVectorStore } from '../engine/vector-store.js';
import { createVectorSync } from '../engine/vector-sync.js';
import { DEFAULT_EMBEDDINGS_CONFIG } from '../engine/embeddings.js';
import { getEnginePaths } from './engine-paths.js';
import { isValidPageId } from './paths.js';

const DEFAULT_BRAIN_CONFIG = {
  embeddings: { ...DEFAULT_EMBEDDINGS_CONFIG },
};

const vectorStore = createVectorStore(getEnginePaths, { isValidEntryId: isValidPageId });

/** Patch brain.embeddings fields in config.json. */
async function patchEmbeddingsConfig(patch) {
  const config = (await readConfigJson('config.json')) ?? {};
  const brain =
    config.brain && typeof config.brain === 'object'
      ? { ...DEFAULT_BRAIN_CONFIG, ...config.brain }
      : { ...DEFAULT_BRAIN_CONFIG };
  const memoryEmb =
    config.memory?.embeddings && typeof config.memory.embeddings === 'object'
      ? config.memory.embeddings
      : {};
  const embeddings =
    brain.embeddings && typeof brain.embeddings === 'object'
      ? { ...DEFAULT_EMBEDDINGS_CONFIG, ...memoryEmb, ...brain.embeddings }
      : { ...DEFAULT_EMBEDDINGS_CONFIG, ...memoryEmb };
  config.brain = {
    ...brain,
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

export { DEFAULT_BRAIN_CONFIG };
