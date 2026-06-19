/**
 * LLM fact extraction — writes wiki pages or enqueues proposals (brain store).
 */

import { llmCall } from '../research/llm.js';
import { loadAllPagesWithBodies, retrieveMemoryBlockHybrid } from './retrieve.js';
import { createPage, loadBrainConfig, updatePage } from './store.js';
import { loadSynthesisConfig, resolveSynthesisModel } from './synthesis-config.js';
import { addMemoryProposal } from './proposals.js';

/** Recent message pairs included in extraction context. */
export const CONTEXT_WINDOW = 6;

export const EXTRACT_SYSTEM_PROMPT = `You are a memory extraction assistant. Analyze the conversation and extract ONLY durable personal facts about the user that would be useful across many future conversations.

Good examples: name, job title, city, family members, long-term projects, strong preferences.
Bad examples: what they asked about today, temporary moods, generic statements, things the assistant said, one-off tasks, opinions on the current topic.

Rules:
- MAX 2 facts per conversation — only the most important
- Only extract facts the USER stated or clearly implied
- Each fact must include a short title and a single-sentence body (under 15 words in the body)
- If a fact is similar to something likely already known, skip it
- If nothing durable was revealed, return []
- Never include passwords, API keys, tokens, or other secrets

Return a JSON array of objects with fields: title, body, tags (string array), category, confidence (0-1), rationale.
Categories: identity, preference, fact, contact, project, goal.

Return ONLY valid JSON, no markdown fences.`;

/** Patterns that indicate secrets — reject proposals containing these. */
const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9]{10,}\b/,
  /\bBearer\s+[a-zA-Z0-9._-]{8,}\b/i,
  /\bapi[_-]?key\b/i,
  /\bpassword\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bghp_[a-zA-Z0-9]{20,}\b/,
  /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/,
];

/**
 * @param {string} text
 * @returns {boolean}
 */
export function containsSecretPatterns(text) {
  const value = String(text ?? '');
  return SECRET_PATTERNS.some((re) => re.test(value));
}

/**
 * Parse LLM JSON array output; tolerates code fences and surrounding prose.
 * @param {string} raw
 * @returns {unknown[]}
 */
export function parseExtractionJson(raw) {
  if (!raw || typeof raw !== 'string') return [];

  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.split('\n', 1)[0] === '```json'
      ? s.slice(s.indexOf('\n') + 1)
      : s.slice(3);
    const close = s.lastIndexOf('```');
    if (close >= 0) s = s.slice(0, close).trim();
  }

  const tryParse = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(s);
  if (direct) return direct;

  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) {
    const slice = tryParse(s.slice(start, end + 1));
    if (slice) return slice;
  }

  return [];
}

/**
 * @param {unknown} row
 * @returns {object | null}
 */
export function normalizeExtractedFact(row) {
  if (!row || typeof row !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  const title = String(r.title ?? r.text ?? '').trim();
  const body = String(r.body ?? r.text ?? '').trim();
  if (!title && !body) return null;
  const combined = `${title}\n${body}`;
  if (containsSecretPatterns(combined)) return null;

  const category = String(r.category ?? 'fact').toLowerCase();
  const validCategory = [
    'identity',
    'preference',
    'fact',
    'contact',
    'project',
    'goal',
  ].includes(category)
    ? category
    : 'fact';

  let confidence = 0.7;
  if (typeof r.confidence === 'number' && Number.isFinite(r.confidence)) {
    confidence = Math.min(1, Math.max(0, r.confidence));
  }

  const tags = Array.isArray(r.tags)
    ? r.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  return {
    title: title || body.slice(0, 80),
    body: body || title,
    tags,
    category: validCategory,
    confidence,
    rationale: String(r.rationale ?? '').slice(0, 500),
  };
}

/** Slugify a title for pages/facts/<slug>.md filenames. */
export function slugifyFactTitle(title) {
  const slug = String(title ?? 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'untitled';
}

/**
 * @param {string} title
 * @param {string} body
 * @param {Array<{ meta: object, body: string }>} existing
 * @param {object} brainConfig
 * @returns {Promise<boolean>}
 */
export async function isDuplicateMemory(title, body, existing, brainConfig) {
  const query = `${title} ${body}`.trim();
  if (!query) return true;

  const emb = brainConfig.embeddings ?? {};
  if (emb.enabled) {
    const { ids } = await retrieveMemoryBlockHybrid(
      existing,
      { query, limit: 3, maxChars: 4000 },
      brainConfig,
    );
    if (ids.length > 0) return true;
  }

  const needle = query.toLowerCase();
  for (const row of existing) {
    const hay = `${row.meta.title ?? ''} ${row.body ?? ''}`.toLowerCase();
    if (hay.includes(needle) || needle.includes(hay.slice(0, 80))) {
      return true;
    }
  }
  return false;
}

/**
 * @param {Array<{ role?: string, content?: string | unknown[] }>} messages
 * @returns {string}
 */
export function formatMessagesForExtraction(messages) {
  const lines = [];
  for (const msg of messages.slice(-CONTEXT_WINDOW)) {
    const role = String(msg.role ?? '?');
    let content = msg.content;
    if (Array.isArray(content)) {
      content = content
        .filter((b) => b && typeof b === 'object' && /** @type {{ type?: string }} */ (b).type === 'text')
        .map((b) => String(/** @type {{ text?: string }} */ (b).text ?? ''))
        .join(' ');
    }
    let text = String(content ?? '').trim();
    if (text.length > 500) text = `${text.slice(0, 500)}...`;
    if (text) lines.push(`[${role}] ${text}`);
  }
  return lines.join('\n');
}

/**
 * Write a synthesized fact directly to pages/facts/.
 * @param {{ title: string, body: string, tags: string[] }} fact
 */
export async function writeSynthesisFactPage(fact) {
  const baseSlug = slugifyFactTitle(fact.title);
  let slug = baseSlug;
  let n = 2;
  while (n < 50) {
    const relPath = `facts/${slug}.md`;
    try {
      const created = await createPage({
        relPath,
        title: fact.title,
        body: fact.body,
        tags: fact.tags,
        source: 'synthesis',
      });
      return { page: created, relPath };
    } catch (err) {
      const status = err && typeof err === 'object' && 'statusCode' in err ? err.statusCode : null;
      if (status !== 409) throw err;
      slug = `${baseSlug}-${n}`;
      n += 1;
    }
  }
  throw new Error('Could not allocate a unique fact page path');
}

/**
 * After writing a new fact page, mark existing pages that cover the same topic as stale.
 * Uses the same similarity signal as isDuplicateMemory but skips the new page itself.
 * @param {{ title: string, body: string }} newFact
 * @param {string} newRelPath
 * @param {Array<{ meta: object, body: string }>} existing
 * @param {object} brainConfig
 */
export async function retireSupersededPages(newFact, newRelPath, existing, brainConfig) {
  const query = `${newFact.title} ${newFact.body}`.trim();
  if (!query) return;

  const emb = brainConfig.embeddings ?? {};
  const candidates = new Set();

  if (emb.enabled) {
    try {
      const { ids } = await retrieveMemoryBlockHybrid(
        existing,
        { query, limit: 5, maxChars: 8000 },
        brainConfig,
      );
      for (const id of ids) candidates.add(id);
    } catch {
      /* best-effort */
    }
  }

  const needle = query.toLowerCase();
  for (const row of existing) {
    const hay = `${row.meta.title ?? ''} ${row.body ?? ''}`.toLowerCase();
    if (hay.includes(needle) || needle.includes(hay.slice(0, 80))) {
      if (row.meta.id) candidates.add(row.meta.id);
    }
  }

  for (const row of existing) {
    if (!candidates.has(row.meta.id)) continue;
    const relPath = row.meta.path ?? '';
    if (!relPath || relPath === newRelPath) continue;
    if (row.meta.status === 'stale') continue;
    try {
      await updatePage(relPath, { status: 'stale', similarTo: [newRelPath] });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Run fact extraction and write pages or enqueue pending proposals.
 * @param {{
 *   messages: Array<{ role?: string, content?: string | unknown[] }>,
 *   sourceChatId?: string,
 *   sourceExcerpt?: string,
 *   providerId?: string,
 *   modelId?: string,
 * }} input
 * @returns {Promise<{ memoryProposals: object[], pages: object[], skipped: string[] }>}
 */
export async function runMemorySynthesis(input) {
  const cfg = await loadSynthesisConfig();
  if (!cfg.enabled) {
    return { memoryProposals: [], pages: [], skipped: ['disabled'] };
  }

  const modelBinding = await resolveSynthesisModel(cfg, {
    providerId: input.providerId,
    modelId: input.modelId,
  });
  if (!modelBinding?.providerId || !modelBinding?.model) {
    return { memoryProposals: [], pages: [], skipped: ['no-model'] };
  }

  const conversation = formatMessagesForExtraction(input.messages ?? []);
  if (!conversation.trim()) {
    return { memoryProposals: [], pages: [], skipped: ['empty-context'] };
  }

  const raw = await llmCall({
    providerId: modelBinding.providerId,
    model: modelBinding.model,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: `Conversation:\n${conversation}` },
    ],
    temperature: 0.2,
    maxTokens: 1024,
    timeoutMs: 45_000,
  });

  const parsed = parseExtractionJson(raw);
  const brainConfig = await loadBrainConfig();
  const existing = await loadAllPagesWithBodies();
  const pendingTitles = new Set();

  /** @type {object[]} */
  const created = [];
  /** @type {object[]} */
  const pages = [];
  /** @type {string[]} */
  const skipped = [];

  const maxPerTurn = Math.max(1, cfg.maxProposalsPerTurn ?? 3);
  const threshold = cfg.confidenceThreshold ?? 0.6;
  const requireConfirmation = cfg.requireConfirmation === true;

  for (const row of parsed) {
    if (created.length + pages.length >= maxPerTurn) break;
    const fact = normalizeExtractedFact(row);
    if (!fact) {
      skipped.push('invalid-or-secret');
      continue;
    }
    if (fact.confidence < threshold) {
      skipped.push('low-confidence');
      continue;
    }
    if (pendingTitles.has(fact.title.toLowerCase())) {
      skipped.push('duplicate-in-batch');
      continue;
    }
    if (await isDuplicateMemory(fact.title, fact.body, existing, brainConfig)) {
      skipped.push('duplicate-existing');
      continue;
    }

    if (requireConfirmation) {
      const proposal = await addMemoryProposal({
        ...fact,
        sourceChatId: input.sourceChatId,
        sourceExcerpt: input.sourceExcerpt,
      });
      pendingTitles.add(fact.title.toLowerCase());
      created.push(proposal);
    } else {
      const written = await writeSynthesisFactPage(fact);
      pendingTitles.add(fact.title.toLowerCase());
      pages.push(written.page);
      // Retire prior pages that covered the same topic before adding the new one to existing.
      void retireSupersededPages(fact, written.relPath, existing, brainConfig);
      existing.push({ meta: written.page.meta, body: written.page.body });
    }
  }

  return { memoryProposals: created, pages, skipped };
}
