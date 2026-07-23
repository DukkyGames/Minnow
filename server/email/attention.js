/**
 * "Needs attention" dismissals — hide triaged highlights the user has cleared.
 *
 * Dismissals are keyed by cached message id so a new message in the same
 * thread can surface again on the next triage pass.
 */

import { buildInboxSummary } from './agent.js';
import { getMailDb } from './store.js';

/**
 * @param {string} accountId
 * @returns {Set<string>}
 */
export function loadDismissedMessageIds(accountId) {
  const db = getMailDb(accountId);
  const rows = db.prepare('SELECT message_id FROM attention_dismissals').all();
  return new Set(rows.map((row) => String(row.message_id)));
}

/**
 * Dismiss one highlight from the attention queue and rebuild the summary.
 * @param {string} accountId
 * @param {string} messageId — cached message key (`INBOX:uid`, etc.)
 */
export async function dismissAttentionHighlight(accountId, messageId) {
  const key = String(messageId ?? '').trim();
  if (!key) {
    throw new Error('messageId is required');
  }

  const db = getMailDb(accountId);
  db.prepare(
    `INSERT INTO attention_dismissals (message_id, dismissed_at) VALUES (?, ?)
     ON CONFLICT(message_id) DO UPDATE SET dismissed_at = excluded.dismissed_at`,
  ).run(key, new Date().toISOString());

  await buildInboxSummary(accountId);
  return { messageId: key, dismissed: true };
}
