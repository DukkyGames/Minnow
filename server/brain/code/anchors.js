/**
 * Symbol anchors — reverse index linking wiki pages to code symbols (MIN-B9).
 */

import fs from 'node:fs/promises';
import { getEffectiveWorkspaceRoot } from '../../runtime/path-access.js';
import { brainWorkspaceKeyFromPath, getBrainStatePath } from '../paths.js';
import { getCodeDb } from './schema.js';

/**
 * Split a stable symbol id into repo key and qualified name.
 * @param {string} symbolId
 */
export function parseAnchorSymbolId(symbolId) {
  const raw = String(symbolId ?? '').trim();
  const colon = raw.indexOf(':');
  if (colon <= 0) return { repo: '', qualified: raw };
  return {
    repo: raw.slice(0, colon),
    qualified: raw.slice(colon + 1),
  };
}

/** Open the code index DB for the active workspace. */
function activeDb() {
  const root = getEffectiveWorkspaceRoot();
  const key = brainWorkspaceKeyFromPath(root) || 'workspace';
  return getCodeDb(key);
}

/**
 * Look up a symbol's current content_hash in the index.
 * @param {import('better-sqlite3').Database} db
 * @param {string} symbolId
 */
export function getSymbolContentHash(db, symbolId) {
  const row = db.prepare('SELECT content_hash FROM symbols WHERE id = ?').get(symbolId);
  return row?.content_hash ?? null;
}

/**
 * Replace anchor rows for one wiki page (keyed by stable page_id).
 * @param {string} pageId
 * @param {string[]} anchorIds
 */
export function syncAnchorsForPage(pageId, anchorIds) {
  const id = String(pageId ?? '').trim();
  if (!id) return;
  const db = activeDb();
  const anchors = Array.isArray(anchorIds) ? anchorIds.map((a) => String(a).trim()).filter(Boolean) : [];

  const del = db.prepare('DELETE FROM anchors WHERE page_id = ?');
  const ins = db.prepare(
    `INSERT INTO anchors (page_id, symbol_id, repo, symbol_hash_at_synth)
     VALUES (?, ?, ?, ?)`,
  );

  const tx = db.transaction((rows) => {
    del.run(id);
    for (const symbolId of rows) {
      const { repo } = parseAnchorSymbolId(symbolId);
      const hash = getSymbolContentHash(db, symbolId) ?? '';
      ins.run(id, symbolId, repo || brainWorkspaceKeyFromPath(getEffectiveWorkspaceRoot()), hash);
    }
  });
  tx(anchors);
}

/** Remove all anchor rows when a wiki page is deleted. */
export function deleteAnchorsForPage(pageId) {
  const id = String(pageId ?? '').trim();
  if (!id) return;
  activeDb().prepare('DELETE FROM anchors WHERE page_id = ?').run(id);
}

/**
 * Reverse lookup: wiki pages that anchor a symbol.
 * @param {string} symbolRef — full id or bare name
 */
export async function explainSymbol(symbolRef) {
  const ref = String(symbolRef ?? '').trim();
  if (!ref) return { pages: [], error: 'symbol is required' };

  const db = activeDb();
  const workspaceRepo = brainWorkspaceKeyFromPath(getEffectiveWorkspaceRoot()) || 'workspace';
  const symbolId = ref.includes(':')
    ? ref
    : (db.prepare('SELECT id FROM symbols WHERE repo = ? AND name = ? LIMIT 1').get(workspaceRepo, ref)
        ?.id ?? `${workspaceRepo}:${ref}`);

  const rows = db
    .prepare(
      `SELECT page_id, symbol_id, symbol_hash_at_synth
       FROM anchors
       WHERE symbol_id = ?
       ORDER BY page_id`,
    )
    .all(symbolId);

  if (!rows.length) {
    return { symbolId, pages: [] };
  }

  const { loadCatalog } = await import('../store.js');
  const catalog = await loadCatalog();
  const byId = new Map(catalog.pages.map((p) => [p.id, p]));

  const pages = rows
    .map((row) => {
      const page = byId.get(row.page_id);
      if (!page) return null;
      return {
        pageId: row.page_id,
        path: page.path,
        title: page.title,
        summary: page.summary,
        status: page.status,
        symbolId: row.symbol_id,
        symbolHashAtSynth: row.symbol_hash_at_synth,
      };
    })
    .filter(Boolean);

  return { symbolId, pages };
}

/**
 * Resolve a page's anchor list to live source spans (cross-repo safe).
 * @param {string[]} anchorIds
 */
export async function resolveAnchorsToCode(anchorIds) {
  const { readSymbol } = await import('./query.js');
  const anchors = Array.isArray(anchorIds) ? anchorIds : [];
  const resolved = [];
  for (const symbolId of anchors) {
    const { symbol, text, error } = await readSymbol(String(symbolId));
    resolved.push({
      symbolId: String(symbolId),
      symbol,
      text,
      error: error ?? (symbol ? undefined : 'symbol not found'),
    });
  }
  return resolved;
}

/** @returns {Promise<Record<string, unknown>>} */
async function readBrainState() {
  try {
    const raw = await fs.readFile(getBrainStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, unknown>} patch */
async function writeBrainState(patch) {
  const current = await readBrainState();
  const next = { ...current, ...patch };
  await fs.writeFile(getBrainStatePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/** Queue a page id for batch re-synthesis (MIN-B10 consumes this list). */
export async function queuePageResynthesis(pageId) {
  const id = String(pageId ?? '').trim();
  if (!id) return;
  const state = await readBrainState();
  const queue = new Set(
    Array.isArray(state.resynthesisQueue) ? state.resynthesisQueue.map(String) : [],
  );
  queue.add(id);
  await writeBrainState({ resynthesisQueue: [...queue] });
}

/**
 * Compare anchor hashes to current symbol content_hash (read-only).
 * @returns {Promise<Array<{ pageId: string, path: string, title: string, symbolIds: string[] }>>}
 */
export async function detectAnchorDrift() {
  const db = activeDb();
  const rows = db
    .prepare(
      `SELECT a.page_id, a.symbol_id, a.symbol_hash_at_synth, s.content_hash AS current_hash
       FROM anchors a
       LEFT JOIN symbols s ON s.id = a.symbol_id`,
    )
    .all();

  const driftedByPage = new Map();
  for (const row of rows) {
    if (!row.current_hash || !row.symbol_hash_at_synth) continue;
    if (row.current_hash === row.symbol_hash_at_synth) continue;
    if (!driftedByPage.has(row.page_id)) {
      driftedByPage.set(row.page_id, []);
    }
    driftedByPage.get(row.page_id).push(row.symbol_id);
  }

  if (driftedByPage.size === 0) return [];

  const { loadCatalog } = await import('../store.js');
  const catalog = await loadCatalog();
  const byId = new Map(catalog.pages.map((p) => [p.id, p]));
  /** @type {Array<{ pageId: string, path: string, title: string, symbolIds: string[] }>} */
  const drifted = [];

  for (const [pageId, symbols] of driftedByPage) {
    const page = byId.get(pageId);
    if (!page) continue;
    drifted.push({
      pageId,
      path: page.path,
      title: page.title,
      symbolIds: symbols,
    });
  }

  return drifted;
}

/**
 * Compare anchor hashes to current symbol content_hash; mark drifted pages stale.
 * @returns {Promise<Array<{ pageId: string, path: string, title: string, symbolIds: string[] }>>}
 */
export async function detectAndApplyAnchorDrift() {
  const drifted = await detectAnchorDrift();
  if (drifted.length === 0) return [];

  const { loadCatalog, updatePage } = await import('../store.js');
  const catalog = await loadCatalog();
  const byId = new Map(catalog.pages.map((p) => [p.id, p]));
  const applied = [];

  for (const entry of drifted) {
    const page = byId.get(entry.pageId);
    if (!page) continue;
    if (page.status !== 'stale') {
      await updatePage(page.path, { status: 'stale', skipAnchorSync: true });
    }
    await queuePageResynthesis(entry.pageId);
    applied.push(entry);
  }

  return applied;
}

/** Apply anchor drift fixes (mark stale + queue resynthesis). Used by cleanup execute. */
export async function applyAnchorDrift() {
  return detectAndApplyAnchorDrift();
}
