/**
 * LLM fact extraction — writes wiki pages or enqueues proposals (brain store).
 */

import { llmCall } from '../research/llm.js';
import { loadAllPagesWithBodies } from './retrieve.js';
import { createPage, loadBrainConfig, updatePage } from './store.js';
import { loadSynthesisConfig, resolveSynthesisModel } from './synthesis-config.js';
import { addMemoryProposal } from './proposals.js';
import { DEFAULT_LINKING_CONFIG, normalizeLinkingConfig } from './linking-config.js';
import { brainWorkspaceKeyFromPath } from './paths.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';
import { recordBrainUsage } from './usage.js';
import { getEmbedder, embedTexts } from '../engine/embeddings.js';
import {
  cosineSimilarity,
  getEntryVector,
  isVectorStoreCompatible,
  loadVectorStore,
} from './vector-store.js';

/** Recent message pairs included in extraction context. */
export const CONTEXT_WINDOW = 6;

export const EXTRACT_SYSTEM_PROMPT = `You are a knowledge extraction assistant. Analyze the conversation and extract ONLY durable knowledge worth recalling in future sessions. There are two tracks — extract from either or both.

PERSONAL track (scope: "personal") — durable facts about the user.
Good: name, job title, city, family, long-term projects, strong tooling preferences.
Bad: what they asked about today, temporary moods, one-off tasks, opinions on the current topic.

PROJECT track (scope: "workspace") — durable knowledge about the codebase or system being worked on.
Good:
- A decision and WHY it was made, including alternatives that were rejected.
- A root cause that took real digging: symptom, underlying cause, and the fix.
- A convention this project follows that isn't obvious from a single file.
- An environment quirk (a flag that must go in a specific position, a tool that hangs without an option, a port that must be pinned).
- An approach that was TRIED AND FAILED, so it isn't retried.
- A key reference: where the authoritative config, schema, or entry point lives.
Bad: restating what the code plainly says, narration of routine edits, anything not verified during THIS session, speculation about what might work.

Rules:
- MAX 3 items total across both tracks — only the most valuable
- PERSONAL items must be stated or clearly implied by the USER
- PROJECT items must be verified in this session — a fix that actually worked, an error actually observed. If it was only proposed, skip it.
- Each item needs a specific, searchable title (name the thing: file, tool, error, feature) and a body of 1-3 concrete sentences
- If an item is likely already known, skip it
- If nothing durable came up, return []
- Never include passwords, API keys, tokens, or other secrets
- confidence reflects how sure you are the item is durable and correct — hedge below 0.85 if it was inferred rather than confirmed

Return a JSON array of objects with fields: title, body, tags (string array), category, scope, confidence (0-1), rationale.
Categories: identity, preference, fact, contact, project, goal, decision, gotcha, convention, environment, reference.
Scope: "personal" or "workspace".

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

/** Categories from the personal track — these land in the shared facts/ tree. */
export const PERSONAL_CATEGORIES = new Set([
  'identity',
  'preference',
  'fact',
  'contact',
  'project',
  'goal',
]);

/** Categories from the project track — these default to the active workspace's pages. */
export const PROJECT_CATEGORIES = new Set([
  'decision',
  'gotcha',
  'convention',
  'environment',
  'reference',
]);

/**
 * Body cap. Project knowledge needs room for symptom → cause → fix, which the
 * old single-sentence personal-fact shape could not hold.
 */
export const FACT_BODY_MAX_CHARS = 400;

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
  const validCategory = PERSONAL_CATEGORIES.has(category) || PROJECT_CATEGORIES.has(category)
    ? category
    : 'fact';

  // Project-knowledge categories describe the codebase, so they default to the
  // workspace wiki; the older personal categories stay in the shared facts/ tree.
  const rawScope = String(r.scope ?? '').toLowerCase();
  const scope =
    rawScope === 'personal' || rawScope === 'workspace'
      ? rawScope
      : PROJECT_CATEGORIES.has(validCategory)
        ? 'workspace'
        : 'personal';

  let confidence = 0.7;
  if (typeof r.confidence === 'number' && Number.isFinite(r.confidence)) {
    confidence = Math.min(1, Math.max(0, r.confidence));
  }

  const tags = Array.isArray(r.tags)
    ? r.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  return {
    title: title || body.slice(0, 80),
    body: (body || title).slice(0, FACT_BODY_MAX_CHARS),
    tags,
    category: validCategory,
    scope,
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
 * Cosine similarity above which a new fact counts as a duplicate of an existing page.
 * Must stay high enough that same-topic updates ("prefers dark mode" → "prefers light
 * mode") are written and left to retireSupersededPages, not silently dropped here.
 */
export const VECTOR_DUPLICATE_THRESHOLD = 0.92;

/**
 * @param {string} title
 * @param {string} body
 * @param {Array<{ meta: object, body: string }>} existing
 * @param {object} brainConfig
 * @param {{ getEmbedder?: typeof getEmbedder, embedTexts?: typeof embedTexts, loadVectorStore?: typeof loadVectorStore, getEntryVector?: typeof getEntryVector }} [deps]
 * @returns {Promise<boolean>}
 */
export async function isDuplicateMemory(title, body, existing, brainConfig, deps = {}) {
  const query = `${title} ${body}`.trim();
  if (!query) return true;

  const emb = brainConfig.embeddings ?? {};
  if (emb.enabled && existing.length > 0) {
    // Score each existing page directly against a similarity threshold. Top-k
    // retrieval is the wrong tool here: it always returns ids once any page
    // exists (no score cutoff, plus a recent/pinned fallback), which made every
    // new fact a "duplicate" after the first page was written.
    try {
      const embedder = await (deps.getEmbedder ?? getEmbedder)(brainConfig);
      const store = await (deps.loadVectorStore ?? loadVectorStore)();
      if (
        isVectorStoreCompatible(store, {
          modelId: embedder.id,
          backend: emb.backend,
          dim: embedder.dim,
        })
      ) {
        const [queryVector] = await (deps.embedTexts ?? embedTexts)(
          embedder,
          [query],
          emb.queryTimeoutMs,
        );
        if (queryVector) {
          for (const row of existing) {
            const stored =
              store.vectors[row.meta.id] ??
              (await (deps.getEntryVector ?? getEntryVector)(row.meta.id));
            if (
              stored &&
              cosineSimilarity(queryVector, stored) >= VECTOR_DUPLICATE_THRESHOLD
            ) {
              return true;
            }
          }
        }
      }
    } catch {
      /* embeddings unavailable — fall through to the keyword check */
    }
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
 * Score every existing page against a query by raw cosine similarity.
 *
 * Deliberately NOT built on `retrieveMemoryBlockHybrid`: that path normalizes
 * scores against the batch max (the best hit is always 1.0) and falls back to
 * recent/pinned ids when nothing matches, so an absolute floor is meaningless
 * there. Linking and retirement need absolute similarity, so they score directly
 * the way `isDuplicateMemory` does.
 *
 * @param {string} query
 * @param {Array<{ meta: object, body: string }>} existing
 * @param {object} brainConfig
 * @param {{ getEmbedder?: typeof getEmbedder, embedTexts?: typeof embedTexts, loadVectorStore?: typeof loadVectorStore, getEntryVector?: typeof getEntryVector }} [deps]
 * @returns {Promise<Map<string, number>>} cosine keyed by page id; empty when embeddings are off or unavailable
 */
export async function scorePagesByCosine(query, existing, brainConfig, deps = {}) {
  /** @type {Map<string, number>} */
  const scores = new Map();
  const text = String(query ?? '').trim();
  if (!text || !Array.isArray(existing) || existing.length === 0) return scores;

  const emb = brainConfig?.embeddings ?? {};
  if (!emb.enabled) return scores;

  try {
    const embedder = await (deps.getEmbedder ?? getEmbedder)(brainConfig);
    const store = await (deps.loadVectorStore ?? loadVectorStore)();
    if (
      !isVectorStoreCompatible(store, {
        modelId: embedder.id,
        backend: emb.backend,
        dim: embedder.dim,
      })
    ) {
      return scores;
    }
    const [queryVector] = await (deps.embedTexts ?? embedTexts)(
      embedder,
      [text],
      emb.queryTimeoutMs,
    );
    if (!queryVector) return scores;

    for (const row of existing) {
      const id = row?.meta?.id;
      if (!id) continue;
      const stored =
        store.vectors[id] ?? (await (deps.getEntryVector ?? getEntryVector)(id));
      if (!stored) continue;
      scores.set(id, cosineSimilarity(queryVector, stored));
    }
  } catch {
    /* embeddings unavailable — callers fall back to title overlap alone */
  }

  return scores;
}

/**
 * Linking thresholds for a brain config, defaulted for callers (and tests) that
 * pass a bare config without a `linking` block.
 * @param {object} brainConfig
 * @returns {typeof DEFAULT_LINKING_CONFIG}
 */
function linkingConfig(brainConfig) {
  return normalizeLinkingConfig(brainConfig?.linking);
}

/**
 * Flatten recent messages into the transcript handed to the extraction LLM.
 *
 * The window is a parameter because callers disagree about how much context they
 * need: memory extraction wants a wide view to spot a decision and its reasoning,
 * skill extraction wants the whole procedure. Previously this hard-coded
 * CONTEXT_WINDOW internally, which silently re-sliced the skill extractor's
 * 12-message window back down to 6 — it never actually saw more than 6.
 *
 * Defaults reproduce the original behavior for any caller passing no options.
 *
 * @param {Array<{ role?: string, content?: string | unknown[] }>} messages
 * @param {{ window?: number, perMessageChars?: number, roles?: string[] }} [opts]
 * @returns {string}
 */
export function formatMessagesForExtraction(messages, opts = {}) {
  const window = Math.max(1, opts.window ?? CONTEXT_WINDOW);
  const perMessageChars = Math.max(100, opts.perMessageChars ?? 500);
  const roles = Array.isArray(opts.roles) && opts.roles.length > 0 ? new Set(opts.roles) : null;

  const lines = [];
  for (const msg of messages.slice(-window)) {
    const role = String(msg.role ?? '?');
    if (roles && !roles.has(role)) continue;
    let content = msg.content;
    if (Array.isArray(content)) {
      content = content
        .filter((b) => b && typeof b === 'object' && /** @type {{ type?: string }} */ (b).type === 'text')
        .map((b) => String(/** @type {{ text?: string }} */ (b).text ?? ''))
        .join(' ');
    }
    let text = String(content ?? '').trim();
    if (text.length > perMessageChars) text = `${text.slice(0, perMessageChars)}...`;
    if (text) lines.push(`[${role}] ${text}`);
  }
  return lines.join('\n');
}

/**
 * Directory a fact belongs in: workspace-scoped project knowledge goes under the
 * active workspace, everything else into the shared facts/ tree. Falls back to
 * facts/ when there is no workspace open, so a scoped fact is never lost.
 *
 * @param {{ scope?: string }} fact
 * @returns {string} directory prefix, no trailing slash
 */
export function synthesisFactDir(fact) {
  if (fact?.scope !== 'workspace') return 'facts';
  try {
    const key = brainWorkspaceKeyFromPath(getEffectiveWorkspaceRoot());
    return key ? `workspaces/${key}` : 'facts';
  } catch {
    return 'facts';
  }
}

/**
 * Write a synthesized fact directly to the wiki.
 * @param {{ title: string, body: string, tags: string[], category?: string, scope?: string }} fact
 * @param {string[]} [similarTo] related page paths to record as frontmatter links
 * @param {{ dir?: string, source?: string }} [opts] override the target directory (defaults to scope routing) or page source
 */
export async function writeSynthesisFactPage(fact, similarTo = [], opts = {}) {
  const dir = opts.dir ?? synthesisFactDir(fact);
  // Category leads the tags so the wiki stays filterable without a schema change.
  const tags = fact.category
    ? [fact.category, ...(fact.tags ?? []).filter((t) => t !== fact.category)]
    : (fact.tags ?? []);

  const baseSlug = slugifyFactTitle(fact.title);
  let slug = baseSlug;
  let n = 2;
  while (n < 50) {
    const relPath = `${dir}/${slug}.md`;
    try {
      const created = await createPage({
        relPath,
        title: fact.title,
        body: fact.body,
        tags,
        source: opts.source ?? 'synthesis',
        ...(similarTo.length > 0 ? { similarTo } : {}),
      });
      void recordBrainUsage(
        opts.source === 'agent' ? 'proposal-accepted' : 'synthesis-write',
      );
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

/** Stop-words stripped when comparing fact titles for topic overlap. */
export const TITLE_STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'at', 'to',
  'for', 'and', 'or', 'but', 'with', 'by', 'from', 'user', 'has', 'have',
  'had', 'be', 'been', 'being', 'uses', 'use', 'used', 'my', 'me', 'our',
  'your', 'his', 'her', 'their', 'its', 'this', 'that', 'they', 'it', 'who',
  'what', 'when', 'where', 'will', 'would', 'could', 'should', 'may', 'not',
  'no', 'so', 'as', 'if', 'he', 'she', 'we', 'you',
]);

export function titleKeywords(title) {
  return new Set(
    String(title ?? '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !TITLE_STOP.has(w)),
  );
}

/** Count keywords shared by two title keyword sets. */
function sharedKeywordCount(kA, kB) {
  let shared = 0;
  for (const k of kA) if (kB.has(k)) shared++;
  return shared;
}

/**
 * True when two fact titles share enough keywords to be about the same topic.
 *
 * Requires ≥2 shared keywords (or every keyword, for one-word titles) AND ≥50%
 * overlap against the smaller set. The old "≥1 shared word, ≥40%" rule retired
 * unrelated pages off a single generic word like "config" or "server".
 *
 * @param {string} titleA
 * @param {string} titleB
 * @returns {boolean}
 */
export function titlesAreSameTopic(titleA, titleB) {
  const kA = titleKeywords(titleA);
  const kB = titleKeywords(titleB);
  if (kA.size === 0 || kB.size === 0) return false;
  const shared = sharedKeywordCount(kA, kB);
  const smaller = Math.min(kA.size, kB.size);
  const minShared = Math.min(2, smaller);
  return shared >= minShared && shared / smaller >= 0.5;
}

/**
 * After writing a new fact page, mark existing pages that cover the same topic as stale.
 *
 * Primary signal: title keyword overlap — catches semantic updates like "dark mode" → "light mode"
 * where the bodies differ but the topic (and most title keywords) are the same.
 * The old body-similarity approach was symmetric with isDuplicateMemory, so it never found
 * anything to retire (if old and new were different enough to write, they were different enough
 * to skip retirement too).
 *
 * Secondary signal: vector similarity when embeddings are enabled, floored at
 * `linking.retireMinCosine`. That floor sits above the link floor on purpose —
 * retirement is destructive, so it needs more evidence than drawing an edge.
 *
 * @param {{ title: string, body: string, category?: string }} newFact
 * @param {string} newRelPath
 * @param {Array<{ meta: object, body: string }>} existing
 * @param {object} brainConfig
 * @param {object} [deps] injected embedding deps, forwarded to scorePagesByCosine
 */
export async function retireSupersededPages(
  newFact,
  newRelPath,
  existing,
  brainConfig,
  deps = {},
) {
  if (!newFact.title || !newRelPath) return;

  const { retireMinCosine } = linkingConfig(brainConfig);
  /** @type {Map<string, string>} page id → why it was retired */
  const reasons = new Map();

  // Title keyword overlap — primary retirement signal.
  for (const row of existing) {
    if (!row.meta?.id) continue;
    if (titlesAreSameTopic(newFact.title, row.meta.title)) {
      reasons.set(row.meta.id, 'same-topic-title');
    }
  }

  // Vector similarity — secondary signal when embeddings are on.
  const cosines = await scorePagesByCosine(
    `${newFact.title} ${newFact.body}`.trim(),
    existing,
    brainConfig,
    deps,
  );
  for (const [id, score] of cosines) {
    if (score >= retireMinCosine && !reasons.has(id)) {
      reasons.set(id, `cosine=${score.toFixed(3)}`);
    }
  }

  for (const row of existing) {
    const reason = reasons.get(row.meta?.id);
    if (!reason) continue;
    const relPath = row.meta.path ?? '';
    if (!relPath || relPath === newRelPath) continue;
    if (row.meta.status === 'stale') continue;
    try {
      await updatePage(relPath, { status: 'stale', similarTo: [newRelPath] });
      // Logged for one tuning iteration — remove once the thresholds settle.
      console.info(
        `[brain] retired ${relPath} superseded by ${newRelPath} (${reason})`,
      );
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Find existing pages genuinely related to a new fact, to record as `similarTo`.
 *
 * A page qualifies only if it clears an absolute bar: at least
 * `linking.minSharedTitleKeywords` shared title keywords, OR cosine similarity
 * at least `linking.minCosine`. Qualifying pages are ranked by
 * `shared + 2*cosine` and capped at `linking.maxLinks`.
 *
 * Returns `[]` when nothing qualifies. An orphan page is the correct outcome —
 * the old top-3-with-no-floor behavior linked every new page to whatever
 * happened to exist, which is what made the graph unreadable.
 *
 * @param {{ title: string, body: string }} fact
 * @param {Array<{ meta: object, body: string }>} existing
 * @param {object} brainConfig
 * @param {object} [deps] injected embedding deps, forwarded to scorePagesByCosine
 * @returns {Promise<string[]>} related page relPaths (excluding the new page)
 */
export async function findRelatedPagePaths(fact, existing, brainConfig, deps = {}) {
  if (!fact.title && !fact.body) return [];

  const { minSharedTitleKeywords, minCosine, maxLinks } = linkingConfig(brainConfig);

  const cosines = await scorePagesByCosine(
    `${fact.title} ${fact.body}`.trim(),
    existing,
    brainConfig,
    deps,
  );

  const kNew = titleKeywords(fact.title);
  /** @type {Array<{ relPath: string, score: number }>} */
  const qualified = [];

  for (const row of existing) {
    const relPath = row.meta?.path;
    if (!relPath) continue;
    const shared = sharedKeywordCount(kNew, titleKeywords(row.meta.title));
    const cosine = cosines.get(row.meta.id) ?? 0;
    if (shared < minSharedTitleKeywords && cosine < minCosine) continue;
    qualified.push({ relPath, score: shared + 2 * cosine });
  }

  return qualified
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLinks)
    .map((row) => row.relPath);
}

/**
 * Decide what happens to an extracted fact.
 *
 * Pure so the policy is testable without touching the wiki. The split exists
 * because a single `requireConfirmation` flag forced a bad trade: confirm
 * everything and the queue rots unreviewed, confirm nothing and hedged guesses
 * get written as fact. Confidence decides instead.
 *
 * @param {{ confidence?: number }} fact
 * @param {{ confidenceThreshold?: number, requireConfirmation?: boolean, autoWriteConfidence?: number }} cfg
 * @returns {'skip-low' | 'propose' | 'write'}
 */
export function routeSynthesisFact(fact, cfg = {}) {
  const confidence = typeof fact?.confidence === 'number' ? fact.confidence : 0;
  const floor = cfg.confidenceThreshold ?? 0.6;
  if (confidence < floor) return 'skip-low';
  // Explicit opt-in to review everything still wins.
  if (cfg.requireConfirmation === true) return 'propose';
  const autoWrite = cfg.autoWriteConfidence ?? 0.85;
  return confidence >= autoWrite ? 'write' : 'propose';
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

  // Wider than the personal-fact default: spotting a decision and the reasoning
  // behind it needs more than the last three exchanges.
  const conversation = formatMessagesForExtraction(input.messages ?? [], {
    window: 20,
    perMessageChars: 700,
    roles: ['user', 'assistant'],
  });
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

  for (const row of parsed) {
    if (created.length + pages.length >= maxPerTurn) break;
    const fact = normalizeExtractedFact(row);
    if (!fact) {
      skipped.push('invalid-or-secret');
      continue;
    }

    const route = routeSynthesisFact(fact, cfg);
    if (route === 'skip-low') {
      skipped.push('low-confidence');
      continue;
    }

    // Dedupe and secret checks apply to both routes — a proposal that duplicates
    // an existing page is just as useless as a duplicate write.
    if (pendingTitles.has(fact.title.toLowerCase())) {
      skipped.push('duplicate-in-batch');
      continue;
    }
    if (await isDuplicateMemory(fact.title, fact.body, existing, brainConfig)) {
      skipped.push('duplicate-existing');
      continue;
    }

    if (route === 'propose') {
      const proposal = await addMemoryProposal({
        ...fact,
        sourceChatId: input.sourceChatId,
        sourceExcerpt: input.sourceExcerpt,
      });
      pendingTitles.add(fact.title.toLowerCase());
      created.push(proposal);
    } else {
      const similarTo = await findRelatedPagePaths(fact, existing, brainConfig);
      const written = await writeSynthesisFactPage(fact, similarTo);
      pendingTitles.add(fact.title.toLowerCase());
      pages.push(written.page);
      // Retire prior pages that covered the same topic before adding the new one to existing.
      void retireSupersededPages(fact, written.relPath, existing, brainConfig);
      existing.push({ meta: written.page.meta, body: written.page.body });
    }
  }

  return { memoryProposals: created, pages, skipped };
}
