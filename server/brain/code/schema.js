/**
 * SQLite schema for the per-workspace Brain code index (~/.minnow/brain/code/<key>.db).
 * Modelled on server/calendar/store.js (WAL + singleton handle).
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getBrainCodeDir, brainWorkspaceKeyFromPath } from '../paths.js';
import { getEffectiveWorkspaceRoot } from '../../runtime/path-access.js';
import { getMinnowHome } from '../../config/home.js';

/** @type {Map<string, import('better-sqlite3').Database>} */
const dbByWorkspaceKey = new Map();

/** Absolute path for a workspace code-index database file. */
export function codeDbPath(workspaceKey) {
  const slug = String(workspaceKey ?? '').trim() || 'workspace';
  return path.join(getBrainCodeDir(), `${slug}.db`);
}

/**
 * Initialize tables on a fresh database connection.
 * @param {import('better-sqlite3').Database} database
 */
function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      file TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      signature TEXT NOT NULL DEFAULT '',
      doc TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      pagerank REAL NOT NULL DEFAULT 0,
      usage_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS edges (
      src_symbol TEXT NOT NULL,
      dst_symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      PRIMARY KEY (src_symbol, dst_symbol, kind)
    );

    CREATE TABLE IF NOT EXISTS file_hashes (
      repo TEXT NOT NULL,
      file TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      PRIMARY KEY (repo, file)
    );

    CREATE TABLE IF NOT EXISTS anchors (
      page_id TEXT NOT NULL,
      symbol_id TEXT NOT NULL,
      repo TEXT NOT NULL,
      symbol_hash_at_synth TEXT NOT NULL,
      PRIMARY KEY (page_id, symbol_id)
    );

    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file);
    CREATE INDEX IF NOT EXISTS idx_symbols_repo ON symbols(repo);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_symbol);
    CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_symbol);
  `);

  // FTS5 over symbol name + doc for lexical find_symbol queries.
  const ftsTables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='symbols_fts'")
    .all();
  if (ftsTables.length === 0) {
    database.exec(`
      CREATE VIRTUAL TABLE symbols_fts USING fts5(
        symbol_id UNINDEXED,
        name,
        doc,
        tokenize='porter unicode61'
      );
    `);
  }
}

/** Cache key combines MINNOW_HOME + workspace slug so parallel tests do not share handles. */
function codeDbCacheKey(workspaceKey) {
  const slug = String(workspaceKey ?? '').trim() || 'workspace';
  return `${getMinnowHome()}\0${slug}`;
}

/**
 * Open (or reuse) the code index DB for a workspace key.
 * @param {string} [workspaceKey]
 * @returns {import('better-sqlite3').Database}
 */
export function getCodeDb(workspaceKey) {
  const key =
    workspaceKey?.trim() ||
    brainWorkspaceKeyFromPath(getEffectiveWorkspaceRoot()) ||
    'workspace';
  const cacheKey = codeDbCacheKey(key);
  const existing = dbByWorkspaceKey.get(cacheKey);
  if (existing) return existing;

  const dir = getBrainCodeDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(codeDbPath(key));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  dbByWorkspaceKey.set(cacheKey, db);
  return db;
}

/** Close all open code-index DB handles (tests). */
export function closeCodeDbForTests() {
  for (const db of dbByWorkspaceKey.values()) {
    db.close();
  }
  dbByWorkspaceKey.clear();
}

/** Remove symbols and FTS rows for one file before re-indexing it. */
export function deleteSymbolsForFile(db, repo, file) {
  const ids = db
    .prepare('SELECT id FROM symbols WHERE repo = ? AND file = ?')
    .all(repo, file)
    .map((row) => row.id);
  if (ids.length === 0) return;
  const delEdge = db.prepare(
    'DELETE FROM edges WHERE src_symbol = ? OR dst_symbol = ?',
  );
  const delSym = db.prepare('DELETE FROM symbols WHERE id = ?');
  const delFts = db.prepare('DELETE FROM symbols_fts WHERE symbol_id = ?');
  const tx = db.transaction((symbolIds) => {
    for (const id of symbolIds) {
      delEdge.run(id, id);
      delFts.run(id);
      delSym.run(id);
    }
  });
  tx(ids);
}

/** Upsert one symbol row and its FTS mirror. */
export function upsertSymbol(db, row) {
  db.prepare(
    `INSERT INTO symbols (
      id, repo, kind, name, file, line_start, line_end,
      signature, doc, content_hash, pagerank, usage_count
    ) VALUES (
      @id, @repo, @kind, @name, @file, @line_start, @line_end,
      @signature, @doc, @content_hash, @pagerank, @usage_count
    )
    ON CONFLICT(id) DO UPDATE SET
      repo = excluded.repo,
      kind = excluded.kind,
      name = excluded.name,
      file = excluded.file,
      line_start = excluded.line_start,
      line_end = excluded.line_end,
      signature = excluded.signature,
      doc = excluded.doc,
      content_hash = excluded.content_hash,
      usage_count = excluded.usage_count`,
  ).run(row);
  db.prepare('DELETE FROM symbols_fts WHERE symbol_id = ?').run(row.id);
  db.prepare('INSERT INTO symbols_fts (symbol_id, name, doc) VALUES (?, ?, ?)').run(
    row.id,
    row.name,
    row.doc ?? '',
  );
}

/** Upsert a directed graph edge (calls, imports, extends, uses). */
export function upsertEdge(db, srcSymbol, dstSymbol, kind) {
  if (!srcSymbol || !dstSymbol || srcSymbol === dstSymbol) return;
  db.prepare(
    `INSERT INTO edges (src_symbol, dst_symbol, kind)
     VALUES (?, ?, ?)
     ON CONFLICT(src_symbol, dst_symbol, kind) DO NOTHING`,
  ).run(srcSymbol, dstSymbol, kind);
}

/** Record file content hash after a successful index pass. */
export function upsertFileHash(db, repo, file, sha256, mtimeMs) {
  db.prepare(
    `INSERT INTO file_hashes (repo, file, sha256, mtime_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo, file) DO UPDATE SET
       sha256 = excluded.sha256,
       mtime_ms = excluded.mtime_ms`,
  ).run(repo, file, sha256, mtimeMs);
}

/** Persist computed PageRank scores. */
export function writePageRanks(db, scores) {
  const stmt = db.prepare('UPDATE symbols SET pagerank = ? WHERE id = ?');
  const tx = db.transaction((entries) => {
    for (const [id, score] of entries) {
      stmt.run(score, id);
    }
  });
  tx(Object.entries(scores));
}

/** Aggregate index stats for status endpoints. */
export function getIndexStats(db) {
  const symbols = db.prepare('SELECT COUNT(*) AS n FROM symbols').get()?.n ?? 0;
  const edges = db.prepare('SELECT COUNT(*) AS n FROM edges').get()?.n ?? 0;
  const files = db.prepare('SELECT COUNT(*) AS n FROM file_hashes').get()?.n ?? 0;
  const lastMtime = db
    .prepare('SELECT MAX(mtime_ms) AS m FROM file_hashes')
    .get()?.m;
  return {
    symbolCount: symbols,
    edgeCount: edges,
    fileCount: files,
    lastIndexedAt: lastMtime ? new Date(lastMtime).toISOString() : null,
  };
}
