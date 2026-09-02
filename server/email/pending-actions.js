/**
 * Agent action review queue (spec §3.7).
 *
 * Any AI-suggested multi-message mutation lands here as a `pending_actions`
 * row instead of executing: digest action groups, chat-agent batch
 * `email_action`, and (Phase 5) automation mail-ops. The dashboard renders the
 * queue as a review strip with Apply / Dismiss / Always-allow. Single-message
 * actions the user clicked themselves never pass through this queue.
 *
 * "Always allow" is scoped to a `source:action` pair (e.g. `digest:archive`)
 * so trusting newsletter cleanup does not also trust deletes — and `delete`
 * can never be auto-allowed at all.
 */

import { randomUUID } from 'node:crypto';
import { getMailDb, readMeta, writeMeta } from './store.js';
import { bulkMessageAction } from './mail-actions.js';
import { emitEmailEvent } from './events.js';

/** Drop overlapping digest Review chips after a digest-sourced resolve. */
async function scrubDigestChipsForPending(accountId, row) {
  if (row.source !== 'digest') return;
  const { removeDigestActionGroupsForMessages } = await import('./digest.js');
  await removeDigestActionGroupsForMessages(
    accountId,
    parseJson(row.message_ids_json, []),
  );
}


/** Actions a pending row may carry; anything else is refused at enqueue. */
export const PENDING_ACTIONS = ['archive', 'delete', 'read', 'unread', 'flag', 'unflag', 'move'];

/** Actions that may be auto-allowed. Deletion always requires a human click. */
export const AUTO_ALLOWABLE_ACTIONS = PENDING_ACTIONS.filter((action) => action !== 'delete');

/** Meta key holding the list of `source:action` pairs the user trusts. */
const AUTO_ALLOW_META_KEY = 'pending_auto_allow';

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** True when both arrays contain the same ids (order-insensitive). */
function sameMessageIdSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  const set = new Set(left.map(String));
  return right.every((id) => set.has(String(id)));
}

/** @param {Record<string, any>} row */
function rowToPendingAction(row) {
  return {
    id: row.id,
    source: row.source,
    label: row.label,
    action: row.action,
    messageIds: parseJson(row.message_ids_json, []),
    threadIds: parseJson(row.thread_ids_json, []),
    destFolder: row.dest_folder || '',
    state: row.state,
    detail: row.detail || '',
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || '',
  };
}

/** `source:action` pairs the user marked always-allow. */
export async function listAutoAllowRules(accountId) {
  const db = getMailDb(accountId);
  const rules = readMeta(db, AUTO_ALLOW_META_KEY, []);
  return Array.isArray(rules) ? rules.filter((rule) => typeof rule === 'string') : [];
}

/**
 * Add or remove an always-allow rule.
 * @param {string} accountId
 * @param {{ source: string, action: string, allow: boolean }} input
 */
export async function setAutoAllowRule(accountId, input) {
  const source = String(input.source ?? '').trim();
  const action = String(input.action ?? '').trim().toLowerCase();
  if (!source || !action) {
    throw new Error('source and action are required');
  }
  if (input.allow && !AUTO_ALLOWABLE_ACTIONS.includes(action)) {
    throw new Error(`"${action}" cannot be auto-allowed`);
  }

  const db = getMailDb(accountId);
  const key = `${source}:${action}`;
  const rules = new Set(await listAutoAllowRules(accountId));
  if (input.allow) {
    rules.add(key);
  } else {
    rules.delete(key);
  }
  writeMeta(db, AUTO_ALLOW_META_KEY, [...rules]);
  return [...rules];
}

/**
 * Queue an AI-suggested batch mutation for user review.
 *
 * If the user has always-allowed this `source:action`, the batch executes
 * immediately and the row records the outcome — the queue stays the single
 * audit trail either way.
 *
 * @param {string} accountId
 * @param {{ source: string, label: string, action: string, messageIds: string[], threadIds?: string[], destFolder?: string, detail?: string }} input
 */
export async function enqueuePendingAction(accountId, input) {
  const source = String(input.source ?? '').trim();
  const label = String(input.label ?? '').trim();
  const action = String(input.action ?? '').trim().toLowerCase();
  const messageIds = Array.isArray(input.messageIds)
    ? input.messageIds.map(String).filter(Boolean)
    : [];

  if (!source) throw new Error('source is required');
  if (!PENDING_ACTIONS.includes(action)) {
    throw new Error(`Unsupported pending action "${action}"`);
  }
  if (messageIds.length === 0) {
    throw new Error('messageIds is required');
  }
  if (action === 'move' && !String(input.destFolder ?? '').trim()) {
    throw new Error('destFolder is required for move');
  }

  const db = getMailDb(accountId);
  const destFolder = String(input.destFolder ?? '').trim();
  const openRows = db
    .prepare(
      "SELECT * FROM pending_actions WHERE state = 'pending' AND source = ? AND action = ? AND dest_folder = ?",
    )
    .all(source, action, destFolder);
  for (const open of openRows) {
    if (sameMessageIdSet(parseJson(open.message_ids_json, []), messageIds)) {
      return rowToPendingAction(open);
    }
  }

  const row = {
    id: randomUUID(),
    source,
    label: label || `${action} ${messageIds.length} messages`,
    action,
    message_ids_json: JSON.stringify(messageIds),
    thread_ids_json: JSON.stringify(
      Array.isArray(input.threadIds) ? input.threadIds.map(String).filter(Boolean) : [],
    ),
    dest_folder: destFolder,
    state: 'pending',
    detail: String(input.detail ?? ''),
    created_at: nowIso(),
    resolved_at: '',
  };

  db.prepare(
    `INSERT INTO pending_actions (
       id, source, label, action, message_ids_json, thread_ids_json,
       dest_folder, state, detail, created_at, resolved_at
     ) VALUES (
       @id, @source, @label, @action, @message_ids_json, @thread_ids_json,
       @dest_folder, @state, @detail, @created_at, @resolved_at
     )`,
  ).run(row);

  const autoAllowed = (await listAutoAllowRules(accountId)).includes(`${source}:${action}`);
  emitEmailEvent('pending_actions_updated', { accountId });

  if (autoAllowed) {
    return applyPendingAction(accountId, row.id);
  }
  return rowToPendingAction(row);
}

/**
 * @param {string} accountId
 * @param {{ state?: string, limit?: number }} [options]
 */
export async function listPendingActions(accountId, options = {}) {
  const db = getMailDb(accountId);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 25));
  const state = String(options.state ?? 'pending').trim();

  const rows = state
    ? db
        .prepare(
          'SELECT * FROM pending_actions WHERE state = ? ORDER BY created_at DESC LIMIT ?',
        )
        .all(state, limit)
    : db.prepare('SELECT * FROM pending_actions ORDER BY created_at DESC LIMIT ?').all(limit);

  return rows.map(rowToPendingAction);
}

/**
 * Execute a reviewed batch through the existing bulk pipeline.
 * @param {string} accountId
 * @param {string} id
 */
export async function applyPendingAction(accountId, id) {
  const db = getMailDb(accountId);
  const row = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(String(id ?? ''));
  if (!row) {
    throw new Error('Pending action not found');
  }
  if (row.state !== 'pending') {
    throw new Error(`Pending action is already ${row.state}`);
  }

  const messageIds = parseJson(row.message_ids_json, []);
  let state = 'applied';
  let detail = row.detail || '';
  try {
    const result = await bulkMessageAction(accountId, {
      ids: messageIds,
      action: row.action,
      destFolder: row.dest_folder || undefined,
    });
    if (result.failed > 0) {
      state = 'failed';
      detail = `${result.failed} of ${messageIds.length} failed`;
    }
  } catch (err) {
    state = 'failed';
    detail = err instanceof Error ? err.message : 'Apply failed';
  }

  db.prepare(
    'UPDATE pending_actions SET state = ?, detail = ?, resolved_at = ? WHERE id = ?',
  ).run(state, detail, nowIso(), row.id);
  emitEmailEvent('pending_actions_updated', { accountId });
  await scrubDigestChipsForPending(accountId, row);

  const updated = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(row.id);
  return rowToPendingAction(updated);
}

/**
 * @param {string} accountId
 * @param {string} id
 */
export async function dismissPendingAction(accountId, id) {
  const db = getMailDb(accountId);
  const row = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(String(id ?? ''));
  if (!row) {
    throw new Error('Pending action not found');
  }
  if (row.state !== 'pending') {
    throw new Error(`Pending action is already ${row.state}`);
  }

  db.prepare(
    "UPDATE pending_actions SET state = 'dismissed', resolved_at = ? WHERE id = ?",
  ).run(nowIso(), row.id);
  emitEmailEvent('pending_actions_updated', { accountId });
  await scrubDigestChipsForPending(accountId, row);

  const updated = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(row.id);
  return rowToPendingAction(updated);
}
