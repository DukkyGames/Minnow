import { getMailDb } from './store.js';

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {string} header
 */
export function splitAddressHeader(header) {
  const raw = String(header ?? '').trim();
  const angled = /^(.*?)<([^>]+)>\s*$/.exec(raw);
  if (angled) {
    return {
      name: angled[1].trim().replace(/^["']|["']$/g, ''),
      address: angled[2].trim().toLowerCase(),
    };
  }
  return { name: '', address: raw.toLowerCase() };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} header
 * @param {{ replied?: boolean }} [options]
 */
export function recordContact(db, header, options = {}) {
  const { name, address } = splitAddressHeader(header);
  if (!address || !address.includes('@')) {
    return;
  }

  const seenDelta = options.replied ? 0 : 1;
  const repliedDelta = options.replied ? 1 : 0;

  db.prepare(
    `INSERT INTO contacts (address, name, seen_count, replied_count, last_seen_at)
     VALUES (@address, @name, @seen, @replied, @now)
     ON CONFLICT(address) DO UPDATE SET
       -- Keep the first real name we learned rather than letting a later
       -- bare-address sighting blank it out.
       name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
       seen_count = contacts.seen_count + @seen,
       replied_count = contacts.replied_count + @replied,
       last_seen_at = @now`,
  ).run({ address, name, seen: seenDelta, replied: repliedDelta, now: nowIso() });
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} message
 */
export function harvestMessageContacts(db, message) {
  recordContact(db, String(message.from ?? ''));
  const recipients = Array.isArray(message.to) ? message.to : [];
  for (const entry of recipients) {
    recordContact(db, String(entry ?? ''));
  }
}

/**
 * @param {string} accountId
 * @param {string[]} headers
 */
export async function recordSentRecipients(accountId, headers) {
  const db = getMailDb(accountId);
  const entries = headers
    .flatMap((header) => String(header ?? '').split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) return { recorded: 0 };

  const tx = db.transaction(() => {
    for (const entry of entries) {
      recordContact(db, entry, { replied: true });
    }
  });
  tx();
  return { recorded: entries.length };
}

/**
 * @param {string} accountId
 * @param {{ query?: string, limit?: number }} [options]
 */
export async function searchContacts(accountId, options = {}) {
  const db = getMailDb(accountId);
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 10));
  const query = String(options.query ?? '').trim().toLowerCase();

  const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

  const rows = query
    ? db
        .prepare(
          `SELECT address, name, seen_count, replied_count, last_seen_at
           FROM contacts
           WHERE address LIKE @pattern ESCAPE '\\' OR lower(name) LIKE @pattern ESCAPE '\\'
           ORDER BY replied_count DESC, seen_count DESC, last_seen_at DESC
           LIMIT @limit`,
        )
        .all({ pattern, limit })
    : db
        .prepare(
          `SELECT address, name, seen_count, replied_count, last_seen_at
           FROM contacts
           ORDER BY replied_count DESC, seen_count DESC, last_seen_at DESC
           LIMIT ?`,
        )
        .all(limit);

  return rows.map((row) => ({
    address: row.address,
    name: row.name ?? '',
    header: row.name ? `${row.name} <${row.address}>` : row.address,
    seenCount: row.seen_count,
    repliedCount: row.replied_count,
    lastSeenAt: row.last_seen_at,
  }));
}
