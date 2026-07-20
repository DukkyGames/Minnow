/**
 * Contact harvesting and autocomplete.
 *
 * Addresses are learned from mail that already passed through the store, so the
 * suggestion list needs no address book, no sync, and no network access — and
 * it never leaves the machine. `seen_count` tracks how often an address appears
 * in received mail; `replied_count` tracks how often the user actually wrote to
 * it, which is the far stronger signal and dominates the ranking.
 */

import { getMailDb } from './store.js';

function nowIso() {
  return new Date().toISOString();
}

/**
 * Pull the display name out of a `Name <addr>` header, if there is one.
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
 * Record one address sighting. Runs inside the caller's transaction.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} header — a raw `Name <addr>` header value
 * @param {{ replied?: boolean }} [options]
 */
export function recordContact(db, header, options = {}) {
  const { name, address } = splitAddressHeader(header);
  // A missing `@` means this was never an address (an empty header, a mangled
  // group syntax); storing it would only pollute the suggestions.
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
 * Harvest every address on one parsed message.
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
 * Record that the user addressed these recipients — the strongest affinity
 * signal available, since it is an action rather than an arrival.
 *
 * @param {string} accountId
 * @param {string[]} headers — raw To/Cc/Bcc header values
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
 * Autocomplete over harvested addresses.
 *
 * Ranking puts people the user has written to first, then frequently-seen
 * senders, then recency — so the top suggestion for a two-letter prefix is
 * usually the person actually meant.
 *
 * @param {string} accountId
 * @param {{ query?: string, limit?: number }} [options]
 */
export async function searchContacts(accountId, options = {}) {
  const db = getMailDb(accountId);
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 10));
  const query = String(options.query ?? '').trim().toLowerCase();

  // LIKE with an escaped pattern: a user typing `%` must not match everything.
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
    // What the compose field should insert.
    header: row.name ? `${row.name} <${row.address}>` : row.address,
    seenCount: row.seen_count,
    repliedCount: row.replied_count,
    lastSeenAt: row.last_seen_at,
  }));
}
