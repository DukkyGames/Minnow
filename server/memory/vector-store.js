/**
 * Memory adapter: binds ~/.minnow/memory paths into the shared vector store engine.
 */

import { createVectorStore, cosineSimilarity } from '../engine/vector-store.js';
import { getEnginePaths } from './engine-paths.js';
import { isValidEntryId } from './paths.js';

const vectorStore = createVectorStore(getEnginePaths, { isValidEntryId });

export { cosineSimilarity };

export const {
  getVectorStorePath,
  loadVectorStore,
  saveVectorStore,
  isVectorStoreCompatible,
  upsertEntryVector,
  deleteEntryVector,
  clearVectorStore,
  getVectorCount,
  reindexAllMemoryEntries,
  getEntryVector,
} = vectorStore;
