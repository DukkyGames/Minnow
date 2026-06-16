/**
 * Pluggable memory embedder: local transformers.js first, provider /v1/embeddings optional.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { getProviderRuntime } from '../providers/store.js';
import { getDefaultPaths } from '../providers/paths.js';

/** Default local model (384-d MiniLM). */
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

/** Default embeddings subsection in memory config. */
export const DEFAULT_EMBEDDINGS_CONFIG = {
  enabled: false,
  backend: 'local',
  modelId: DEFAULT_EMBEDDING_MODEL,
  providerId: '',
  blendWeight: 0.5,
  queryTimeoutMs: 3000,
  reindexNeeded: false,
};

/** Cached local pipeline promise keyed by model id. */
const localPipelineCache = new Map();

/**
 * Resolve on-disk cache directory for local embedding models.
 */
export function getEmbeddingsModelDir() {
  return path.join(getMinnowHome(), 'models', 'embeddings');
}

/**
 * Apply Windows-friendly Hugging Face cache settings before model download.
 */
export function applyEmbeddingsEnv() {
  process.env.TRANSFORMERS_CACHE = getEmbeddingsModelDir();
  if (process.platform === 'win32') {
    process.env.HF_HUB_DISABLE_SYMLINKS = '1';
  }
}

/**
 * Reject a promise after timeoutMs.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} [message]
 */
export function withTimeout(promise, timeoutMs, message = 'Embedding request timed out') {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Embed texts with timeout wrapper.
 * @param {{ embed: (texts: string[]) => Promise<number[][]>, id: string, dim: number, backend: string }} embedder
 * @param {string[]} texts
 * @param {number} timeoutMs
 */
export async function embedTexts(embedder, texts, timeoutMs) {
  const list = Array.isArray(texts) ? texts.map((t) => String(t ?? '')) : [''];
  return withTimeout(embedder.embed(list), timeoutMs);
}

/**
 * Create a local transformers.js embedder.
 * @param {{ modelId?: string }} config
 */
export async function createLocalEmbedder(config = {}) {
  const modelId = String(config.modelId ?? DEFAULT_EMBEDDING_MODEL).trim() || DEFAULT_EMBEDDING_MODEL;
  applyEmbeddingsEnv();

  let pipelinePromise = localPipelineCache.get(modelId);
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', modelId);
    })();
    localPipelineCache.set(modelId, pipelinePromise);
  }

  const extractor = await pipelinePromise;

  return {
    id: modelId,
    backend: 'local',
    dim: 384,
    async embed(texts) {
      const out = [];
      for (const text of texts) {
        const result = await extractor(text, { pooling: 'mean', normalize: true });
        out.push(Array.from(result.data));
      }
      return out;
    },
  };
}

/**
 * Create a provider-backed OpenAI-compatible embeddings client.
 * @param {{ modelId?: string, providerId?: string, embeddingsPath?: string }} config
 */
export async function createProviderEmbedder(config = {}) {
  const providerId = String(config.providerId ?? '').trim();
  if (!providerId) {
    throw new Error('Provider embeddings backend requires providerId');
  }

  const runtime = await getProviderRuntime(providerId);
  const paths = getDefaultPaths(runtime.profile.apiKind, runtime.profile);
  const embeddingsPath =
    typeof runtime.profile.embeddingsPath === 'string' && runtime.profile.embeddingsPath.trim()
      ? runtime.profile.embeddingsPath.trim()
      : typeof config.embeddingsPath === 'string' && config.embeddingsPath.trim()
        ? config.embeddingsPath.trim()
        : paths.embeddingsPath ?? '/v1/embeddings';

  const modelId = String(config.modelId ?? 'text-embedding-3-small').trim() || 'text-embedding-3-small';
  const url = `${runtime.profile.baseUrl}${embeddingsPath}`;

  return {
    id: modelId,
    backend: 'provider',
    dim: 0,
    async embed(texts) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...runtime.headers,
        },
        body: JSON.stringify({
          model: modelId,
          input: texts,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Embeddings HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      rows.sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0));
      const vectors = rows.map((row) => {
        const embedding = Array.isArray(row?.embedding) ? row.embedding : [];
        return embedding;
      });
      if (vectors[0]?.length) {
        this.dim = vectors[0].length;
      }
      return vectors;
    },
  };
}

/**
 * Resolve embedder for the active memory embeddings config.
 * @param {object} memoryConfig
 */
export async function getEmbedder(memoryConfig) {
  const emb = {
    ...DEFAULT_EMBEDDINGS_CONFIG,
    ...(memoryConfig?.embeddings && typeof memoryConfig.embeddings === 'object'
      ? memoryConfig.embeddings
      : {}),
  };

  if (emb.backend === 'provider') {
    return createProviderEmbedder(emb);
  }
  return createLocalEmbedder(emb);
}

/** Reset cached local pipelines (tests). */
export function resetEmbeddingsCacheForTests() {
  localPipelineCache.clear();
}
