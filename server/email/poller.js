/**
 * Background email sync — IMAP IDLE push with an interval poller as fallback.
 *
 * IDLE carries the real-time load (new mail lands within seconds); the poller
 * stays because some servers advertise IDLE and then never notify.
 */

import { listEmailAccounts } from './accounts.js';
import { clearDueSnoozes, getSyncState, listDueSnoozes } from './cache.js';
import { sweepOverdueFollowups } from './followups.js';
import { syncFolderMessages } from './transport.js';
import { runAgentHooksAfterFolderSync } from './agent.js';
import { emitEmailEvent } from './events.js';
import {
  closeAllImapSessions,
  startIdleWatcher,
  stopAllIdleWatchers,
  stopIdleWatcher,
} from './imap-session.js';

/** Minimum interval between poll ticks. */
export const POLL_TICK_MS = 60_000;

/** Debounce window for IDLE-triggered syncs (servers fire bursts). */
export const IDLE_DEBOUNCE_MS = 2_000;

/**
 * Page size for one sync batch. Kept modest so a single pass never holds the
 * shared IMAP connection long enough to stall an open-message request.
 */
export const SYNC_BATCH = 200;

/** Pause between background backfill passes so foreground IMAP work interleaves. */
export const BACKFILL_PASS_DELAY_MS = 350;

/** Safety cap on backfill passes (each fetches up to SYNC_BATCH real UIDs). */
const MAX_BACKFILL_PASSES = 5_000;

/** @type {Map<string, number>} */
const lastPolledAt = new Map();

/** Folders with a live backfill driver, so we never run two at once. */
/** @type {Set<string>} */
const backfillDrivers = new Set();

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** @type {NodeJS.Timeout | null} */
let pollTimer = null;

let polling = false;

/** @type {Map<string, NodeJS.Timeout>} */
const idleDebounce = new Map();

/**
 * Sync one folder and run the agent hooks for genuinely new mail.
 *
 * This performs a single batch (new mail + one backfill page) and returns
 * promptly. When `untilComplete` is set and the folder is not yet fully
 * backfilled, it kicks off a paced background driver to finish the history
 * without blocking the caller or monopolizing the shared IMAP connection.
 *
 * @param {string} accountId
 * @param {string} folder
 * @param {{
 *   background?: boolean,
 *   limit?: number,
 *   full?: boolean,
 *   untilComplete?: boolean,
 *   onProgress?: (detail: Record<string, unknown>) => void,
 * }} [options]
 */
export async function syncFolderWithHooks(accountId, folder, options = {}) {
  const before = await getSyncState(accountId, folder);
  const result = await syncFolderMessages(accountId, {
    folder,
    limit: options.limit ?? SYNC_BATCH,
    full: options.full === true,
    onProgress: options.onProgress,
  });
  const incoming = Array.isArray(result.messages) ? result.messages : [];
  await runAgentHooksAfterFolderSync(accountId, folder, incoming, before.highestUid, {
    background: options.background === true,
  });
  if (options.untilComplete === true && !result.backfillComplete) {
    ensureBackfill(accountId, folder);
  }
  return result;
}

/**
 * Drive a folder's history backfill to completion in the background, one paced
 * batch at a time. Idempotent — a second call while a driver is live is a no-op.
 * Runs detached so the connection is released (and yielded to foreground work)
 * between passes.
 *
 * @param {string} accountId
 * @param {string} folder
 */
export function ensureBackfill(accountId, folder) {
  const key = `${accountId}\0${folder}`;
  if (backfillDrivers.has(key)) {
    return;
  }
  backfillDrivers.add(key);
  void (async () => {
    try {
      for (let pass = 0; pass < MAX_BACKFILL_PASSES; pass += 1) {
        const result = await syncFolderWithHooks(accountId, folder, {
          background: true,
          limit: SYNC_BATCH,
        });
        if (result.backfillComplete) {
          break;
        }
        await delay(BACKFILL_PASS_DELAY_MS);
      }
    } catch (err) {
      console.warn(
        `[email] backfill failed for ${accountId}/${folder}:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      backfillDrivers.delete(key);
    }
  })();
}

/**
 * Poll all accounts with pollingEnabled.
 */
export async function runEmailPollTick() {
  if (polling) {
    return { skipped: 'poll_in_progress' };
  }

  polling = true;
  let synced = 0;
  let woken = 0;
  try {
    const accounts = await listEmailAccounts();
    const now = Date.now();

    for (const account of accounts) {
      // Snoozes are checked for every account, polling-enabled or not: the user
      // asked for the message back at a time, and that promise does not depend
      // on whether background sync happens to be on.
      woken += await wakeDueSnoozes(account.id);

      // Same reasoning for overdue follow-ups — the nudge was promised at send
      // time, not conditioned on background sync being enabled.
      await sweepOverdueFollowups(account.id).catch((err) => {
        console.warn(
          `[email] follow-up sweep failed for ${account.id}:`,
          err instanceof Error ? err.message : err,
        );
      });

      if (!account.pollingEnabled) {
        await stopIdleWatcher(account.id).catch(() => {});
        continue;
      }

      await ensureIdleWatcher(account.id);

      const intervalMs = Math.max(5, account.pollingIntervalMinutes ?? 15) * 60_000;
      const last = lastPolledAt.get(account.id) ?? 0;
      if (now - last < intervalMs) {
        continue;
      }

      for (const folder of account.folders ?? ['INBOX']) {
        try {
          await syncFolderWithHooks(account.id, folder, { background: true });
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

  return { synced, woken };
}

/**
 * Resurface any message whose snooze has elapsed.
 *
 * Announced as an event so an open list can bring the row back without the
 * user having to refresh — a snooze that silently expires is a broken promise.
 *
 * @param {string} accountId
 * @returns {Promise<number>} how many messages woke
 */
async function wakeDueSnoozes(accountId) {
  try {
    const due = await listDueSnoozes(accountId);
    if (!due.length) return 0;

    await clearDueSnoozes(accountId);
    emitEmailEvent('snooze_due', {
      accountId,
      messages: due.map((message) => ({
        id: message.id,
        threadId: message.threadId,
        subject: message.subject,
        from: message.from,
      })),
    });
    return due.length;
  } catch (err) {
    console.warn(
      `[email] snooze sweep failed for ${accountId}:`,
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

/**
 * Start an INBOX IDLE watcher for an account (no-op if already watching or if
 * the server refuses the connection — the poller still covers that account).
 * @param {string} accountId
 */
export async function ensureIdleWatcher(accountId) {
  try {
    await startIdleWatcher(accountId, ({ folder }) => {
      scheduleIdleSync(accountId, folder);
    });
    return { watching: true };
  } catch (err) {
    console.warn(
      `[email] IDLE unavailable for ${accountId} (falling back to polling):`,
      err instanceof Error ? err.message : err,
    );
    return { watching: false };
  }
}

/** Open IDLE watchers for every polling-enabled account. */
export async function startIdleWatchersForEnabledAccounts() {
  const accounts = await listEmailAccounts();
  for (const account of accounts) {
    if (account.pollingEnabled) {
      await ensureIdleWatcher(account.id);
    }
  }
}

/** Coalesce an IDLE burst into a single sync pass. */
function scheduleIdleSync(accountId, folder) {
  const key = `${accountId}\0${folder}`;
  const pending = idleDebounce.get(key);
  if (pending) {
    clearTimeout(pending);
  }
  const timer = setTimeout(() => {
    idleDebounce.delete(key);
    void syncFolderWithHooks(accountId, folder, { background: true }).catch((err) => {
      console.warn(
        `[email] IDLE sync failed for ${accountId}/${folder}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }, IDLE_DEBOUNCE_MS);
  timer.unref?.();
  idleDebounce.set(key, timer);
}

/**
 * Start the email poll loop after server bootstrap.
 */
export function startEmailPollLoop() {
  if (pollTimer) {
    return;
  }
  // Bring IDLE up at boot rather than waiting a full tick for push to start.
  void startIdleWatchersForEnabledAccounts().catch(() => {});
  pollTimer = setInterval(() => {
    void runEmailPollTick().catch((err) => {
      console.warn('[email] poll tick failed:', err instanceof Error ? err.message : err);
    });
  }, POLL_TICK_MS);
  pollTimer.unref?.();
}

/** Stop polling and IDLE watchers (shutdown). */
export function stopEmailPollLoop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  for (const timer of idleDebounce.values()) {
    clearTimeout(timer);
  }
  idleDebounce.clear();
  void stopAllIdleWatchers().catch(() => {});
  void closeAllImapSessions().catch(() => {});
}

/** Reset poll state (tests). */
export function resetEmailPollForTests() {
  stopEmailPollLoop();
  lastPolledAt.clear();
  backfillDrivers.clear();
  polling = false;
}
