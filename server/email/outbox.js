import { randomUUID } from 'node:crypto';
import { sendEmail } from './smtp.js';
import { consumeSendAllowance } from './send-rate-limit.js';
import { emitEmailEvent } from './events.js';
import { recordSentRecipients } from './contacts.js';
import { trackOutboundForFollowup } from './followups.js';

export const UNDO_WINDOW_MS = 8_000;

export const MAX_SEND_LATER_MS = 30 * 24 * 60 * 60_000;

let undoWindowMs = UNDO_WINDOW_MS;

/**
 * @typedef {object} OutboxEntry
 * @property {string} id
 * @property {string} accountId
 * @property {string} to
 * @property {string} subject
 * @property {'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'} status
 * @property {boolean} scheduled
 * @property {string} queuedAt
 * @property {string} sendAt
 * @property {string | null} error
 */

/** @type {Map<string, { entry: OutboxEntry, input: Record<string, unknown>, timer: NodeJS.Timeout }>} */
const queue = new Map();

const RETAIN_TERMINAL_MS = 60_000;

/**
 * @param {{ entry: OutboxEntry }} row
 * @returns {OutboxEntry}
 */
function publicEntry(row) {
  return { ...row.entry };
}

/**
 * @param {Record<string, unknown>} input
 * @returns {OutboxEntry}
 */
export function enqueueSend(input) {
  const accountId = String(input.accountId ?? '').trim();
  const to = String(input.to ?? '').trim();
  const subject = String(input.subject ?? '').trim();
  if (!accountId) throw new Error('accountId is required');
  if (!to || !subject) throw new Error('to and subject are required');

  consumeSendAllowance(accountId);

  const now = Date.now();
  const id = randomUUID();

  const requestedAt = input.sendAt ? new Date(String(input.sendAt)).getTime() : NaN;
  const scheduled = Number.isFinite(requestedAt) && requestedAt > now + undoWindowMs;
  const delay = scheduled ? requestedAt - now : undoWindowMs;

  if (scheduled && delay > MAX_SEND_LATER_MS) {
    throw new Error('Scheduled sends are limited to 30 days out');
  }

  /** @type {OutboxEntry} */
  const entry = {
    id,
    accountId,
    to,
    subject,
    status: 'queued',
    scheduled,
    queuedAt: new Date(now).toISOString(),
    sendAt: new Date(now + delay).toISOString(),
    error: null,
  };

  const timer = setTimeout(() => {
    void deliver(id);
  }, delay);
  timer.unref?.();

  queue.set(id, { entry, input: { ...input, accountId, to, subject }, timer });
  emitEmailEvent('outbox_queued', { entry: { ...entry } });
  return { ...entry };
}

/**
 * @param {string} id
 */
async function deliver(id) {
  const row = queue.get(id);
  if (!row || row.entry.status !== 'queued') {
    return;
  }

  row.entry.status = 'sending';
  emitEmailEvent('outbox_sending', { entry: { ...row.entry } });

  try {
    const result = await sendEmail({
      .../** @type {any} */ (row.input),
      confirmed: true,
    });
    row.entry.status = 'sent';
    row.entry.error = null;

    try {
      await recordSentRecipients(row.entry.accountId, [
        String(row.input.to ?? ''),
        String(row.input.cc ?? ''),
        String(row.input.bcc ?? ''),
      ]);
    } catch {
    }

    await trackOutboundForFollowup(row.entry.accountId, row.input, result);

    emitEmailEvent('outbox_sent', { entry: { ...row.entry }, messageId: result.messageId ?? null });
  } catch (err) {
    row.entry.status = 'failed';
    row.entry.error = err instanceof Error ? err.message : 'Send failed';
    emitEmailEvent('outbox_failed', { entry: { ...row.entry } });
  }

  const sweep = setTimeout(() => queue.delete(id), RETAIN_TERMINAL_MS);
  sweep.unref?.();
}

/**
 * @param {string} id
 * @returns {OutboxEntry}
 */
export function cancelSend(id) {
  const row = queue.get(String(id ?? ''));
  if (!row) {
    throw new Error('Outbox entry not found');
  }
  if (row.entry.status !== 'queued') {
    throw new Error(`Cannot cancel a message that is already ${row.entry.status}`);
  }

  clearTimeout(row.timer);
  row.entry.status = 'cancelled';
  emitEmailEvent('outbox_cancelled', { entry: { ...row.entry } });

  const sweep = setTimeout(() => queue.delete(row.entry.id), RETAIN_TERMINAL_MS);
  sweep.unref?.();
  return { ...row.entry };
}

/**
 * @returns {OutboxEntry[]}
 */
export function listOutbox() {
  return [...queue.values()]
    .map(publicEntry)
    .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime());
}

export function resetOutboxForTests() {
  for (const row of queue.values()) {
    clearTimeout(row.timer);
  }
  queue.clear();
  undoWindowMs = UNDO_WINDOW_MS;
}

export function setUndoWindowForTests(ms) {
  undoWindowMs = Number(ms) || UNDO_WINDOW_MS;
}

export function getUndoWindowMs() {
  return undoWindowMs;
}
