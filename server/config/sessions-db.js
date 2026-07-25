/**
 * SQLite sessions store (~/.minnow/sessions/sessions.db).
 * Modelled on server/email/store.js (WAL + cached handle + meta helpers).
 *
 * Phase A.1: DB is created and JSON-imported on first open; nothing product-facing
 * reads it yet (HTTP still uses state.json until A.2).
 */

import fs from 'node:fs';
import Database from 'better-sqlite3';
import { getMinnowHome } from './home.js';
import {
  sessionsDbPath,
  sessionsRootDir,
} from './sessions-paths.js';
import {
  ensureColumn,
  initSessionsSchema,
  readSessionMeta,
  writeSessionMeta,
  SESSIONS_DB_SCHEMA_VERSION,
} from './sessions-schema.js';
import { importJsonSessionsIfNeeded } from './sessions-import.js';

/** @type {Map<string, import('better-sqlite3').Database>} */
const dbByCacheKey = new Map();

export {
  ensureColumn,
  readSessionMeta,
  writeSessionMeta,
  SESSIONS_DB_SCHEMA_VERSION,
};

/** Cache key includes MINNOW_HOME so parallel tests never share a handle. */
function sessionsDbCacheKey() {
  return `${getMinnowHome()}\0sessions`;
}

/** Open a raw connection and apply schema PRAGMAs + DDL. */
function openSessionsDatabase() {
  fs.mkdirSync(sessionsRootDir(), { recursive: true });
  const db = new Database(sessionsDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  initSessionsSchema(db);
  return db;
}

/**
 * Rename sessions.db (+ wal/shm) aside so a fresh file can be created.
 * @returns {string} Timestamp suffix used on the quarantine files.
 */
function quarantineCorruptSessionsDb() {
  const ts = Date.now();
  const base = sessionsDbPath();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = `${base}${suffix}`;
    if (!fs.existsSync(filePath)) continue;
    try {
      fs.renameSync(filePath, `${filePath}.corrupt-${ts}`);
    } catch {
      // Best-effort: if rename fails, delete so open can proceed.
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  return String(ts);
}

/**
 * Open (or reuse) the sessions store. Always runs JSON→SQLite import after schema
 * so callers can never observe an un-imported handle.
 * @returns {import('better-sqlite3').Database}
 */
export function getSessionsDb() {
  const cacheKey = sessionsDbCacheKey();
  const existing = dbByCacheKey.get(cacheKey);
  if (existing) {
    return existing;
  }

  let db = openSessionsDatabase();

  // Integrity probe on first open of this process handle.
  const quickCheck = db.pragma('quick_check', { simple: true });
  if (quickCheck !== 'ok') {
    db.close();
    const ts = quarantineCorruptSessionsDb();
    db = openSessionsDatabase();
    // Surface for GET /api/config/status in a later phase.
    writeSessionMeta(db, 'dbCorruptRecoveredAt', new Date().toISOString());
    writeSessionMeta(db, 'dbCorruptQuickCheck', String(quickCheck));
    writeSessionMeta(db, 'dbCorruptQuarantineTs', ts);
    importJsonSessionsIfNeeded(db, { recovery: true });
  } else {
    // Impossible to obtain a handle that skipped import.
    importJsonSessionsIfNeeded(db);
  }

  dbByCacheKey.set(cacheKey, db);
  return db;
}

/** Close the cached sessions DB handle (tests, shutdown). */
export function closeSessionsDb() {
  const cacheKey = sessionsDbCacheKey();
  const db = dbByCacheKey.get(cacheKey);
  if (!db) return false;
  db.close();
  dbByCacheKey.delete(cacheKey);
  return true;
}

/** Close and delete sessions.db (+ wal/shm). */
export function deleteSessionsDb() {
  closeSessionsDb();
  const base = sessionsDbPath();
  let removed = false;
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = `${base}${suffix}`;
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      if (!suffix) removed = true;
    }
  }
  return removed;
}

/** Test helper — count of open sessions DB handles. */
export function openSessionsDbCountForTests() {
  return dbByCacheKey.size;
}
