/**
 * Keyword-based memory retrieval and injection block formatting (v1, no embeddings).
 */

import { wrapUntrusted } from '../security/untrusted.js';

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
