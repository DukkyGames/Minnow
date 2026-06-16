/**
 * Opt-in background email polling with agent hooks on new mail.
 */

import { listEmailAccounts, getEmailAccount } from './accounts.js';
import { readMessageCache } from './cache.js';
import { syncFolderMessages } from './transport.js';
import { onNewMessages, buildInboxSummary } from './agent.js';
import { emitEmailEvent } from './events.js';

/** Minimum interval between poll ticks. */
export const POLL_TICK_MS = 60_000;

/** @type {Map<string, number>} */
const lastPolledAt = new Map();

/** @type {NodeJS.Timeout | null} */
let pollTimer = null;

let polling = false;

/**
 * Poll all accounts with pollingEnabled.
 */
export async function runEmailPollTick() {
  if (polling) {
    return { skipped: 'poll_in_progress' };
  }

  polling = true;
  let synced = 0;
  try {
    const accounts = await listEmailAccounts();
    const now = Date.now();

    for (const account of accounts) {
      if (!account.pollingEnabled) {
        continue;
      }

      const intervalMs = Math.max(5, account.pollingIntervalMinutes ?? 15) * 60_000;
      const last = lastPolledAt.get(account.id) ?? 0;
      if (now - last < intervalMs) {
        continue;
      }

      for (const folder of account.folders ?? ['INBOX']) {
        try {
          const before = await readMessageCache(account.id);
          const prevHighest = before.folderCursors?.[folder]?.highestUid ?? 0;

          const result = await syncFolderMessages(account.id, { folder, limit: 50 });
          synced += 1;

          const incoming = Array.isArray(result.messages) ? result.messages : [];
          const newRows = incoming.filter((row) => Number(row.uid) > prevHighest);
          if (newRows.length > 0) {
            const fullAccount = (await getEmailAccount(account.id)) ?? account;
            await onNewMessages(account.id, newRows, fullAccount);
          } else {
            await buildInboxSummary(account.id);
            emitEmailEvent('summary_updated', { accountId: account.id });
          }
        } catch (err) {
          console.warn(
            `[email] poll failed for ${account.id}/${folder}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      lastPolledAt.set(account.id, now);
    }
  } finally {
    polling = false;
  }

  return { synced };
}

/**
 * Start the email poll loop after server bootstrap.
 */
export function startEmailPollLoop() {
  if (pollTimer) {
    return;
  }
  pollTimer = setInterval(() => {
    void runEmailPollTick().catch((err) => {
      console.warn('[email] poll tick failed:', err instanceof Error ? err.message : err);
    });
  }, POLL_TICK_MS);
}

/** Stop polling (shutdown). */
export function stopEmailPollLoop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Reset poll state (tests). */
export function resetEmailPollForTests() {
  stopEmailPollLoop();
  lastPolledAt.clear();
  polling = false;
}
