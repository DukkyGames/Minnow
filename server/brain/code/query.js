/**
 * Read-only queries over the Brain code index (SQLite + LSP fallback).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getLspWorkspaceSymbols } from '../../lsp/manager.js';
import { getEffectiveWorkspaceRoot } from '../../runtime/path-access.js';
import { brainWorkspaceKeyFromPath } from '../paths.js';
import { loadBrainConfig } from '../store.js';
import { clampRepoMapTokenBudget, normalizeBrainCodeConfig } from './config.js';
import { getCodeDb, getIndexStats } from './schema.js';
import { recomputePageRank } from './indexer.js';
import { renderRepoMap } from './repo-map.js';
import { ensureIndexFreshForQuery } from './cascade.js';
import { ensureBrainLspProjectReady } from './project-scaffold.js';

/** Load merged config.brain.code settings. */
export async function loadBrainCodeConfig() {
  const brain = await loadBrainConfig();
  const raw = brain.code && typeof brain.code === 'object' ? brain.code : {};
  return normalizeBrainCodeConfig(raw);
}

/** Active workspace repo key for symbol ids. */
export function activeRepoKey() {
  return brainWorkspaceKeyFromPath(getEffectiveWorkspaceRoot()) || 'workspace';
}

/**
 * Index status for the active workspace.
 */
export async function queryCodeStatus() {
  const code = await loadBrainCodeConfig();
  const repo = activeRepoKey();
  const db = getCodeDb(repo);
  const stats = getIndexStats(db);
  return {
    enabled: code.enabled,
    repo,
    ...stats,
    repoMapTokenBudget: code.repoMapTokenBudget,
    reindexCadence: code.reindexCadence,
  };
}

/**
 * FTS5 + workspace-symbol fallback symbol search.
 * @param {string} query
 * @param {number} [limit]
 */
export async function findSymbol(query, limit = 20) {
  await ensureIndexFreshForQuery();
  const q = String(query ?? '').trim();
  if (!q) return { matches: [], error: 'query is required' };
  const repo = activeRepoKey();
  const db = getCodeDb(repo);
  const max = Math.min(50, Math.max(1, Math.floor(limit)));

  const ftsMatches = db
    .prepare(
      `SELECT s.id, s.repo, s.kind, s.name, s.file, s.line_start, s.line_end, s.signature
       FROM symbols_fts f
       JOIN symbols s ON s.id = f.symbol_id
       WHERE symbols_fts MATCH ?
       ORDER BY bm25(symbols_fts)
       LIMIT ?`,
    )
    .all(q, max);

  const matches = ftsMatches.map((row) => ({ ...row, source: 'index' }));

  if (matches.length < max) {
    const code = await loadBrainCodeConfig();
    await ensureBrainLspProjectReady(getEffectiveWorkspaceRoot(), {
      enabled: code.autoScaffoldIndexConfig !== false,
    });
    const { symbols, error } = await getLspWorkspaceSymbols(q);
    const seen = new Set(matches.map((m) => m.id));
    for (const sym of symbols ?? []) {
      const id = `${repo}:${sym.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      matches.push({
        id,
        repo,
        kind: String(sym.kind ?? 'symbol'),
        name: sym.name,
        file: sym.path,
        line_start: (sym.range?.start?.line ?? 0) + 1,
        line_end: (sym.range?.end?.line ?? sym.range?.start?.line ?? 0) + 1,
        signature: sym.containerName ? `${sym.name} in ${sym.containerName}` : sym.name,
        source: 'lsp',
      });
      if (matches.length >= max) break;
    }
    if (matches.length === 0 && error) {
      return { matches: [], error };
    }
  }

  return { matches };
}

/**
 * Incoming call edges for a symbol id or bare name.
 * @param {string} symbolRef
 */
export async function whoCalls(symbolRef) {
  await ensureIndexFreshForQuery();
  const repo = activeRepoKey();
  const db = getCodeDb(repo);
  const id = resolveSymbolId(db, repo, symbolRef);
  if (!id) return { symbol: null, callers: [], error: 'symbol not found' };

  const symbol = db.prepare('SELECT * FROM symbols WHERE id = ?').get(id);
  const rows = db
    .prepare(
      `SELECT e.src_symbol, e.kind, s.name, s.file, s.line_start, s.line_end, s.signature
       FROM edges e
       JOIN symbols s ON s.id = e.src_symbol
       WHERE e.dst_symbol = ? AND e.kind = 'calls'
       ORDER BY s.file, s.line_start`,
    )
    .all(id);

  return {
    symbol,
    callers: rows.map((row) => ({
      symbolId: row.src_symbol,
      name: row.name,
      file: row.file,
      line: row.line_start,
      signature: row.signature,
      kind: row.kind,
    })),
  };
}

/**
 * Outgoing call edges for a symbol id or bare name.
 * @param {string} symbolRef
 */
export async function callsOf(symbolRef) {
  await ensureIndexFreshForQuery();
  const repo = activeRepoKey();
  const db = getCodeDb(repo);
  const id = resolveSymbolId(db, repo, symbolRef);
  if (!id) return { symbol: null, callees: [], error: 'symbol not found' };

  const symbol = db.prepare('SELECT * FROM symbols WHERE id = ?').get(id);
  const rows = db
    .prepare(
      `SELECT e.dst_symbol, e.kind, s.name, s.file, s.line_start, s.line_end, s.signature
       FROM edges e
       JOIN symbols s ON s.id = e.dst_symbol
       WHERE e.src_symbol = ? AND e.kind = 'calls'
       ORDER BY s.file, s.line_start`,
    )
    .all(id);

  return {
    symbol,
    callees: rows.map((row) => ({
      symbolId: row.dst_symbol,
      name: row.name,
      file: row.file,
      line: row.line_start,
      signature: row.signature,
      kind: row.kind,
    })),
  };
}

/**
 * Read the current source span for a symbol from disk (not cached body).
 * @param {string} symbolRef
 */
export async function readSymbol(symbolRef) {
  await ensureIndexFreshForQuery();
  const repo = activeRepoKey();
  const db = getCodeDb(repo);
  const id = resolveSymbolId(db, repo, symbolRef);
  if (!id) return { symbol: null, text: '', error: 'symbol not found' };

  const symbol = db.prepare('SELECT * FROM symbols WHERE id = ?').get(id);
  const root = getEffectiveWorkspaceRoot();
  const abs = path.join(root, symbol.file);
  const content = await fs.readFile(abs, 'utf8');
  const lines = content.split(/\r?\n/);
  const slice = lines.slice(symbol.line_start - 1, symbol.line_end);
  const numbered = slice
    .map((line, idx) => `${symbol.line_start + idx}: ${line}`)
    .join('\n');

  return {
    symbol,
    text: numbered,
  };
}

/**
 * Token-budgeted signature map, optionally focused on a substring.
 * @param {{ repo?: string, focus?: string, tokenBudget?: number, focusFiles?: string[] }} [opts]
 */
export async function repoMap(opts = {}) {
  await ensureIndexFreshForQuery();
  const code = await loadBrainCodeConfig();
  const repo = opts.repo?.trim() || activeRepoKey();
  const db = getCodeDb(repo);
  if (opts.focusFiles?.length) {
    recomputePageRank(db, new Set(opts.focusFiles));
  }

  const budget = clampRepoMapTokenBudget(opts.tokenBudget ?? code.repoMapTokenBudget);
  const rows = db
    .prepare(
      `SELECT id, file, signature, kind, pagerank, usage_count
       FROM symbols
       WHERE repo = ?
       ORDER BY pagerank DESC, usage_count DESC, file, line_start`,
    )
    .all(repo);

  return renderRepoMap(rows, budget, { focus: opts.focus });
}

/**
 * Resolve a symbol reference to a stable id.
 * @param {import('better-sqlite3').Database} db
 * @param {string} repo
 * @param {string} symbolRef
 */
function resolveSymbolId(db, repo, symbolRef) {
  const ref = String(symbolRef ?? '').trim();
  if (!ref) return null;
  if (ref.includes(':')) {
    const hit = db.prepare('SELECT id FROM symbols WHERE id = ?').get(ref);
    return hit?.id ?? null;
  }
  const qualified = `${repo}:${ref}`;
  const exact = db.prepare('SELECT id FROM symbols WHERE id = ?').get(qualified);
  if (exact) return exact.id;
  const byName = db
    .prepare(
      `SELECT id FROM symbols WHERE repo = ? AND name = ? ORDER BY pagerank DESC LIMIT 1`,
    )
    .get(repo, ref);
  return byName?.id ?? null;
}

export { reindexCode } from './indexer.js';
export { runCascade } from './cascade.js';
export { explainSymbol, resolveAnchorsToCode } from './anchors.js';
