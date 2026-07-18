/**
 * SQLite mail store for one email account (~/.minnow/email/mail-<accountId>.db).
 * Modelled on server/brain/code/schema.js (WAL + cached handle per key).
 *
 * `message_row_id` is the stable primary key: moves rewrite `folder`/`uid`, but
 * the row — and the triage/variants/bodies hanging off it — survive (MIN-350 D4).
 * WAL + one write path per account ends the read-modify-write races (D5).
 */

import fs from 'node:fs';
import Database from 'better-sqlite3';
import { emailDbPath, emailRootDir } from './paths.js';
import { getMinnowHome } from '../config/home.js';

/** @type {Map<string, import('better-sqlite3').Database>} */
const dbByCacheKey = new Map();

/** LRU order for open handles — oldest at index 0. */
const dbCacheLru = [];

/** Cap open handles so many accounts do not leak file descriptors. */
export const MAX_OPEN_MAIL_DBS = 8;

/** Bump when a migration needs an FTS rebuild (stored in PRAGMA user_version). */
export const MAIL_SCHEMA_VERSION = 1;

/**
 * @param {import('better-sqlite3').Database} database
 */
function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      message_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      folder TEXT NOT NULL,
      uid TEXT NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL DEFAULT '',
      from_addr TEXT NOT NULL DEFAULT '',
      to_json TEXT NOT NULL DEFAULT '[]',
      reply_to TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      date_ms INTEGER NOT NULL DEFAULT 0,
      body_preview TEXT NOT NULL DEFAULT '',
      body_hash TEXT NOT NULL DEFAULT '',
      has_attachments INTEGER NOT NULL DEFAULT 0,
      in_reply_to TEXT NOT NULL DEFAULT '',
      references_json TEXT NOT NULL DEFAULT '[]',
      seen INTEGER NOT NULL DEFAULT 0,
      flagged INTEGER NOT NULL DEFAULT 0,
      answered INTEGER NOT NULL DEFAULT 0,
      triage_json TEXT,
      reply_variants_json TEXT,
      UNIQUE (folder, uid)
    );

    CREATE TABLE IF NOT EXISTS bodies (
      message_row_id INTEGER PRIMARY KEY
        REFERENCES messages(message_row_id) ON DELETE CASCADE,
      body_text TEXT NOT NULL DEFAULT '',
      body_html TEXT,
      complete INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS attachments (
      message_row_id INTEGER NOT NULL
        REFERENCES messages(message_row_id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      filename TEXT NOT NULL DEFAULT 'attachment',
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (message_row_id, idx)
    );

    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL DEFAULT '',
      participants_json TEXT NOT NULL DEFAULT '[]',
      message_count INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      flagged INTEGER NOT NULL DEFAULT 0,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      last_date TEXT NOT NULL DEFAULT '',
      last_date_ms INTEGER NOT NULL DEFAULT 0,
      folders_json TEXT NOT NULL DEFAULT '[]',
      snippet TEXT NOT NULL DEFAULT '',
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      folder TEXT PRIMARY KEY,
      uid_validity TEXT NOT NULL DEFAULT '',
      highest_uid INTEGER NOT NULL DEFAULT 0,
      highest_modseq TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS contacts (
      address TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      seen_count INTEGER NOT NULL DEFAULT 0,
      replied_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL DEFAULT '{}',
      dispatch_at TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL DEFAULT '',
      message_row_id INTEGER,
      action TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      ran_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_messages_folder_date ON messages(folder, date_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
    CREATE INDEX IF NOT EXISTS idx_automation_runs_rule ON automation_runs(rule_id);
  `);

  migrateMessagesFts(database);
}

/** FTS5 mirror over subject/from/body — replaces the substring scan (D10). */
function createMessagesFtsTable(database) {
  database.exec(`
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      message_row_id UNINDEXED,
      subject,
      from_addr,
      body,
      tokenize='porter unicode61'
    );
  `);
}

/**
 * @param {import('better-sqlite3').Database} database
 */
function migrateMessagesFts(database) {
  const version = database.pragma('user_version', { simple: true });
  const ftsExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
    .get();

  if (version >= MAIL_SCHEMA_VERSION) {
    if (!ftsExists) createMessagesFtsTable(database);
    return;
  }

  const tx = database.transaction(() => {
    if (ftsExists) {
      database.exec('DROP TABLE messages_fts');
    }
    createMessagesFtsTable(database);
    database.exec(`
      INSERT INTO messages_fts (message_row_id, subject, from_addr, body)
      SELECT m.message_row_id, m.subject, m.from_addr,
             COALESCE(b.body_text, m.body_preview)
      FROM messages m LEFT JOIN bodies b USING (message_row_id);
    `);
    database.pragma(`user_version = ${MAIL_SCHEMA_VERSION}`);
  });
  tx();
}

/** Cache key includes MINNOW_HOME so parallel tests never share a handle. */
function mailDbCacheKey(accountId) {
  return `${getMinnowHome()}\0${String(accountId ?? '')}`;
}

function touchMailDbCache(cacheKey) {
  const idx = dbCacheLru.indexOf(cacheKey);
  if (idx >= 0) dbCacheLru.splice(idx, 1);
  dbCacheLru.push(cacheKey);
}

function evictOldestMailDbIfNeeded() {
  while (dbCacheLru.length >= MAX_OPEN_MAIL_DBS) {
    const oldest = dbCacheLru.shift();
    if (!oldest) break;
    const db = dbByCacheKey.get(oldest);
    if (db) {
      db.close();
      dbByCacheKey.delete(oldest);
    }
  }
}

/**
 * Open (or reuse) the mail store for an account.
 * @param {string} accountId
 * @returns {import('better-sqlite3').Database}
 */
export function getMailDb(accountId) {
  const key = String(accountId ?? '').trim();
  if (!key) {
    throw new Error('accountId is required');
  }
  const cacheKey = mailDbCacheKey(key);
  const existing = dbByCacheKey.get(cacheKey);
  if (existing) {
    touchMailDbCache(cacheKey);
    return existing;
  }

  evictOldestMailDbIfNeeded();

  fs.mkdirSync(emailRootDir(), { recursive: true });
  const db = new Database(emailDbPath(key));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  initSchema(db);
  dbByCacheKey.set(cacheKey, db);
  touchMailDbCache(cacheKey);
  return db;
}

/** Close all open mail store handles (tests, shutdown). */
export function closeMailDbs() {
  for (const db of dbByCacheKey.values()) {
    db.close();
  }
  dbByCacheKey.clear();
  dbCacheLru.length = 0;
}

/** Close the handle for one account without touching the others. */
export function closeMailDb(accountId) {
  const cacheKey = mailDbCacheKey(String(accountId ?? '').trim());
  const db = dbByCacheKey.get(cacheKey);
  if (!db) return false;
  db.close();
  dbByCacheKey.delete(cacheKey);
  const idx = dbCacheLru.indexOf(cacheKey);
  if (idx >= 0) dbCacheLru.splice(idx, 1);
  return true;
}

/**
 * Close and delete the mail store for one account (.db / -wal / -shm).
 * @param {string} accountId
 */
export function deleteMailDb(accountId) {
  closeMailDb(accountId);
  const base = emailDbPath(accountId);
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

/** Test helper — count of open in-memory handles. */
export function openMailDbCountForTests() {
  return dbByCacheKey.size;
}

// ---------------------------------------------------------------------------
// Row <-> message serialization
// ---------------------------------------------------------------------------

function parseJson(raw, fallback) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Convert a `messages` row (optionally joined with bodies) to the cache message
 * shape the rest of server/email and the UI already consume.
 * @param {Record<string, any>} row
 * @param {{ attachments?: Array<Record<string, unknown>> }} [extra]
 */
export function rowToMessage(row, extra = {}) {
  if (!row) return null;
  /** @type {Record<string, unknown>} */
  const message = {
    id: row.id,
    messageRowId: row.message_row_id,
    uid: String(row.uid),
    messageId: row.message_id ?? '',
    threadId: row.thread_id ?? '',
    folder: row.folder,
    from: row.from_addr ?? '',
    to: parseJson(row.to_json, []),
    replyTo: row.reply_to ?? '',
    subject: row.subject ?? '',
    date: row.date ?? '',
    bodyPreview: row.body_preview ?? '',
    bodyHash: row.body_hash ?? '',
    hasAttachments: Boolean(row.has_attachments),
    attachments: extra.attachments ?? [],
    inReplyTo: row.in_reply_to ?? '',
    references: parseJson(row.references_json, []),
    flags: {
      seen: Boolean(row.seen),
      flagged: Boolean(row.flagged),
      answered: Boolean(row.answered),
    },
  };

  if (row.body_text !== undefined && row.body_text !== null) {
    message.bodyText = row.body_text;
  }
  if (row.body_html !== undefined && row.body_html !== null) {
    message.bodyHtml = row.body_html;
  }
  if (row.triage_json) {
    message.triage = parseJson(row.triage_json, undefined);
  }
  if (row.reply_variants_json) {
    message.replyVariants = parseJson(row.reply_variants_json, undefined);
  }
  return message;
}

/** Load attachment metadata rows for a set of message row ids. */
export function loadAttachments(db, messageRowIds) {
  /** @type {Map<number, Array<Record<string, unknown>>>} */
  const byRow = new Map();
  if (!messageRowIds.length) return byRow;
  const placeholders = messageRowIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT message_row_id, idx, filename, content_type, size
       FROM attachments WHERE message_row_id IN (${placeholders}) ORDER BY idx`,
    )
    .all(...messageRowIds);
  for (const row of rows) {
    if (!byRow.has(row.message_row_id)) byRow.set(row.message_row_id, []);
    byRow.get(row.message_row_id).push({
      filename: row.filename,
      contentType: row.content_type,
      size: row.size,
    });
  }
  return byRow;
}

/** Attach `attachments` arrays to a batch of rows in one query. */
export function hydrateAttachments(db, rows) {
  const ids = rows.map((row) => row.message_row_id).filter((id) => Number.isFinite(id));
  const byRow = loadAttachments(db, ids);
  return rows.map((row) => rowToMessage(row, { attachments: byRow.get(row.message_row_id) ?? [] }));
}

/** Refresh the FTS mirror for one message. */
export function reindexMessageFts(db, messageRowId) {
  const row = db
    .prepare(
      `SELECT m.message_row_id, m.subject, m.from_addr,
              COALESCE(b.body_text, m.body_preview) AS body
       FROM messages m LEFT JOIN bodies b USING (message_row_id)
       WHERE m.message_row_id = ?`,
    )
    .get(messageRowId);
  db.prepare('DELETE FROM messages_fts WHERE message_row_id = ?').run(messageRowId);
  if (!row) return;
  db.prepare(
    'INSERT INTO messages_fts (message_row_id, subject, from_addr, body) VALUES (?, ?, ?, ?)',
  ).run(row.message_row_id, row.subject ?? '', row.from_addr ?? '', row.body ?? '');
}

/**
 * Recompute the materialized `threads` rollup for one thread id.
 * Called inside the caller's transaction after message writes.
 */
export function recomputeThread(db, threadId) {
  const id = String(threadId ?? '');
  if (!id) return;
  const rows = db
    .prepare(
      `SELECT folder, subject, from_addr, date, date_ms, seen, flagged,
              has_attachments, body_preview
       FROM messages WHERE thread_id = ? ORDER BY date_ms ASC`,
    )
    .all(id);

  if (!rows.length) {
    db.prepare('DELETE FROM threads WHERE thread_id = ?').run(id);
    return;
  }

  const last = rows[rows.length - 1];
  const participants = [];
  const folders = [];
  for (const row of rows) {
    if (row.from_addr && !participants.includes(row.from_addr)) participants.push(row.from_addr);
    if (row.folder && !folders.includes(row.folder)) folders.push(row.folder);
  }

  db.prepare(
    `INSERT INTO threads (
       thread_id, subject, participants_json, message_count, unread_count,
       flagged, has_attachments, last_date, last_date_ms, folders_json, snippet
     ) VALUES (
       @thread_id, @subject, @participants_json, @message_count, @unread_count,
       @flagged, @has_attachments, @last_date, @last_date_ms, @folders_json, @snippet
     )
     ON CONFLICT(thread_id) DO UPDATE SET
       subject = excluded.subject,
       participants_json = excluded.participants_json,
       message_count = excluded.message_count,
       unread_count = excluded.unread_count,
       flagged = excluded.flagged,
       has_attachments = excluded.has_attachments,
       last_date = excluded.last_date,
       last_date_ms = excluded.last_date_ms,
       folders_json = excluded.folders_json,
       snippet = excluded.snippet`,
  ).run({
    thread_id: id,
    subject: rows.find((row) => row.subject)?.subject ?? '',
    participants_json: JSON.stringify(participants),
    message_count: rows.length,
    unread_count: rows.filter((row) => !row.seen).length,
    flagged: rows.some((row) => row.flagged) ? 1 : 0,
    has_attachments: rows.some((row) => row.has_attachments) ? 1 : 0,
    last_date: last.date ?? '',
    last_date_ms: last.date_ms ?? 0,
    folders_json: JSON.stringify(folders),
    snippet: last.body_preview ?? '',
  });
}

/** Read a `meta` value as JSON. */
export function readMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? parseJson(row.value, fallback) : fallback;
}

/** Write a `meta` value as JSON. */
export function writeMeta(db, key, value) {
  if (value === undefined || value === null) {
    db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    return;
  }
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}
