/**
 * Sidecar JSON vector index for semantic retrieval.
 * Paths are injected via createVectorStore — no memory-specific imports.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_VERSION = 1;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default empty vector store shape. */
const DEFAULT_STORE = {
  version: STORE_VERSION,
  model: '',
  backend: '',
  dim: 0,
  vectors: {},
};

/**
 * @typedef {{ rootDir: string, vectorsPath: string, proposalsPath: string, backupsDir: string }} EnginePaths
 */

/**
 * Validate entry id (UUID v4 style).
 * @param {string} id
 */
function isValidEntryId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Cosine similarity between two equal-length vectors.
 * Returns 0 when dimensions mismatch or either vector has zero magnitude.
 * @param {number[]} a
 * @param {number[]} b
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = Number(a[i]) || 0;
    const vb = Number(b[i]) || 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }

  if (magA <= 0 || magB <= 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Create a path-parameterized vector store API.
 * @param {() => EnginePaths} getPaths
 * @param {{ isValidEntryId?: (id: string) => boolean }} [opts]
 */
export function createVectorStore(getPaths, opts = {}) {
  const validateEntryId = opts.isValidEntryId ?? isValidEntryId;

  /** Resolve vectors.json path from injected paths. */
  function getVectorStorePath() {
    return getPaths().vectorsPath;
  }

  /** Load vector store from disk; returns default when missing or corrupt. */
  async function loadVectorStore() {
    const storePath = getVectorStorePath();
    try {
      const raw = await fs.readFile(storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_STORE, vectors: {} };
      const vectors =
        parsed.vectors && typeof parsed.vectors === 'object' ? { ...parsed.vectors } : {};
      return {
        version: parsed.version ?? STORE_VERSION,
        model: typeof parsed.model === 'string' ? parsed.model : '',
        backend: typeof parsed.backend === 'string' ? parsed.backend : '',
        dim: typeof parsed.dim === 'number' ? parsed.dim : 0,
        vectors,
      };
    } catch {
      return { ...DEFAULT_STORE, vectors: {} };
    }
  }

  /** Atomic write of the full vector store. */
  async function saveVectorStore(store) {
    const storePath = getVectorStorePath();
    const tmp = `${storePath}.tmp`;
    const payload = {
      version: STORE_VERSION,
      model: store.model ?? '',
      backend: store.backend ?? '',
      dim: store.dim ?? 0,
      vectors: store.vectors ?? {},
    };
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, storePath);
  }

  /**
   * Whether the on-disk vector index matches the active embedder config.
   * @param {object} store
   * @param {{ modelId?: string, backend?: string, dim?: number }} embeddingsConfig
   */
  function isVectorStoreCompatible(store, embeddingsConfig) {
    const modelId = String(embeddingsConfig?.modelId ?? '').trim();
    const backend = String(embeddingsConfig?.backend ?? 'local').trim() || 'local';
    const dim = Number(embeddingsConfig?.dim ?? store.dim ?? 0);
    if (!modelId || !store.model) return false;
    if (store.model !== modelId) return false;
    if (store.backend !== backend) return false;
    if (dim > 0 && store.dim > 0 && store.dim !== dim) return false;
    return true;
  }

  /**
   * Upsert one entry vector; updates store metadata when provided.
   * @param {string} entryId
   * @param {number[]} vector
   * @param {{ model?: string, backend?: string, dim?: number }} [meta]
   */
  async function upsertEntryVector(entryId, vector, meta = {}) {
    if (!validateEntryId(entryId)) {
      throw new Error('Invalid memory entry id');
    }
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('Vector must be a non-empty array');
    }

    const store = await loadVectorStore();
    const dim = vector.length;

    if (store.dim > 0 && store.dim !== dim) {
      throw new Error('Vector dimension mismatch');
    }

    if (meta.model) store.model = meta.model;
    if (meta.backend) store.backend = meta.backend;
    store.dim = dim;
    store.vectors[entryId] = vector;
    await saveVectorStore(store);
  }

  /** Remove one entry vector from the sidecar index. */
  async function deleteEntryVector(entryId) {
    if (!validateEntryId(entryId)) return false;
    const store = await loadVectorStore();
    if (!(entryId in store.vectors)) return false;
    delete store.vectors[entryId];
    await saveVectorStore(store);
    return true;
  }

  /** Clear all vectors while preserving metadata fields. */
  async function clearVectorStore() {
    const store = await loadVectorStore();
    store.vectors = {};
    await saveVectorStore(store);
  }

  /** Count indexed vectors. */
  async function getVectorCount() {
    const store = await loadVectorStore();
    return Object.keys(store.vectors).length;
  }

  /**
   * Rebuild the vector index for all entries.
   * @param {(text: string) => Promise<number[]>} embedOne
   * @param {Array<{ meta: object, body: string }>} entries
   * @param {{ model: string, backend: string, dim: number }} meta
   */
  async function reindexAllMemoryEntries(embedOne, entries, meta) {
    const next = {
      version: STORE_VERSION,
      model: meta.model,
      backend: meta.backend,
      dim: meta.dim,
      vectors: {},
    };

    let indexed = 0;
    let failed = 0;

    for (const { meta: entryMeta, body } of entries) {
      const id = entryMeta?.id;
      if (!validateEntryId(id)) {
        failed += 1;
        continue;
      }
      try {
        const text = `${String(entryMeta.title ?? '')}\n${String(body ?? '')}`.trim();
        const vector = await embedOne(text);
        if (!Array.isArray(vector) || vector.length === 0) {
          failed += 1;
          continue;
        }
        next.dim = vector.length;
        next.vectors[id] = vector;
        indexed += 1;
      } catch {
        failed += 1;
      }
    }

    await saveVectorStore(next);
    return { indexed, failed };
  }

  /** Lookup a stored vector for an entry id. */
  async function getEntryVector(entryId) {
    if (!validateEntryId(entryId)) return null;
    const store = await loadVectorStore();
    const vector = store.vectors[entryId];
    return Array.isArray(vector) ? vector : null;
  }

  return {
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
  };
}
