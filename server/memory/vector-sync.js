/**
 * Keep vector sidecar in sync with memory entry CRUD (non-blocking on API paths).
 */

import { readConfigJson, writeConfigJson } from '../config/store.js';
import { getEmbedder, embedTexts, DEFAULT_EMBEDDINGS_CONFIG } from './embeddings.js';
import {
  upsertEntryVector,
  deleteEntryVector,
  isVectorStoreCompatible,
  loadVectorStore,
} from './vector-store.js';
import { DEFAULT_MEMORY_CONFIG } from './store.js';

/**
 * Patch memory.embeddings fields in config.json without importing store CRUD.
 * @param {Record<string, unknown>} patch
 */
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

/** Mark embeddings reindex flag in config.json. */
export async function markReindexNeeded() {
  await patchEmbeddingsConfig({ reindexNeeded: true });
}

/** Clear reindex-needed flag after a successful full reindex. */
export async function clearReindexNeeded() {
  await patchEmbeddingsConfig({ reindexNeeded: false });
}

/**
 * Build embed text for a memory entry (title + body).
 * @param {{ title?: string }} meta
 * @param {string} body
 */
export function entryEmbedText(meta, body) {
  return `${String(meta?.title ?? '')}\n${String(body ?? '')}`.trim();
}

/**
 * Embed and upsert one entry vector. Logs and marks reindex on failure.
 * @param {{ id: string, title?: string }} meta
 * @param {string} body
 * @param {object} memoryConfig
 * @param {{ getEmbedder?: typeof getEmbedder, embedTexts?: typeof embedTexts }} [deps]
 */
export async function syncEntryVector(meta, body, memoryConfig, deps = {}) {
  const getEmbedderFn = deps.getEmbedder ?? getEmbedder;
  const embedTextsFn = deps.embedTexts ?? embedTexts;
  const emb = {
    ...DEFAULT_EMBEDDINGS_CONFIG,
    ...(memoryConfig?.embeddings && typeof memoryConfig.embeddings === 'object'
      ? memoryConfig.embeddings
      : {}),
  };
  if (!emb.enabled) return;

  try {
    const embedder = await getEmbedderFn(memoryConfig);
    const store = await loadVectorStore();
    if (
      Object.keys(store.vectors).length > 0 &&
      !isVectorStoreCompatible(store, {
        modelId: embedder.id,
        backend: emb.backend,
        dim: embedder.dim,
      })
    ) {
      await markReindexNeeded();
      return;
    }

    const [vector] = await embedTextsFn(
      embedder,
      [entryEmbedText(meta, body)],
      emb.queryTimeoutMs,
    );
    await upsertEntryVector(meta.id, vector, {
      model: embedder.id,
      backend: emb.backend,
      dim: vector.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[memory] vector sync failed for ${meta.id}: ${message}`);
    await markReindexNeeded();
  }
}

/**
 * Fire-and-forget vector sync (does not block API responses).
 * @param {{ id: string, title?: string }} meta
 * @param {string} body
 * @param {object} memoryConfig
 */
export function scheduleEntryVectorSync(meta, body, memoryConfig) {
  void syncEntryVector(meta, body, memoryConfig);
}

/**
 * Remove vector for a deleted entry.
 * @param {string} entryId
 */
export async function syncDeleteEntryVector(entryId) {
  try {
    await deleteEntryVector(entryId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[memory] vector delete failed for ${entryId}: ${message}`);
  }
}
