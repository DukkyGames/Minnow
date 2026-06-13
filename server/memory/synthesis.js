/**
 * LLM fact extraction for memory proposals (Odysseus port #08).
 */

import { llmCall } from '../research/llm.js';
import { loadAllEntriesWithBodies } from './store.js';
import { retrieveMemoryBlockHybrid } from './retrieve.js';
import { loadMemoryConfig } from './store.js';
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

/**
 * @param {string} title
 * @param {string} body
 * @param {Array<{ meta: object, body: string }>} existing
 * @param {object} memoryConfig
 * @returns {Promise<boolean>}
 */
export async function isDuplicateMemory(title, body, existing, memoryConfig) {
  const query = `${title} ${body}`.trim();
  if (!query) return true;

  const emb = memoryConfig.embeddings ?? {};
  if (emb.enabled) {
    const { ids } = await retrieveMemoryBlockHybrid(
      existing,
      { query, limit: 3, maxChars: 4000 },
      memoryConfig,
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
 * Run fact extraction and enqueue pending memory proposals.
 * @param {{
 *   messages: Array<{ role?: string, content?: string | unknown[] }>,
 *   sourceChatId?: string,
 *   sourceExcerpt?: string,
 * }} input
 * @returns {Promise<{ memoryProposals: object[], skipped: string[] }>}
 */
export async function runMemorySynthesis(input) {
  const cfg = await loadSynthesisConfig();
  if (!cfg.enabled) {
    return { memoryProposals: [], skipped: ['disabled'] };
  }

  const modelBinding = await resolveSynthesisModel(cfg);
  if (!modelBinding?.providerId || !modelBinding?.model) {
    return { memoryProposals: [], skipped: ['no-model'] };
  }

  const conversation = formatMessagesForExtraction(input.messages ?? []);
  if (!conversation.trim()) {
    return { memoryProposals: [], skipped: ['empty-context'] };
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
  const memoryConfig = await loadMemoryConfig();
  const existing = await loadAllEntriesWithBodies();
  const pendingTitles = new Set();

  /** @type {object[]} */
  const created = [];
  /** @type {string[]} */
  const skipped = [];

  const maxPerTurn = Math.max(1, cfg.maxProposalsPerTurn ?? 3);
  const threshold = cfg.confidenceThreshold ?? 0.6;

  for (const row of parsed) {
    if (created.length >= maxPerTurn) break;
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
    if (
      await isDuplicateMemory(fact.title, fact.body, existing, memoryConfig)
    ) {
      skipped.push('duplicate-existing');
      continue;
    }

    const proposal = await addMemoryProposal({
      ...fact,
      sourceChatId: input.sourceChatId,
      sourceExcerpt: input.sourceExcerpt,
    });
    pendingTitles.add(fact.title.toLowerCase());
    created.push(proposal);
  }

  return { memoryProposals: created, skipped };
}
