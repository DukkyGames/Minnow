/**
 * Local mail store access (~/.minnow/email/mail-<accountId>.db).
 *
 * Keeps the async API the rest of server/email was written against; the backing
 * store is now SQLite (see store.js) instead of one big rewritten JSON file.
 */

import fs from 'node:fs/promises';
import { emailCacheMessagesPath } from './paths.js';
import { harvestMessageContacts } from './contacts.js';
import {
  getMailDb,
  hydrateAttachments,
  readMeta,
  recomputeThread,
  reindexMessageFts,
  writeMeta,
} from './store.js';
import { sanitizePreviewText } from './parse-body.js';

/**
 * @typedef {object} EmailMessageFlags
 * @property {boolean} seen
 * @property {boolean} flagged
 * @property {boolean} [answered]
 */

/** Columns needed for the metadata (no-body) message shape. */
const MESSAGE_COLUMNS = `message_row_id, id, folder, uid, message_id, thread_id, from_addr,
  to_json, reply_to, subject, date, date_ms, body_preview, body_hash, has_attachments,
  in_reply_to, references_json, seen, flagged, answered, snooze_until, triage_json,
  reply_variants_json`;

/** Same, joined with bodies for reader/agent paths that need the text. */
const MESSAGE_COLUMNS_WITH_BODY = `m.message_row_id, m.id, m.folder, m.uid, m.message_id,
  m.thread_id, m.from_addr, m.to_json, m.reply_to, m.subject, m.date, m.date_ms,
  m.body_preview, m.body_hash, m.has_attachments, m.in_reply_to, m.references_json,
  m.seen, m.flagged, m.answered, m.snooze_until, m.triage_json, m.reply_variants_json,
  b.body_text, b.body_html, b.complete AS body_complete`;

function nowIso() {
  return new Date().toISOString();
}

function toMs(date) {
  const ms = new Date(String(date ?? '')).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Locate one message row by stable id, `folder:uid`, or (when unambiguous) bare uid.
 * @param {import('better-sqlite3').Database} db
 * @param {string} messageKey
 * @param {boolean} [withBody]
 */
function findRow(db, messageKey, withBody = false) {
  const needle = String(messageKey ?? '');
  if (!needle) return null;

  const select = withBody
    ? `SELECT ${MESSAGE_COLUMNS_WITH_BODY} FROM messages m LEFT JOIN bodies b USING (message_row_id)`
    : `SELECT ${MESSAGE_COLUMNS} FROM messages`;
  const alias = withBody ? 'm.' : '';

  const byId = db.prepare(`${select} WHERE ${alias}id = ?`).get(needle);
  if (byId) return byId;

  const colonAt = needle.lastIndexOf(':');
  if (colonAt > 0) {
    const folder = needle.slice(0, colonAt);
    const uid = needle.slice(colonAt + 1);
    const byFolderUid = db
      .prepare(`${select} WHERE ${alias}folder = ? AND ${alias}uid = ?`)
      .get(folder, uid);
    if (byFolderUid) return byFolderUid;
  }

  // Legacy bare-uid callers: only honored when it resolves to exactly one row,
  // so UID 5 in INBOX can no longer shadow UID 5 in Sent (MIN-350 D4).
  const byUid = db.prepare(`${select} WHERE ${alias}uid = ? LIMIT 2`).all(needle);
  return byUid.length === 1 ? byUid[0] : null;
}

/** Row id lookup without materializing the whole row. */
function findRowId(db, messageKey) {
  const row = findRow(db, messageKey);
  return row ? row.message_row_id : null;
}

/**
 * Pick a stable, never-rewritten public id for a new message.
 * Base form matches the historical `${folder}:${uid}`; a moved-away row keeps
 * its id, so a later message reusing that folder/uid gets a suffixed one.
 */
function allocateMessageId(db, folder, uid) {
  const base = `${folder}:${uid}`;
  const exists = db.prepare('SELECT 1 FROM messages WHERE id = ?');
  if (!exists.get(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}#${n}`;
    if (!exists.get(candidate)) return candidate;
  }
  return `${base}#${Date.now()}`;
}

/**
 * Insert or update one parsed message. Runs inside the caller's transaction.
 * @returns {number} message_row_id
 */
function upsertMessageRow(db, message) {
  const folder = String(message.folder ?? 'INBOX');
  const uid = String(message.uid ?? '');
  const existing =
    (message.id ? db.prepare('SELECT message_row_id FROM messages WHERE id = ?').get(String(message.id)) : null) ??
    db.prepare('SELECT message_row_id FROM messages WHERE folder = ? AND uid = ?').get(folder, uid);

  const flags = message.flags ?? {};
  const values = {
    folder,
    uid,
    message_id: String(message.messageId ?? ''),
    thread_id: String(message.threadId ?? ''),
    from_addr: String(message.from ?? ''),
    to_json: JSON.stringify(Array.isArray(message.to) ? message.to : []),
    reply_to: String(message.replyTo ?? ''),
    subject: String(message.subject ?? ''),
    date: String(message.date ?? ''),
    date_ms: toMs(message.date),
    body_preview: String(message.bodyPreview ?? ''),
    body_hash: String(message.bodyHash ?? ''),
    has_attachments: message.hasAttachments ? 1 : 0,
    in_reply_to: String(message.inReplyTo ?? ''),
    references_json: JSON.stringify(Array.isArray(message.references) ? message.references : []),
    seen: flags.seen ? 1 : 0,
    flagged: flags.flagged ? 1 : 0,
    answered: flags.answered ? 1 : 0,
  };

  let rowId;
  if (existing) {
    rowId = existing.message_row_id;
    db.prepare(
      `UPDATE messages SET
         folder = @folder, uid = @uid, message_id = @message_id, thread_id = @thread_id,
         from_addr = @from_addr, to_json = @to_json, reply_to = @reply_to, subject = @subject,
         date = @date, date_ms = @date_ms, body_preview = @body_preview, body_hash = @body_hash,
         has_attachments = @has_attachments, in_reply_to = @in_reply_to,
         references_json = @references_json, seen = @seen, flagged = @flagged, answered = @answered
       WHERE message_row_id = @message_row_id`,
    ).run({ ...values, message_row_id: rowId });
  } else {
    const id = String(message.id ?? '') || allocateMessageId(db, folder, uid);
    const info = db
      .prepare(
        `INSERT INTO messages (
           id, folder, uid, message_id, thread_id, from_addr, to_json, reply_to, subject,
           date, date_ms, body_preview, body_hash, has_attachments, in_reply_to,
           references_json, seen, flagged, answered
         ) VALUES (
           @id, @folder, @uid, @message_id, @thread_id, @from_addr, @to_json, @reply_to, @subject,
           @date, @date_ms, @body_preview, @body_hash, @has_attachments, @in_reply_to,
           @references_json, @seen, @flagged, @answered
         )`,
      )
      .run({ ...values, id });
    rowId = Number(info.lastInsertRowid);
  }

  if (message.triage !== undefined) {
    db.prepare('UPDATE messages SET triage_json = ? WHERE message_row_id = ?').run(
      message.triage ? JSON.stringify(message.triage) : null,
      rowId,
    );
  }
  if (message.replyVariants !== undefined) {
    db.prepare('UPDATE messages SET reply_variants_json = ? WHERE message_row_id = ?').run(
      message.replyVariants ? JSON.stringify(message.replyVariants) : null,
      rowId,
    );
  }

  if (Array.isArray(message.attachments)) {
    replaceAttachmentRows(db, rowId, message.attachments);
  }

  if (typeof message.bodyText === 'string' || typeof message.bodyHtml === 'string') {
    saveBodyRow(db, rowId, {
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      complete: message.bodyComplete,
    });
  }

  reindexMessageFts(db, rowId);
  recomputeThread(db, values.thread_id);
  // Every message that lands teaches the address book a little more; doing it
  // here means autocomplete needs no separate scan over the mailbox.
  harvestMessageContacts(db, message);
  return rowId;
}

/**
 * Replace the attachment rows for a message.
 *
 * `idx` is the message's own part ordering — the download route addresses parts
 * by it, so it must match the order `simpleParser` returns.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} rowId
 * @param {Array<Record<string, unknown>>} attachments
 */
function replaceAttachmentRows(db, rowId, attachments) {
  db.prepare('DELETE FROM attachments WHERE message_row_id = ?').run(rowId);
  const insert = db.prepare(
    `INSERT INTO attachments (message_row_id, idx, filename, content_type, size, content_id, inline)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  attachments.forEach((att, idx) => {
    insert.run(
      rowId,
      idx,
      String(att?.filename ?? 'attachment'),
      String(att?.contentType ?? 'application/octet-stream'),
      Number(att?.size) || 0,
      String(att?.contentId ?? ''),
      att?.inline ? 1 : 0,
    );
  });
}

/** Upsert the lazily-fetched body for a message row. */
function saveBodyRow(db, rowId, { bodyText, bodyHtml, complete }) {
  const existing = db.prepare('SELECT * FROM bodies WHERE message_row_id = ?').get(rowId);
  // A re-sync carries only the preview text; it must not overwrite a body that
  // was already fully downloaded (which would drop the HTML part).
  if (existing?.complete && !complete) {
    return;
  }
  db.prepare(
    `INSERT INTO bodies (message_row_id, body_text, body_html, complete, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(message_row_id) DO UPDATE SET
       body_text = excluded.body_text,
       body_html = excluded.body_html,
       complete = excluded.complete,
       fetched_at = excluded.fetched_at`,
  ).run(
    rowId,
    typeof bodyText === 'string' ? bodyText : (existing?.body_text ?? ''),
    typeof bodyHtml === 'string' ? bodyHtml : (existing?.body_html ?? null),
    complete === undefined ? (existing?.complete ?? 0) : complete ? 1 : 0,
    nowIso(),
  );
}

// ---------------------------------------------------------------------------
// JSON → SQLite migration (one-time, idempotent)
// ---------------------------------------------------------------------------

/**
 * Import a pre-Phase-1 `messages.json` cache once. The JSON file is kept (and
 * renamed to `.migrated`) so a bad import can be replayed by hand.
 * @param {string} accountId
 */
export async function migrateJsonCacheIfNeeded(accountId) {
  const db = getMailDb(accountId);
  if (readMeta(db, 'jsonMigratedAt')) {
    return { migrated: false, reason: 'already_migrated' };
  }

  const filePath = emailCacheMessagesPath(accountId);
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      writeMeta(db, 'jsonMigratedAt', nowIso());
      return { migrated: false, reason: 'no_json_cache' };
    }
    throw err;
  }

  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const cursors = parsed?.folderCursors && typeof parsed.folderCursors === 'object' ? parsed.folderCursors : {};

  const tx = db.transaction(() => {
    for (const message of messages) {
      upsertMessageRow(db, message);
    }
    for (const [folder, cursor] of Object.entries(cursors)) {
      setSyncStateRow(db, folder, { highestUid: Number(cursor?.highestUid) || 0 });
    }
    if (parsed?.inboxSummary && typeof parsed.inboxSummary === 'object') {
      writeMeta(db, 'inboxSummary', parsed.inboxSummary);
    }
    writeMeta(db, 'jsonMigratedAt', nowIso());
  });
  tx();

  // Integrity check before retiring the JSON file (Part 7 constraint).
  const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n ?? 0;
  if (count >= messages.length) {
    await fs.rename(filePath, `${filePath}.migrated`).catch(() => {});
  }

  return { migrated: true, messages: messages.length };
}

// ---------------------------------------------------------------------------
// Legacy JSON-shaped API (metadata only — bodies are loaded on demand)
// ---------------------------------------------------------------------------

/**
 * Read the whole account store in the historical cache-file shape.
 * @param {string} accountId
 */
export async function readMessageCache(accountId) {
  const db = getMailDb(accountId);
  const rows = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages ORDER BY date_ms DESC`).all();
  /** @type {Record<string, { highestUid?: number }>} */
  const folderCursors = {};
  for (const row of db.prepare('SELECT folder, highest_uid FROM sync_state').all()) {
    folderCursors[row.folder] = { highestUid: row.highest_uid };
  }
  return {
    version: 2,
    folderCursors,
    messages: hydrateAttachments(db, rows),
    inboxSummary: readMeta(db, 'inboxSummary', undefined) ?? undefined,
  };
}

/**
 * Replace the whole store with the given cache object (tests, recovery).
 * @param {string} accountId
 * @param {{ messages?: Array<Record<string, unknown>>, folderCursors?: Record<string, { highestUid?: number }>, inboxSummary?: object }} cache
 */
export async function writeMessageCache(accountId, cache) {
  const db = getMailDb(accountId);
  const tx = db.transaction(() => {
    // A whole-store replace must drop the sync cursors too, or the next sync
    // asks for `UID cursor+1:*` against an empty store and skips everything.
    db.exec('DELETE FROM messages; DELETE FROM messages_fts; DELETE FROM threads; DELETE FROM sync_state;');
    for (const message of cache.messages ?? []) {
      upsertMessageRow(db, message);
    }
    for (const [folder, cursor] of Object.entries(cache.folderCursors ?? {})) {
      setSyncStateRow(db, folder, { highestUid: Number(cursor?.highestUid) || 0 });
    }
    writeMeta(db, 'inboxSummary', cache.inboxSummary ?? null);
  });
  tx();
}

/**
 * Merge fetched messages into the store and advance the folder cursor.
 * @param {string} accountId
 * @param {Array<Record<string, unknown>>} incoming
 * @param {string} folder
 * @param {number | undefined} highestUid
 */
export async function mergeMessagesIntoCache(accountId, incoming, folder, highestUid) {
  const db = getMailDb(accountId);
  const tx = db.transaction(() => {
    for (const message of incoming) {
      upsertMessageRow(db, message);
    }
    if (highestUid && Number.isFinite(highestUid)) {
      const prev = db.prepare('SELECT highest_uid FROM sync_state WHERE folder = ?').get(folder);
      setSyncStateRow(db, folder, {
        highestUid: Math.max(prev?.highest_uid ?? 0, highestUid),
      });
    } else {
      setSyncStateRow(db, folder, {});
    }
  });
  tx();
  return readMessageCache(accountId);
}

/**
 * List cached messages with folder filter, flag filter, FTS query, pagination.
 * @param {string} accountId
 * @param {{ folder?: string, offset?: number, limit?: number, query?: string, filter?: string, includeSnoozed?: boolean }} options
 */
export async function listCachedMessages(accountId, options = {}) {
  const db = getMailDb(accountId);
  const where = [];
  const params = [];

  const folder = options.folder ? String(options.folder) : '';
  if (folder) {
    where.push('folder = ?');
    params.push(folder);
  }

  const filter = String(options.filter ?? '').trim().toLowerCase();
  if (filter === 'unread') {
    where.push('seen = 0');
  } else if (filter === 'flagged') {
    where.push('flagged = 1');
  } else if (filter === 'snoozed') {
    where.push("snooze_until != ''");
  }

  // A snoozed message is hidden from the ordinary list until it comes due —
  // except in the snoozed view itself, where hiding it would be absurd.
  if (filter !== 'snoozed' && options.includeSnoozed !== true) {
    where.push("(snooze_until = '' OR snooze_until <= ?)");
    params.push(new Date().toISOString());
  }

  const query = String(options.query ?? '').trim();
  if (query) {
    where.push(
      `message_row_id IN (SELECT message_row_id FROM messages_fts WHERE messages_fts MATCH ?)`,
    );
    params.push(toFtsQuery(query));
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));

  const total = db.prepare(`SELECT COUNT(*) AS n FROM messages ${clause}`).get(...params)?.n ?? 0;
  const rows = db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages ${clause} ORDER BY date_ms DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return { messages: hydrateAttachments(db, rows), total, offset, limit };
}

/**
 * Recent messages from one sender outside a given thread — context recall for
 * draft prompts (§3.6): "what did we last talk about with this person".
 * @param {string} accountId
 * @param {string} senderAddress — bare lowercased address
 * @param {{ excludeThreadId?: string, limit?: number }} [options]
 */
export async function listRecentMessagesFromSender(accountId, senderAddress, options = {}) {
  const address = String(senderAddress ?? '').trim().toLowerCase();
  if (!address || !address.includes('@')) {
    return [];
  }
  const db = getMailDb(accountId);
  const limit = Math.min(10, Math.max(1, Number(options.limit) || 4));
  const excludeThreadId = String(options.excludeThreadId ?? '');

  const rows = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
       WHERE lower(from_addr) LIKE ? AND thread_id != ?
       ORDER BY date_ms DESC LIMIT ?`,
    )
    .all(`%${address}%`, excludeThreadId, limit);
  return hydrateAttachments(db, rows);
}

/**
 * Turn a user query into a safe FTS5 MATCH expression (prefix-matched terms).
 * @param {string} raw
 */
export function toFtsQuery(raw) {
  const terms = String(raw ?? '')
    .split(/\s+/)
    .map((term) => term.replace(/["*]/g, '').trim())
    .filter(Boolean);
  if (!terms.length) {
    return '""';
  }
  return terms.map((term) => `"${term}"*`).join(' AND ');
}

/**
 * Full-text search across folders (D10 — bodies are indexed too).
 * @param {string} accountId
 * @param {{ query: string, folder?: string, offset?: number, limit?: number }} options
 */
export async function searchCachedMessages(accountId, options) {
  const query = String(options?.query ?? '').trim();
  if (!query) {
    return { messages: [], total: 0, offset: 0, limit: 0, query };
  }
  const db = getMailDb(accountId);
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
  const folder = options.folder ? String(options.folder) : '';

  const params = [toFtsQuery(query)];
  let folderClause = '';
  if (folder) {
    folderClause = 'AND m.folder = ?';
    params.push(folder);
  }

  const total =
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages_fts f
         JOIN messages m ON m.message_row_id = f.message_row_id
         WHERE messages_fts MATCH ? ${folderClause}`,
      )
      .get(...params)?.n ?? 0;

  const rows = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS.split(', ').map((col) => `m.${col.trim()}`).join(', ')}
       FROM messages_fts f
       JOIN messages m ON m.message_row_id = f.message_row_id
       WHERE messages_fts MATCH ? ${folderClause}
       ORDER BY bm25(messages_fts), m.date_ms DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  return { messages: hydrateAttachments(db, rows), total, offset, limit, query };
}

/**
 * Conversation rollups for the thread list.
 * @param {string} accountId
 * @param {{ folder?: string, offset?: number, limit?: number, filter?: string, query?: string, includeSnoozed?: boolean }} options
 */
export async function listCachedThreads(accountId, options = {}) {
  const db = getMailDb(accountId);
  const where = [];
  const params = [];

  const folder = options.folder ? String(options.folder) : '';
  if (folder) {
    where.push('t.thread_id IN (SELECT thread_id FROM messages WHERE folder = ?)');
    params.push(folder);
  }

  const filter = String(options.filter ?? '').trim().toLowerCase();
  if (filter === 'unread') {
    where.push('t.unread_count > 0');
  } else if (filter === 'flagged') {
    where.push('t.flagged = 1');
  } else if (filter === 'snoozed') {
    where.push("t.thread_id IN (SELECT thread_id FROM messages WHERE snooze_until != '')");
  }

  // A conversation disappears only when every message in it is snoozed —
  // otherwise snoozing one reply would hide the whole exchange.
  if (filter !== 'snoozed' && options.includeSnoozed !== true) {
    where.push(
      `t.thread_id IN (
         SELECT thread_id FROM messages WHERE snooze_until = '' OR snooze_until <= ?)`,
    );
    params.push(new Date().toISOString());
  }

  const query = String(options.query ?? '').trim();
  if (query) {
    where.push(
      `t.thread_id IN (
         SELECT m.thread_id FROM messages_fts f
         JOIN messages m ON m.message_row_id = f.message_row_id
         WHERE messages_fts MATCH ?)`,
    );
    params.push(toFtsQuery(query));
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));

  const total = db.prepare(`SELECT COUNT(*) AS n FROM threads t ${clause}`).get(...params)?.n ?? 0;
  const rows = db
    .prepare(`SELECT t.* FROM threads t ${clause} ORDER BY t.last_date_ms DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  const threads = rows.map((row) => ({
    threadId: row.thread_id,
    subject: row.subject,
    participants: JSON.parse(row.participants_json || '[]'),
    messageCount: row.message_count,
    unreadCount: row.unread_count,
    flagged: Boolean(row.flagged),
    hasAttachments: Boolean(row.has_attachments),
    lastDate: row.last_date,
    folders: JSON.parse(row.folders_json || '[]'),
    snippet: sanitizePreviewText(row.snippet ?? ''),
    // Stored as JSON by thread-summary.js; the API exposes just the text.
    summary: (() => {
      if (typeof row.summary !== 'string' || !row.summary) return null;
      try {
        return JSON.parse(row.summary)?.text ?? null;
      } catch {
        return row.summary;
      }
    })(),
  }));

  return { threads, total, offset, limit };
}

/**
 * @param {string} accountId
 * @param {string} compositeId — stable message id or `${folder}:${uid}`
 */
export async function getCachedMessage(accountId, compositeId) {
  const db = getMailDb(accountId);
  const row = findRow(db, compositeId, true);
  if (!row) return null;
  return hydrateAttachments(db, [row])[0];
}

/**
 * @param {string} accountId
 * @param {string} threadId
 */
export async function listCachedThread(accountId, threadId) {
  const db = getMailDb(accountId);
  const rows = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS_WITH_BODY} FROM messages m
       LEFT JOIN bodies b USING (message_row_id)
       WHERE m.thread_id = ? ORDER BY m.date_ms ASC`,
    )
    .all(String(threadId));
  return hydrateAttachments(db, rows);
}

/**
 * Update triage metadata on a cached message.
 * @param {string} accountId
 * @param {string} messageKey
 * @param {object} triage
 */
export async function updateMessageTriage(accountId, messageKey, triage) {
  const db = getMailDb(accountId);
  const rowId = findRowId(db, messageKey);
  if (rowId === null) {
    throw new Error('Cached message not found');
  }
  db.prepare('UPDATE messages SET triage_json = ? WHERE message_row_id = ?').run(
    JSON.stringify({ ...triage, cachedAt: nowIso() }),
    rowId,
  );
  return getCachedMessage(accountId, messageKey);
}

/**
 * Update IMAP flags on a cached message.
 * @param {string} accountId
 * @param {string} messageKey
 * @param {EmailMessageFlags} flags
 */
export async function updateMessageFlags(accountId, messageKey, flags) {
  const db = getMailDb(accountId);
  const row = findRow(db, messageKey);
  if (!row) {
    throw new Error('Cached message not found');
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE messages SET seen = ?, flagged = ?, answered = ? WHERE message_row_id = ?').run(
      flags.seen ? 1 : 0,
      flags.flagged ? 1 : 0,
      flags.answered ? 1 : 0,
      row.message_row_id,
    );
    recomputeThread(db, row.thread_id);
  });
  tx();
  return getCachedMessage(accountId, messageKey);
}

/**
 * Move a cached message to another folder. The stable `id` is deliberately
 * left alone so triage/variants/dashboard references survive the move (D4).
 * @param {string} accountId
 * @param {string} messageKey
 * @param {string} destFolder
 * @param {string} newUid
 */
export async function updateMessageFolder(accountId, messageKey, destFolder, newUid) {
  const db = getMailDb(accountId);
  const row = findRow(db, messageKey);
  if (!row) {
    throw new Error('Cached message not found');
  }
  const tx = db.transaction(() => {
    // A stale row already sitting at the destination uid would break UNIQUE.
    db.prepare('DELETE FROM messages WHERE folder = ? AND uid = ? AND message_row_id != ?').run(
      destFolder,
      String(newUid),
      row.message_row_id,
    );
    db.prepare('UPDATE messages SET folder = ?, uid = ? WHERE message_row_id = ?').run(
      destFolder,
      String(newUid),
      row.message_row_id,
    );
    recomputeThread(db, row.thread_id);
  });
  tx();
  return getCachedMessage(accountId, messageKey);
}

/**
 * Remove a message from the store after a permanent delete.
 * @param {string} accountId
 * @param {string} messageKey
 */
export async function removeMessageFromCache(accountId, messageKey) {
  const db = getMailDb(accountId);
  const row = findRow(db, messageKey);
  if (!row) {
    throw new Error('Cached message not found');
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM messages_fts WHERE message_row_id = ?').run(row.message_row_id);
    db.prepare('DELETE FROM messages WHERE message_row_id = ?').run(row.message_row_id);
    recomputeThread(db, row.thread_id);
  });
  tx();
  return { removed: true };
}

/**
 * Store reply variant drafts on a message.
 * @param {string} accountId
 * @param {string} messageKey
 * @param {Array<{ id: string, label: string, body: string, createdAt: string }>} variants
 */
export async function updateReplyVariants(accountId, messageKey, variants) {
  const db = getMailDb(accountId);
  const rowId = findRowId(db, messageKey);
  if (rowId === null) {
    throw new Error('Cached message not found');
  }
  db.prepare('UPDATE messages SET reply_variants_json = ? WHERE message_row_id = ?').run(
    JSON.stringify(variants ?? []),
    rowId,
  );
  return getCachedMessage(accountId, messageKey);
}

/**
 * Persist inbox dashboard summary for an account.
 * @param {string} accountId
 * @param {Record<string, unknown>} summary
 */
export async function updateInboxSummary(accountId, summary) {
  writeMeta(getMailDb(accountId), 'inboxSummary', summary);
  return summary;
}

/**
 * Read stored inbox summary (if any).
 * @param {string} accountId
 */
export async function getInboxSummary(accountId) {
  return readMeta(getMailDb(accountId), 'inboxSummary', null);
}

/**
 * Count unread messages per folder.
 * @param {string} accountId
 */
export async function getFolderUnreadCounts(accountId) {
  const db = getMailDb(accountId);
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of db
    .prepare('SELECT folder, COUNT(*) AS n FROM messages WHERE seen = 0 GROUP BY folder')
    .all()) {
    counts[row.folder] = row.n;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Snooze
// ---------------------------------------------------------------------------

/**
 * Hide a message until a point in time.
 *
 * Snoozing is local: the message stays exactly where it is on the server, so
 * another client still shows it and nothing is lost if the snooze is forgotten.
 * Passing an empty `until` un-snoozes.
 *
 * @param {string} accountId
 * @param {string} messageKey
 * @param {string} until — ISO timestamp, or '' to clear
 */
export async function setMessageSnooze(accountId, messageKey, until) {
  const db = getMailDb(accountId);
  const row = findRow(db, messageKey);
  if (!row) {
    throw new Error('Cached message not found');
  }

  const value = String(until ?? '').trim();
  if (value) {
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) {
      throw new Error('snooze until must be a valid ISO timestamp');
    }
    if (ms <= Date.now()) {
      throw new Error('snooze until must be in the future');
    }
  }

  db.prepare('UPDATE messages SET snooze_until = ? WHERE message_row_id = ?').run(
    value,
    row.message_row_id,
  );
  return getCachedMessage(accountId, messageKey);
}

/**
 * Messages whose snooze has elapsed — the poller wakes them and announces it.
 * @param {string} accountId
 * @param {string} [now]
 */
export async function listDueSnoozes(accountId, now = new Date().toISOString()) {
  const db = getMailDb(accountId);
  const rows = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
       WHERE snooze_until != '' AND snooze_until <= ?
       ORDER BY date_ms DESC`,
    )
    .all(String(now));
  return hydrateAttachments(db, rows);
}

/**
 * Clear the snooze on every message that is now due.
 * @param {string} accountId
 * @param {string} [now]
 */
export async function clearDueSnoozes(accountId, now = new Date().toISOString()) {
  const info = getMailDb(accountId)
    .prepare("UPDATE messages SET snooze_until = '' WHERE snooze_until != '' AND snooze_until <= ?")
    .run(String(now));
  return { woken: info.changes };
}

// ---------------------------------------------------------------------------
// Bodies (lazy fetch support)
// ---------------------------------------------------------------------------

/**
 * Read the cached body for a message, if one has been downloaded.
 * @param {string} accountId
 * @param {string} messageKey
 */
export async function getCachedBody(accountId, messageKey) {
  const db = getMailDb(accountId);
  const rowId = findRowId(db, messageKey);
  if (rowId === null) return null;
  const body = db.prepare('SELECT * FROM bodies WHERE message_row_id = ?').get(rowId);
  if (!body) return null;
  return {
    bodyText: body.body_text ?? '',
    bodyHtml: body.body_html ?? undefined,
    complete: Boolean(body.complete),
    fetchedAt: body.fetched_at,
  };
}

/**
 * Persist a downloaded body (and refresh the FTS entry so search sees it).
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ bodyText?: string, bodyHtml?: string, complete?: boolean, attachments?: Array<Record<string, unknown>>, bodyHash?: string }} body
 */
export async function saveCachedBody(accountId, messageKey, body) {
  const db = getMailDb(accountId);
  const row = findRow(db, messageKey);
  if (!row) {
    throw new Error('Cached message not found');
  }
  const tx = db.transaction(() => {
    saveBodyRow(db, row.message_row_id, body);
    if (typeof body.bodyHash === 'string' && body.bodyHash) {
      db.prepare('UPDATE messages SET body_hash = ? WHERE message_row_id = ?').run(
        body.bodyHash,
        row.message_row_id,
      );
    }
    if (Array.isArray(body.attachments)) {
      replaceAttachmentRows(db, row.message_row_id, body.attachments);
      // Inline images (a signature logo, say) must not make a message read as
      // "has attachments" — only real attachment dispositions count.
      const visible = body.attachments.filter((att) => !att?.inline).length;
      db.prepare('UPDATE messages SET has_attachments = ? WHERE message_row_id = ?').run(
        visible ? 1 : 0,
        row.message_row_id,
      );
    }
    reindexMessageFts(db, row.message_row_id);
  });
  tx();
  return getCachedMessage(accountId, messageKey);
}

// ---------------------------------------------------------------------------
// Sync state / folder cache
// ---------------------------------------------------------------------------

function setSyncStateRow(db, folder, patch) {
  const existing = db.prepare('SELECT * FROM sync_state WHERE folder = ?').get(folder);
  db.prepare(
    `INSERT INTO sync_state (
       folder, uid_validity, highest_uid, highest_modseq, lowest_uid, backfill_complete, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(folder) DO UPDATE SET
       uid_validity = excluded.uid_validity,
       highest_uid = excluded.highest_uid,
       highest_modseq = excluded.highest_modseq,
       lowest_uid = excluded.lowest_uid,
       backfill_complete = excluded.backfill_complete,
       updated_at = excluded.updated_at`,
  ).run(
    folder,
    patch.uidValidity !== undefined ? String(patch.uidValidity) : (existing?.uid_validity ?? ''),
    patch.highestUid !== undefined ? Number(patch.highestUid) || 0 : (existing?.highest_uid ?? 0),
    patch.highestModseq !== undefined ? String(patch.highestModseq) : (existing?.highest_modseq ?? ''),
    patch.lowestUid !== undefined ? Number(patch.lowestUid) || 0 : (existing?.lowest_uid ?? 0),
    patch.backfillComplete !== undefined
      ? patch.backfillComplete
        ? 1
        : 0
      : (existing?.backfill_complete ?? 0),
    nowIso(),
  );
}

/**
 * Per-folder sync cursor (uidvalidity / highest uid / modseq).
 * @param {string} accountId
 * @param {string} folder
 */
export async function getSyncState(accountId, folder) {
  const row = getMailDb(accountId).prepare('SELECT * FROM sync_state WHERE folder = ?').get(folder);
  return {
    folder,
    uidValidity: row?.uid_validity ?? '',
    highestUid: row?.highest_uid ?? 0,
    highestModseq: row?.highest_modseq ?? '',
    lowestUid: row?.lowest_uid ?? 0,
    backfillComplete: Boolean(row?.backfill_complete),
    updatedAt: row?.updated_at ?? '',
  };
}

/**
 * @param {string} accountId
 * @param {string} folder
 * @param {{
 *   uidValidity?: string | number,
 *   highestUid?: number,
 *   highestModseq?: string | number,
 *   lowestUid?: number,
 *   backfillComplete?: boolean,
 * }} patch
 */
export async function setSyncState(accountId, folder, patch) {
  setSyncStateRow(getMailDb(accountId), folder, patch ?? {});
  return getSyncState(accountId, folder);
}

/**
 * Lowest UID cached for a folder — used to resume a partial backfill.
 * @param {string} accountId
 * @param {string} folder
 */
export async function getMinCachedUid(accountId, folder) {
  const row = getMailDb(accountId)
    .prepare('SELECT MIN(CAST(uid AS INTEGER)) AS uid FROM messages WHERE folder = ?')
    .get(String(folder ?? ''));
  const uid = Number(row?.uid);
  return Number.isFinite(uid) ? uid : 0;
}

/**
 * Drop every cached message for a folder after a UIDVALIDITY reset.
 * @param {string} accountId
 * @param {string} folder
 */
export async function resetFolderCache(accountId, folder) {
  const db = getMailDb(accountId);
  const tx = db.transaction(() => {
    const rows = db.prepare('SELECT message_row_id, thread_id FROM messages WHERE folder = ?').all(folder);
    const delFts = db.prepare('DELETE FROM messages_fts WHERE message_row_id = ?');
    const delRow = db.prepare('DELETE FROM messages WHERE message_row_id = ?');
    for (const row of rows) {
      delFts.run(row.message_row_id);
      delRow.run(row.message_row_id);
    }
    for (const threadId of new Set(rows.map((row) => row.thread_id))) {
      recomputeThread(db, threadId);
    }
    setSyncStateRow(db, folder, { highestUid: 0, highestModseq: '', lowestUid: 0, backfillComplete: false });
  });
  tx();
  return { removed: true };
}

/**
 * Cached message count, optionally scoped to one folder.
 * @param {string} accountId
 * @param {string} [folder]
 */
export async function countCachedMessages(accountId, folder = '') {
  const db = getMailDb(accountId);
  return folder
    ? (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE folder = ?').get(folder)?.n ?? 0)
    : (db.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n ?? 0);
}

/**
 * Cached IMAP folder list (avoids a LIST round-trip per archive/move).
 * @param {string} accountId
 */
export async function getCachedFolders(accountId) {
  const entry = readMeta(getMailDb(accountId), 'folders', null);
  if (!entry || !Array.isArray(entry.folders)) return null;
  return entry;
}

/**
 * @param {string} accountId
 * @param {Array<{ path: string, name: string, specialUse?: string | null }>} folders
 */
export async function setCachedFolders(accountId, folders) {
  writeMeta(getMailDb(accountId), 'folders', { folders, fetchedAt: nowIso() });
  return folders;
}

/**
 * UIDs cached for a folder within the reconcile window (newest first).
 * @param {string} accountId
 * @param {string} folder
 * @param {number} limit
 */
export async function listCachedUids(accountId, folder, limit = 200) {
  return getMailDb(accountId)
    .prepare('SELECT uid FROM messages WHERE folder = ? ORDER BY date_ms DESC LIMIT ?')
    .all(folder, Math.max(1, Number(limit) || 200))
    .map((row) => Number(row.uid))
    .filter((uid) => Number.isFinite(uid));
}

/**
 * Apply a FLAGS-only reconcile pass: update flags for uids the server still
 * reports, delete cached rows the server no longer has (external move/delete).
 * @param {string} accountId
 * @param {string} folder
 * @param {Map<number, { seen: boolean, flagged: boolean, answered: boolean }>} serverFlags
 * @param {number[]} windowUids
 */
export async function reconcileFolderFlags(accountId, folder, serverFlags, windowUids) {
  const db = getMailDb(accountId);
  /** @type {{ updated: number, removed: number }} */
  const result = { updated: 0, removed: 0 };

  const tx = db.transaction(() => {
    const threadIds = new Set();
    for (const uid of windowUids) {
      const row = db
        .prepare('SELECT message_row_id, thread_id, seen, flagged, answered FROM messages WHERE folder = ? AND uid = ?')
        .get(folder, String(uid));
      if (!row) continue;

      const flags = serverFlags.get(uid);
      if (!flags) {
        db.prepare('DELETE FROM messages_fts WHERE message_row_id = ?').run(row.message_row_id);
        db.prepare('DELETE FROM messages WHERE message_row_id = ?').run(row.message_row_id);
        threadIds.add(row.thread_id);
        result.removed += 1;
        continue;
      }

      const next = [flags.seen ? 1 : 0, flags.flagged ? 1 : 0, flags.answered ? 1 : 0];
      if (next[0] !== row.seen || next[1] !== row.flagged || next[2] !== row.answered) {
        db.prepare('UPDATE messages SET seen = ?, flagged = ?, answered = ? WHERE message_row_id = ?').run(
          ...next,
          row.message_row_id,
        );
        threadIds.add(row.thread_id);
        result.updated += 1;
      }
    }
    for (const threadId of threadIds) {
      recomputeThread(db, threadId);
    }
  });
  tx();
  return result;
}
