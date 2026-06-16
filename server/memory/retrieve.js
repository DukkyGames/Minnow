/**
 * Memory adapter: binds ~/.minnow/memory paths into the shared retrieve engine.
 */

import { bindRetrieveVectorStore } from '../engine/retrieve.js';
import { createVectorStore } from '../engine/vector-store.js';
import { getEnginePaths } from './engine-paths.js';
import { isValidEntryId } from './paths.js';

const vectorStore = createVectorStore(getEnginePaths, { isValidEntryId });
bindRetrieveVectorStore(vectorStore);

export * from '../engine/retrieve.js';
