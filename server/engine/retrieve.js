/**
 * Keyword and hybrid (keyword + vector) memory retrieval and injection formatting.
 */

import { wrapUntrusted } from '../security/untrusted.js';
import { getEmbedder, embedTexts, DEFAULT_EMBEDDINGS_CONFIG } from './embeddings.js';
import { cosineSimilarity } from './vector-store.js';

/** @type {ReturnType<import('./vector-store.js').createVectorStore> | null} */
let boundVectorStore = null;

/**
 * Bind vector store API for hybrid retrieval (called by memory adapter).
 * @param {ReturnType<import('./vector-store.js').createVectorStore>} vectorStore
 */
export function bindRetrieveVectorStore(vectorStore) {
  boundVectorStore = vectorStore;
}

function requireVectorStore() {
  if (!boundVectorStore) {
    throw new Error('Retrieve vector store not bound');
  }
  return boundVectorStore;
}

/**
 * Tokenize query into lowercase words (length >= 3).
 * @param {string} query
 */
function tokenize(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/**
 * Score one entry against query tokens and optional tag filter.
 */
function scoreEntry(meta, body, tokens, tags) {
  let score = 0;
  const title = String(meta.title ?? '').toLowerCase();
  const bodyLower = String(body ?? '').toLowerCase();
  const entryTags = (meta.tags ?? []).map((t) => String(t).toLowerCase());

  if (tags?.length) {
    const want = tags.map((t) => String(t).toLowerCase());
    if (!want.some((t) => entryTags.includes(t))) return -1;
    score += 3;
  }

  for (const word of tokens) {
    if (entryTags.includes(word)) score += 3;
    if (title.includes(word)) score += 2;
    if (bodyLower.includes(word)) score += 1;
  }

  if (meta.pinned) score += 1;
  return score;
}

/**
 * Format entries into a plain-text block for {{memory}} interpolation.
 * @param {Array<{ meta: object, body: string }>} items
 * @param {number} maxChars
 */
export function formatMemoryBlock(items, maxChars) {
  if (!items.length) return '';

  const lines = ['## Retrieved memory'];
  for (const { meta, body } of items) {
    const tags = (meta.tags ?? []).join(', ') || 'none';
    const firstLine = String(body ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
    const preview =
      firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
    lines.push(`- [${meta.title}] (tags: ${tags})`);
    lines.push(`  ${preview}`);
  }

  let block = lines.join('\n');
  if (block.length > maxChars) {
    block = `${block.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return block;
}

/**
 * Retrieve ranked entries and format injection block.
 * @param {Array<{ meta: object, body: string }>} allEntries
 * @param {{ query?: string, limit?: number, tags?: string[], maxChars?: number }} opts
 */
export function retrieveMemoryBlock(allEntries, opts = {}) {
  const limit = opts.limit ?? 8;
  const maxChars = opts.maxChars ?? 4000;
  const tokens = tokenize(opts.query);

  let ranked = allEntries.map(({ meta, body }) => ({
    meta,
    body,
    score:
      tokens.length > 0
        ? scoreEntry(meta, body, tokens, opts.tags)
        : meta.pinned
          ? 2
          : 1,
  }));

  ranked = ranked.filter((r) => (tokens.length > 0 ? r.score > 0 : r.score >= 0));

  // Keyword queries with no matches still inject recent/pinned notes (v1 has no embeddings).
  if (ranked.length === 0 && allEntries.length > 0) {
    ranked = allEntries.map(({ meta, body }) => ({
      meta,
      body,
      score: meta.pinned ? 2 : 1,
    }));
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.meta.updatedAt).localeCompare(String(a.meta.updatedAt));
  });

  const top = ranked.slice(0, limit).map(({ meta, body }) => ({ meta, body }));
  const block = formatMemoryBlock(top, maxChars);
  return {
    block: block ? wrapUntrusted(block, { source: 'memory' }) : '',
    ids: top.map((t) => t.meta.id),
  };
}

/**
 * Normalize raw scores to 0–1 using the batch maximum (minimum divisor 1).
 * @param {number[]} scores
 */
function normalizeScores(scores) {
  const max = Math.max(...scores, 1);
  return scores.map((s) => (s > 0 ? s / max : 0));
}

/**
 * Rank entries with hybrid keyword + cosine retrieval (async).
 * Falls back to keyword-only when embeddings are disabled or unhealthy.
 * @param {Array<{ meta: object, body: string }>} allEntries
 * @param {{ query?: string, limit?: number, tags?: string[], maxChars?: number }} opts
 * @param {object} [memoryConfig]
 * @param {{ getEmbedder?: typeof getEmbedder, embedTexts?: typeof embedTexts }} [deps]
 */
export async function retrieveMemoryBlockHybrid(allEntries, opts = {}, memoryConfig = {}, deps = {}) {
  const getEmbedderFn = deps.getEmbedder ?? getEmbedder;
  const embedTextsFn = deps.embedTexts ?? embedTexts;
  const { getEntryVector, isVectorStoreCompatible, loadVectorStore } = requireVectorStore();
  const emb = {
    ...DEFAULT_EMBEDDINGS_CONFIG,
    ...(memoryConfig?.embeddings && typeof memoryConfig.embeddings === 'object'
      ? memoryConfig.embeddings
      : {}),
  };

  if (!emb.enabled) {
    return retrieveMemoryBlock(allEntries, opts);
  }

  const limit = opts.limit ?? 8;
  const maxChars = opts.maxChars ?? 4000;
  const blendWeight = Math.min(1, Math.max(0, Number(emb.blendWeight ?? 0.5)));
  const tokens = tokenize(opts.query);
  const queryText = String(opts.query ?? '').trim();

  let queryVector = null;
  let embedder = null;
  try {
    embedder = await getEmbedderFn(memoryConfig);
    const vectors = await embedTextsFn(embedder, [queryText || ' '], emb.queryTimeoutMs);
    queryVector = vectors[0];
  } catch {
    return retrieveMemoryBlock(allEntries, opts);
  }

  const store = await loadVectorStore();
  if (
    !isVectorStoreCompatible(store, {
      modelId: embedder.id,
      backend: emb.backend,
      dim: embedder.dim,
    })
  ) {
    return retrieveMemoryBlock(allEntries, opts);
  }

  const keywordScores = allEntries.map(({ meta, body }) =>
    tokens.length > 0 ? scoreEntry(meta, body, tokens, opts.tags) : meta.pinned ? 2 : 1,
  );

  const vectorScores = await Promise.all(
    allEntries.map(async ({ meta }) => {
      const stored = store.vectors[meta.id] ?? (await getEntryVector(meta.id));
      if (!stored || !queryVector) return 0;
      return cosineSimilarity(queryVector, stored);
    }),
  );

  const keywordNorm = normalizeScores(keywordScores.map((s) => (s < 0 ? 0 : s)));
  const vectorNorm = normalizeScores(vectorScores);

  let ranked = allEntries.map((entry, index) => {
    const kw = keywordNorm[index] ?? 0;
    const vec = vectorNorm[index] ?? 0;
    const tagRejected = keywordScores[index] < 0;
    const score = tagRejected ? -1 : (1 - blendWeight) * kw + blendWeight * vec;
    return { ...entry, score };
  });

  ranked = ranked.filter((r) => (tokens.length > 0 ? r.score > 0 : r.score >= 0));

  if (ranked.length === 0 && allEntries.length > 0) {
    ranked = allEntries.map(({ meta, body }) => ({
      meta,
      body,
      score: meta.pinned ? 2 : 1,
    }));
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.meta.updatedAt).localeCompare(String(a.meta.updatedAt));
  });

  const top = ranked.slice(0, limit).map(({ meta, body }) => ({ meta, body }));
  const block = formatMemoryBlock(top, maxChars);
  return {
    block: block ? wrapUntrusted(block, { source: 'memory' }) : '',
    ids: top.map((t) => t.meta.id),
  };
}
