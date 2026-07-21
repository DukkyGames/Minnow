/**
 * Priority model v2 (spec §3.2).
 *
 * The score is a heuristic — urgency + category + sender affinity + deadline —
 * computed instantly at read time, never by the LLM, so it is explainable and
 * free. The LLM only supplies the inputs (urgency/category/deadline via triage).
 *
 * The feedback loop is `sender_overrides`: "wrong priority?" on a row pins a
 * sender (or their whole domain) always-high or always-low, applied after the
 * heuristic so user judgement always wins over model output.
 */

import { getMailDb } from './store.js';
import { splitAddressHeader } from './contacts.js';

/** Category contribution to the score. */
export const CATEGORY_WEIGHTS = {
  needs_reply: 30,
  security: 28,
  calendar: 18,
  fyi: 8,
  receipt: 4,
  notification: 3,
  newsletter: 0,
};

/** Urgency contribution to the score. */
export const URGENCY_WEIGHTS = { high: 40, normal: 20, low: 5 };

/** Score at or above this renders as a high-priority row. */
export const HIGH_PRIORITY_THRESHOLD = 60;
/** Score below this renders as low priority. */
export const LOW_PRIORITY_THRESHOLD = 25;

/**
 * Compute the heuristic priority score (0–100) for one message.
 *
 * @param {{
 *   urgency?: string,
 *   category?: string,
 *   deadline?: string,
 *   repliedCount?: number,
 *   override?: 'high' | 'low' | '' | null,
 *   nowMs?: number,
 * }} input
 * @returns {{ score: number, bucket: 'high' | 'normal' | 'low' }}
 */
export function computePriorityScore(input = {}) {
  const urgency = String(input.urgency ?? 'normal').toLowerCase();
  const category = String(input.category ?? 'fyi').toLowerCase();

  let score =
    (URGENCY_WEIGHTS[urgency] ?? URGENCY_WEIGHTS.normal) +
    (CATEGORY_WEIGHTS[category] ?? CATEGORY_WEIGHTS.fyi);

  // Sender affinity: people the user actually writes back to matter more.
  const repliedCount = Math.max(0, Number(input.repliedCount) || 0);
  score += Math.min(15, repliedCount * 3);

  // A concrete deadline raises priority; an imminent (or passed) one more so.
  const deadline = String(input.deadline ?? '').trim();
  if (deadline) {
    const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
    const deadlineMs = Date.parse(deadline);
    if (Number.isFinite(deadlineMs)) {
      const daysAway = (deadlineMs - nowMs) / 86_400_000;
      score += daysAway <= 3 ? 15 : 5;
    }
  }

  // User override wins over everything the model inferred.
  const override = String(input.override ?? '');
  if (override === 'high') {
    score = Math.max(score, 85);
  } else if (override === 'low') {
    score = Math.min(score, 10);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const bucket =
    score >= HIGH_PRIORITY_THRESHOLD ? 'high' : score >= LOW_PRIORITY_THRESHOLD ? 'normal' : 'low';
  return { score, bucket };
}

/**
 * Normalize a feedback target to a stored override key.
 * Accepts a raw header (`Name <addr>`), a bare address, or `@domain`.
 * @param {string} sender
 */
export function normalizeOverrideKey(sender) {
  const raw = String(sender ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('@')) return raw;
  const { address } = splitAddressHeader(raw);
  return address.includes('@') ? address : '';
}

/**
 * Set (or clear, with level '') a sender/domain priority override.
 * @param {string} accountId
 * @param {string} sender — address, raw header, or `@domain`
 * @param {'high' | 'low' | ''} level
 */
export async function setSenderOverride(accountId, sender, level) {
  const key = normalizeOverrideKey(sender);
  if (!key) {
    throw new Error('sender must be an email address or @domain');
  }
  const normalizedLevel = String(level ?? '').toLowerCase();
  if (!['high', 'low', ''].includes(normalizedLevel)) {
    throw new Error('level must be "high", "low", or "" to clear');
  }

  const db = getMailDb(accountId);
  if (!normalizedLevel) {
    db.prepare('DELETE FROM sender_overrides WHERE sender = ?').run(key);
    return { sender: key, level: '' };
  }
  db.prepare(
    `INSERT INTO sender_overrides (sender, level, created_at) VALUES (?, ?, ?)
     ON CONFLICT(sender) DO UPDATE SET level = excluded.level, created_at = excluded.created_at`,
  ).run(key, normalizedLevel, new Date().toISOString());
  return { sender: key, level: normalizedLevel };
}

/** @param {string} accountId */
export async function listSenderOverrides(accountId) {
  const db = getMailDb(accountId);
  return db
    .prepare('SELECT sender, level, created_at FROM sender_overrides ORDER BY created_at DESC')
    .all()
    .map((row) => ({ sender: row.sender, level: row.level, createdAt: row.created_at }));
}

/**
 * Resolve the override for one address: exact match first, then domain.
 * @param {Map<string, string>} overrides — sender → level
 * @param {string} address — lowercased bare address
 */
export function resolveOverride(overrides, address) {
  if (!address) return '';
  const exact = overrides.get(address);
  if (exact) return exact;
  const at = address.indexOf('@');
  if (at < 0) return '';
  return overrides.get(address.slice(at)) ?? '';
}

/**
 * Bulk-load the signals the score needs for a set of From headers:
 * replied counts from `contacts` and any `sender_overrides`.
 *
 * @param {string} accountId
 * @param {string[]} fromHeaders — raw `Name <addr>` header values
 * @returns {Promise<Map<string, { repliedCount: number, override: string }>>} keyed by raw header
 */
export async function loadSenderSignals(accountId, fromHeaders) {
  const db = getMailDb(accountId);

  /** @type {Map<string, string>} raw header → bare address */
  const addressByHeader = new Map();
  for (const header of fromHeaders) {
    const { address } = splitAddressHeader(String(header ?? ''));
    if (address.includes('@')) {
      addressByHeader.set(String(header), address);
    }
  }

  const addresses = [...new Set(addressByHeader.values())];
  /** @type {Map<string, number>} */
  const repliedByAddress = new Map();
  if (addresses.length) {
    const placeholders = addresses.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT address, replied_count FROM contacts WHERE address IN (${placeholders})`)
      .all(...addresses);
    for (const row of rows) {
      repliedByAddress.set(row.address, row.replied_count);
    }
  }

  /** @type {Map<string, string>} */
  const overrides = new Map();
  for (const row of db.prepare('SELECT sender, level FROM sender_overrides').all()) {
    overrides.set(row.sender, row.level);
  }

  /** @type {Map<string, { repliedCount: number, override: string }>} */
  const signals = new Map();
  for (const [header, address] of addressByHeader) {
    signals.set(header, {
      repliedCount: repliedByAddress.get(address) ?? 0,
      override: resolveOverride(overrides, address),
    });
  }
  return signals;
}
