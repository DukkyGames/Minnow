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

export const POLL_TICK_MS = 60_000;

export const IDLE_DEBOUNCE_MS = 2_000;

export const SYNC_BATCH = 200;

export const BACKFILL_PASS_DELAY_MS = 350;

const MAX_BACKFILL_PASSES = 5_000;

/** @type {Map<string, number>} */
const lastPolledAt = new Map();

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
 * @param {string} accountId
 * @param {string} folder
 * @param {{ background?: boolean, limit?: number, full?: boolean, untilComplete?: boolean, onProgress?: (detail: Record<string, unknown>) => void, }} [options]
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
      woken += await wakeDueSnoozes(account.id);

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
 * @param {string} accountId
 * @returns {Promise<number>}
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

export async function startIdleWatchersForEnabledAccounts() {
  const accounts = await listEmailAccounts();
  for (const account of accounts) {
    if (account.pollingEnabled) {
      await ensureIdleWatcher(account.id);
    }
  }
}

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

export function startEmailPollLoop() {
  if (pollTimer) {
    return;
  }
  void startIdleWatchersForEnabledAccounts().catch(() => {});
  pollTimer = setInterval(() => {
    void runEmailPollTick().catch((err) => {
      console.warn('[email] poll tick failed:', err instanceof Error ? err.message : err);
    });
  }, POLL_TICK_MS);
  pollTimer.unref?.();
}

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

export function resetEmailPollForTests() {
  stopEmailPollLoop();
  lastPolledAt.clear();
  backfillDrivers.clear();
  polling = false;
}
