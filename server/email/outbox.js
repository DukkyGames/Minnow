/**
 * Outbound queue with an undo window.
 *
 * Send used to be gated by a `confirmed: true` field on the request body, which
 * is not a capability check at all — anything that can reach the endpoint can
 * set it. The real gate is now structural: a send is parked for a few seconds
 * and anyone can cancel it during that window, so an unattended or unintended
 * send has to survive a period where the user can see and stop it. It also
 * replaces the `window.confirm` dialog with something less trained-away.
 *
 * The queue is in-memory: the window is seconds long, and durability would mean
 * persisting message bodies to disk. A send still in the window when the app
 * quits is dropped rather than delivered — the same tradeoff Gmail's undo makes.
 */

import { randomUUID } from 'node:crypto';
import { sendEmail } from './smtp.js';
import { consumeSendAllowance } from './send-rate-limit.js';
import { emitEmailEvent } from './events.js';
import { recordSentRecipients } from './contacts.js';
import { trackOutboundForFollowup } from './followups.js';

/** How long a queued send can be recalled. */
export const UNDO_WINDOW_MS = 8_000;

/**
 * Ceiling on a scheduled send. The queue is in-memory, so a send parked for
 * weeks would not survive a restart anyway — refusing it up front is honest,
 * where silently dropping it later would not be.
 */
export const MAX_SEND_LATER_MS = 30 * 24 * 60 * 60_000;

/** Effective window; only tests shorten it, so they don't sleep for real. */
let undoWindowMs = UNDO_WINDOW_MS;

/**
 * @typedef {object} OutboxEntry
 * @property {string} id
 * @property {string} accountId
 * @property {string} to
 * @property {string} subject
 * @property {'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'} status
 * @property {boolean} scheduled — true when `sendAt` came from send-later, not the undo window
 * @property {string} queuedAt
 * @property {string} sendAt
 * @property {string | null} error
 */

/** @type {Map<string, { entry: OutboxEntry, input: Record<string, unknown>, timer: NodeJS.Timeout }>} */
const queue = new Map();

/** Terminal entries linger briefly so the UI can render the outcome. */
const RETAIN_TERMINAL_MS = 60_000;

/**
 * @param {{ entry: OutboxEntry }} row
 * @returns {OutboxEntry}
 */
function publicEntry(row) {
  return { ...row.entry };
}

/**
 * Queue a send. Returns immediately; delivery happens after the undo window.
 * @param {Record<string, unknown>} input
 * @returns {OutboxEntry}
 */
export function enqueueSend(input) {
  const accountId = String(input.accountId ?? '').trim();
  const to = String(input.to ?? '').trim();
  const subject = String(input.subject ?? '').trim();
  if (!accountId) throw new Error('accountId is required');
  if (!to || !subject) throw new Error('to and subject are required');

  // Charge the allowance at queue time so a flood is refused up front rather
  // than after the user has been told each message is on its way.
  consumeSendAllowance(accountId);

  const now = Date.now();
  const id = randomUUID();

  // Send later: an explicit `sendAt` in the future replaces the undo window
  // (it is already a much longer window). Anything in the past falls back to
  // the normal undo delay rather than dispatching instantly.
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
  // Never hold the process open for a pending send.
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
      // The undo window is the confirmation; nothing reaches here without
      // having survived it.
      confirmed: true,
    });
    row.entry.status = 'sent';
    row.entry.error = null;

    // Writing to someone is the strongest affinity signal there is; feed it
    // back so autocomplete ranks them first next time.
    try {
      await recordSentRecipients(row.entry.accountId, [
        String(row.input.to ?? ''),
        String(row.input.cc ?? ''),
        String(row.input.bcc ?? ''),
      ]);
    } catch {
      /* a contact-book miss must never look like a send failure */
    }

    // Reply-expected classification (§3.4) — fails open inside the module.
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
 * Recall a send that is still inside its undo window.
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
 * @returns {OutboxEntry[]} newest first
 */
export function listOutbox() {
  return [...queue.values()]
    .map(publicEntry)
    .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime());
}

/** Drop every queued send and clear timers (tests). */
export function resetOutboxForTests() {
  for (const row of queue.values()) {
    clearTimeout(row.timer);
  }
  queue.clear();
  undoWindowMs = UNDO_WINDOW_MS;
}

/** Shorten the undo window so tests don't wait out the real one. */
export function setUndoWindowForTests(ms) {
  undoWindowMs = Number(ms) || UNDO_WINDOW_MS;
}

/** Current undo window, in ms. */
export function getUndoWindowMs() {
  return undoWindowMs;
}
