/**
 * Archive-scoped retrieve reranking — recency boost + optional LLM reorder (MIN-139).
 */

import { llmCall } from '../research/llm.js';
import { resolveSynthesisModel, loadSynthesisConfig } from './synthesis-config.js';

/**
 * Blend hybrid score with recency from sourceTurnIndices max and updatedAt.
 * @param {Array<{ path: string, title: string, excerpt: string, sourceQuote?: string, frontmatter?: object, score?: number }>} hits
 * @param {{ recencyWeight?: number }} [opts]
 */
export function rerankArchiveHits(hits, opts = {}) {
  const recencyWeight = typeof opts.recencyWeight === 'number' ? opts.recencyWeight : 0.15;
  const hybridWeight = 1 - recencyWeight;
  const maxTurn = hits.reduce((max, hit) => {
    const raw = hit.frontmatter?.sourceTurnIndices;
    const indices = Array.isArray(raw) ? raw.map((n) => Number(n)).filter(Number.isFinite) : [];
    const localMax = indices.length ? Math.max(...indices) : 0;
    return Math.max(max, localMax);
  }, 1);

  return [...hits]
    .map((hit, index) => {
      const raw = hit.frontmatter?.sourceTurnIndices;
      const indices = Array.isArray(raw) ? raw.map((n) => Number(n)).filter(Number.isFinite) : [];
      const turnMax = indices.length ? Math.max(...indices) : 0;
      const recencyScore = maxTurn > 0 ? turnMax / maxTurn : 0;
      const updatedAt = String(hit.frontmatter?.updatedAt ?? '');
      const timeScore = updatedAt ? new Date(updatedAt).getTime() / 1e15 : 0;
      const blendedRecency = recencyScore * 0.85 + timeScore * 0.15;
      const hybridScore = typeof hit.score === 'number' ? hit.score : 1 / (index + 1);
      const finalScore = hybridScore * hybridWeight + blendedRecency * recencyWeight;
      return { ...hit, score: finalScore };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Optional LLM rerank over top hits (titles + excerpts).
 * @param {Array<{ title: string, excerpt: string, path: string }>} hits
 * @param {string} query
 * @param {number} limit
 */
export async function llmRerankArchiveHits(hits, query, limit) {
  if (hits.length <= 1) return hits;
  const cfg = await loadSynthesisConfig();
  const modelBinding = await resolveSynthesisModel(cfg);
  if (!modelBinding?.providerId || !modelBinding?.model) return hits;

  const catalog = hits
    .slice(0, Math.min(hits.length, 12))
    .map((h, i) => `${i}: ${h.title} — ${String(h.excerpt ?? '').slice(0, 200)}`)
    .join('\n');

  try {
    const raw = await llmCall({
      providerId: modelBinding.providerId,
      model: modelBinding.model,
      messages: [
        {
          role: 'system',
          content:
            'Reorder archive hits by relevance to the query. Return ONLY a JSON array of integer indices (0-based) in best-first order.',
        },
        {
          role: 'user',
          content: `Query: ${query}\n\nHits:\n${catalog}`,
        },
      ],
      temperature: 0,
      maxTokens: 256,
      timeoutMs: 20_000,
    });
    const parsed = JSON.parse(String(raw).trim());
    if (!Array.isArray(parsed)) return hits;
    const order = parsed.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
    const reordered = [];
    const used = new Set();
    for (const idx of order) {
      if (idx >= hits.length || used.has(idx)) continue;
      used.add(idx);
      reordered.push(hits[idx]);
    }
    for (let i = 0; i < hits.length; i += 1) {
      if (!used.has(i)) reordered.push(hits[i]);
    }
    return reordered.slice(0, limit);
  } catch {
    return hits.slice(0, limit);
  }
}
