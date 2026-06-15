/**
 * Opt-in background email polling per account.
 */

import { listEmailAccounts } from './accounts.js';
import { syncFolderMessages } from './imap.js';

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
          await syncFolderMessages(account.id, { folder, limit: 50 });
          synced += 1;
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
