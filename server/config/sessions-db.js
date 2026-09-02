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
import { flushSessionsJsonMirror } from './sessions-json-mirror.js';

/** @type {Map<string, import('better-sqlite3').Database>} */
const dbByCacheKey = new Map();

export {
  ensureColumn,
  readSessionMeta,
  writeSessionMeta,
  SESSIONS_DB_SCHEMA_VERSION,
};

function sessionsDbCacheKey() {
  return `${getMinnowHome()}\0sessions`;
}

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
 * @returns {string}
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
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
      }
    }
  }
  return String(ts);
}

/**
 * @returns {import('better-sqlite3').Database}
 */
export function getSessionsDb() {
  const cacheKey = sessionsDbCacheKey();
  const existing = dbByCacheKey.get(cacheKey);
  if (existing) {
    return existing;
  }

  let db = openSessionsDatabase();

  const quickCheck = db.pragma('quick_check', { simple: true });
  if (quickCheck !== 'ok') {
    db.close();
    const ts = quarantineCorruptSessionsDb();
    db = openSessionsDatabase();
    writeSessionMeta(db, 'dbCorruptRecoveredAt', new Date().toISOString());
    writeSessionMeta(db, 'dbCorruptQuickCheck', String(quickCheck));
    writeSessionMeta(db, 'dbCorruptQuarantineTs', ts);
    importJsonSessionsIfNeeded(db, { recovery: true });
  } else {
    importJsonSessionsIfNeeded(db);
  }

  dbByCacheKey.set(cacheKey, db);
  return db;
}

export function closeSessionsDb() {
  const cacheKey = sessionsDbCacheKey();
  const db = dbByCacheKey.get(cacheKey);
  if (!db) return false;
  try {
    flushSessionsJsonMirror();
  } catch {
  }
  db.close();
  dbByCacheKey.delete(cacheKey);
  return true;
}

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

export function openSessionsDbCountForTests() {
  return dbByCacheKey.size;
}
