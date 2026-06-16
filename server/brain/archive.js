/**
 * Brain-backed chat archive — bundle stale turns into wiki pages (MIN-139).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { llmCall } from '../research/llm.js';
import { loadSynthesisConfig, resolveSynthesisModel } from './synthesis-config.js';
import { parseExtractionJson } from './synthesis.js';
import {
  appendLog,
  createPage,
  listPages,
  readPage,
  updatePage,
} from './store.js';
import { getBrainPagesDir } from './paths.js';
import { createVectorStore } from '../engine/vector-store.js';
import { getEnginePaths } from './engine-paths.js';
import { isValidPageId } from './paths.js';

const vectorStore = createVectorStore(getEnginePaths, { isValidEntryId: isValidPageId });
const { syncDeleteEntryVector } = vectorStore;

const ARCHIVE_BUNDLE_PROMPT = `You compress a span of chat turns into structured wiki knowledge for later retrieval.

Return a JSON object with:
- "title": short page title for this turn range
- "facts": array of { "statement", "sourceQuote", "sourceTurnIndex" } — each fact MUST quote an exact verbatim substring of one input turn
- "entities": array of { "slug", "title", "kind" } where kind is file|ticket|concept
- "body": optional extra markdown (wikilinks like [[entities/slug]] encouraged)

Omit facts you cannot anchor to a verbatim quote. Return ONLY valid JSON.`;

/** Extract plain text from a bundled API message shape. */
function messageText(turn) {
  const role = turn?.role;
  const content = turn?.content;
  if (role === 'tool') return String(content ?? '');
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && typeof p === 'object' && p.type === 'text')
      .map((p) => String(p.text ?? ''))
      .join('\n');
  }
  return '';
}

/**
 * Relative path prefix for a chat archive folder.
 * @param {string} workspaceKey
 * @param {string} chatId
 */
export function archiveFolderPrefix(workspaceKey, chatId) {
  const key = String(workspaceKey ?? '').trim() || 'workspace';
  const id = String(chatId ?? '').trim();
  return `workspaces/${key}/archive/${id}`;
}

/**
 * Stable slug for a bundled turn range.
 * @param {number[]} sourceTurnIndices
 */
export function archiveRangeSlug(sourceTurnIndices) {
  const sorted = [...sourceTurnIndices].sort((a, b) => a - b);
  const first = sorted[0] ?? 0;
  const last = sorted[sorted.length - 1] ?? first;
  const pad = (n) => String(n).padStart(4, '0');
  return `turns-${pad(first)}-${pad(last)}`;
}

/**
 * @param {object} front
 */
function parseFrontmatterIndices(front) {
  const raw = front?.sourceTurnIndices;
  if (Array.isArray(raw)) {
    return raw.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  }
  return [];
}

/**
 * @param {object[]} turns
 * @param {number} historyIndex
 */
function serializeTurnForBundle(turn, historyIndex) {
  const role = turn.role;
  const text = messageText(turn);
  return `--- turn ${historyIndex} (${role}) ---\n${text}`;
}

/**
 * Deterministic bundler when LLM is unavailable (tests + fallback).
 * @param {object[]} turns
 * @param {number[]} sourceTurnIndices
 */
export function buildExtractiveArchiveBundle(turns, sourceTurnIndices) {
  const facts = [];
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    const histIdx = sourceTurnIndices[i] ?? i;
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    const text = messageText(turn).trim();
    if (!text) continue;
    const quote = text.length > 240 ? text.slice(0, 240) : text;
    facts.push({
      statement: text.slice(0, 500),
      sourceQuote: quote,
      sourceTurnIndex: histIdx,
    });
  }
  const first = sourceTurnIndices[0] ?? 0;
  const last = sourceTurnIndices[sourceTurnIndices.length - 1] ?? first;
  return {
    title: `Archived turns ${first}-${last}`,
    facts,
    entities: [],
    body: '',
  };
}

/**
 * @param {object} bundle
 * @param {object[]} turns
 * @param {number[]} sourceTurnIndices
 */
export function validateArchiveBundleServer(bundle, turns, sourceTurnIndices) {
  const errors = [];
  const textByIndex = new Map();
  for (let i = 0; i < turns.length; i += 1) {
    const histIdx = sourceTurnIndices[i] ?? i;
    textByIndex.set(histIdx, messageText(turns[i]));
  }
  const validFacts = [];
  for (const fact of bundle.facts ?? []) {
    const quote = String(fact.sourceQuote ?? '').trim();
    const statement = String(fact.statement ?? '').trim();
    const turnIdx = Number(fact.sourceTurnIndex);
    if (!quote || !statement) {
      errors.push('missing statement or quote');
      continue;
    }
    const source = textByIndex.get(turnIdx) ?? '';
    if (!source.includes(quote)) {
      errors.push(`quote not in turn ${turnIdx}`);
      continue;
    }
    validFacts.push({ statement, sourceQuote: quote, sourceTurnIndex: turnIdx });
  }
  if (validFacts.length === 0) errors.push('zero anchored facts');
  return { ok: errors.length === 0, facts: validFacts, errors };
}

/**
 * @param {{ facts: object[], entities: object[], body?: string, title: string }} bundle
 */
function renderArchivePageBody(bundle) {
  const lines = ['## Facts'];
  for (const fact of bundle.facts) {
    lines.push(`### ${fact.statement}`);
    lines.push(`> ${fact.sourceQuote}`);
    lines.push(`<!-- sourceTurnIndex: ${fact.sourceTurnIndex} -->`);
    lines.push('');
  }
  if (bundle.entities?.length) {
    lines.push('## Entities');
    for (const ent of bundle.entities) {
      const slug = String(ent.slug ?? '').trim();
      if (!slug) continue;
      lines.push(`- [[entities/${slug}]] — ${String(ent.title ?? slug)}`);
    }
    lines.push('');
  }
  if (bundle.body?.trim()) {
    lines.push(bundle.body.trim());
  }
  return lines.join('\n').trim();
}

/**
 * @param {object} raw
 */
function parseArchiveBundleJson(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      const rows = parseExtractionJson(raw);
      parsed = rows[0] ?? {};
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (parsed);
  return {
    title: String(r.title ?? 'Archived turns'),
    facts: Array.isArray(r.facts) ? r.facts : [],
    entities: Array.isArray(r.entities) ? r.entities : [],
    body: String(r.body ?? ''),
  };
}

/**
 * @param {{ chatId: string, workspaceKey: string, turns: object[], sourceTurnIndices: number[], extractiveOnly?: boolean }} input
 */
export async function bundleArchiveRange(input) {
  const chatId = String(input.chatId ?? '').trim();
  const workspaceKey = String(input.workspaceKey ?? '').trim() || 'workspace';
  const turns = Array.isArray(input.turns) ? input.turns : [];
  const sourceTurnIndices = Array.isArray(input.sourceTurnIndices)
    ? input.sourceTurnIndices.map((n) => Number(n))
    : [];

  if (!chatId || turns.length === 0 || sourceTurnIndices.length === 0) {
    const err = new Error('chatId, turns, and sourceTurnIndices are required');
    err.statusCode = 400;
    throw err;
  }

  let bundle = null;
  if (input.extractiveOnly === true) {
    bundle = buildExtractiveArchiveBundle(turns, sourceTurnIndices);
  } else {
    const cfg = await loadSynthesisConfig();
    const modelBinding = await resolveSynthesisModel(cfg);
    if (modelBinding?.providerId && modelBinding?.model) {
      const transcript = turns
        .map((t, i) => serializeTurnForBundle(t, sourceTurnIndices[i] ?? i))
        .join('\n\n');
      try {
        const llmRaw = await llmCall({
          providerId: modelBinding.providerId,
          model: modelBinding.model,
          messages: [
            { role: 'system', content: ARCHIVE_BUNDLE_PROMPT },
            { role: 'user', content: transcript.slice(0, 48_000) },
          ],
          temperature: 0.2,
          maxTokens: 4096,
          timeoutMs: 60_000,
        });
        bundle = parseArchiveBundleJson(llmRaw);
      } catch {
        bundle = null;
      }
    }
    if (!bundle) {
      bundle = buildExtractiveArchiveBundle(turns, sourceTurnIndices);
    }
  }

  const validated = validateArchiveBundleServer(bundle, turns, sourceTurnIndices);
  if (!validated.ok) {
    const err = new Error(`Archive bundle validation failed: ${validated.errors.join('; ')}`);
    err.statusCode = 422;
    throw err;
  }

  const prefix = archiveFolderPrefix(workspaceKey, chatId);
  const slug = archiveRangeSlug(sourceTurnIndices);
  const relPath = `${prefix}/${slug}.md`;
  const body = renderArchivePageBody({ ...bundle, facts: validated.facts });

  let page;
  try {
    page = await createPage({
      relPath,
      title: bundle.title,
      body,
      tags: ['archive', `chat:${chatId}`],
      source: 'archive',
      summary: `Archived chat turns ${sourceTurnIndices[0]}-${sourceTurnIndices[sourceTurnIndices.length - 1]}`,
      chatId,
      sourceTurnIndices,
    });
  } catch (e) {
    if (e && typeof e === 'object' && 'statusCode' in e && e.statusCode === 409) {
      page = await updatePage(relPath, {
        title: bundle.title,
        body,
        tags: ['archive', `chat:${chatId}`],
        summary: `Archived chat turns ${sourceTurnIndices[0]}-${sourceTurnIndices[sourceTurnIndices.length - 1]}`,
      });
    } else {
      throw e;
    }
  }

  for (const ent of bundle.entities ?? []) {
    const entSlug = String(ent.slug ?? '').trim();
    if (!entSlug) continue;
    const entPath = `${prefix}/entities/${entSlug}.md`;
    const entBody = `# ${String(ent.title ?? entSlug)}\n\nKind: ${String(ent.kind ?? 'concept')}`;
    try {
      await createPage({
        relPath: entPath,
        title: String(ent.title ?? entSlug),
        body: entBody,
        tags: ['archive-entity', `chat:${chatId}`],
        source: 'archive',
        chatId,
      });
    } catch {
      /* entity page may already exist */
    }
  }

  await appendLog(`archive bundled ${relPath} for chat ${chatId}`);
  return {
    pageIds: [page.meta.id],
    ranges: [
      {
        startIndex: sourceTurnIndices[0],
        endIndex: (sourceTurnIndices[sourceTurnIndices.length - 1] ?? 0) + 1,
        sourceTurnIndices,
        pagePath: relPath,
      },
    ],
  };
}

/**
 * @param {string} chatId
 * @param {string} workspaceKey
 * @param {object[]} [pending]
 */
export async function getArchiveStatus(chatId, workspaceKey, pending = []) {
  const prefix = archiveFolderPrefix(workspaceKey, chatId);
  const pages = await listPages();
  const archivePages = pages.filter(
    (p) => p.path.startsWith(`${prefix}/`) && p.path.includes('turns-'),
  );

  const ranges = [];
  for (const page of archivePages) {
    try {
      const row = await readPage(page.path);
      const indices = parseFrontmatterIndices(row.meta);
      if (indices.length === 0) continue;
      const sorted = [...indices].sort((a, b) => a - b);
      ranges.push({
        startIndex: sorted[0],
        endIndex: sorted[sorted.length - 1] + 1,
        sourceTurnIndices: indices,
        pagePath: page.path,
      });
    } catch {
      /* skip corrupt page */
    }
  }

  const readyKeys = new Set(ranges.map((r) => `${r.startIndex}-${r.endIndex}`));
  const stillPending = (pending ?? []).filter(
    (r) => !readyKeys.has(`${r.startIndex}-${r.endIndex}`),
  );

  return { chatId, ranges, pending: stillPending };
}

/**
 * @param {string} chatId
 * @param {string} workspaceKey
 */
export async function deleteChatArchive(chatId, workspaceKey) {
  const prefix = archiveFolderPrefix(workspaceKey, chatId);
  const pagesDir = getBrainPagesDir();
  const absDir = path.join(pagesDir, ...prefix.split('/'));
  const pages = await listPages();
  const victims = pages.filter((p) => p.path.startsWith(`${prefix}/`));

  for (const page of victims) {
    try {
      await syncDeleteEntryVector(page.id);
    } catch {
      /* ignore vector cleanup errors */
    }
  }

  await fs.rm(absDir, { recursive: true, force: true });
  await appendLog(`deleted archive folder for chat ${chatId}`);
  return { ok: true, removed: victims.length };
}

/**
 * Remove archive folders whose chatId is not in liveChatIds (startup sweep).
 * @param {Set<string>} liveChatIds
 */
export async function reconcileOrphanArchives(liveChatIds) {
  if (!liveChatIds || liveChatIds.size === 0) return { swept: 0 };
  const pagesDir = getBrainPagesDir();
  const archiveRoot = path.join(pagesDir, 'workspaces');
  let swept = 0;

  let workspaceDirs = [];
  try {
    workspaceDirs = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch {
    return { swept: 0 };
  }

  for (const ws of workspaceDirs) {
    if (!ws.isDirectory()) continue;
    const archiveDir = path.join(archiveRoot, ws.name, 'archive');
    let chatDirs = [];
    try {
      chatDirs = await fs.readdir(archiveDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const chat of chatDirs) {
      if (!chat.isDirectory()) continue;
      if (liveChatIds.has(chat.name)) continue;
      await fs.rm(path.join(archiveDir, chat.name), { recursive: true, force: true });
      swept += 1;
    }
  }

  return { swept };
}
