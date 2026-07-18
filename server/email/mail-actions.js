/**
 * Mail mutation router — IMAP flag, move, archive, and delete actions.
 */

import {
  archiveImapMessage,
  deleteImapMessage,
  moveImapMessage,
  setImapMessageFlags,
  setImapMessageFlagsBulk,
} from './imap-actions.js';

/** Bulk actions that collapse to one STORE per folder. */
const BULK_FLAG_ACTIONS = {
  read: { seen: true },
  unread: { seen: false },
  flag: { flagged: true },
  unflag: { flagged: false },
};

/**
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ seen?: boolean, flagged?: boolean }} flags
 */
export async function setMessageFlags(accountId, messageKey, flags) {
  return setImapMessageFlags(accountId, messageKey, flags);
}

/**
 * @param {string} accountId
 * @param {string} messageKey
 * @param {string} destFolder
 */
export async function moveMessage(accountId, messageKey, destFolder) {
  return moveImapMessage(accountId, messageKey, destFolder);
}

/**
 * @param {string} accountId
 * @param {string} messageKey
 */
export async function archiveMessage(accountId, messageKey) {
  return archiveImapMessage(accountId, messageKey);
}

/**
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ permanent?: boolean }} [options]
 */
export async function deleteMessage(accountId, messageKey, options = {}) {
  return deleteImapMessage(accountId, messageKey, options);
}

/**
 * Bulk mail operations on cached message ids.
 * @param {string} accountId
 * @param {{ ids: string[], action: string, destFolder?: string }} input
 */
export async function bulkMessageAction(accountId, input) {
  const ids = Array.isArray(input.ids) ? input.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) {
    throw new Error('ids array is required');
  }
  if (ids.length > 100) {
    throw new Error('Bulk limit is 100 messages');
  }

  const action = String(input.action ?? '').trim().toLowerCase();

  if (BULK_FLAG_ACTIONS[action]) {
    const results = await setImapMessageFlagsBulk(accountId, ids, BULK_FLAG_ACTIONS[action]);
    const failed = results.filter((row) => row.ok === false);
    return { ok: failed.length === 0, results, failed: failed.length };
  }

  const results = [];

  for (const messageKey of ids) {
    try {
      if (action === 'archive') {
        results.push({ id: messageKey, ...(await archiveMessage(accountId, messageKey)) });
      } else if (action === 'delete') {
        results.push({ id: messageKey, ...(await deleteMessage(accountId, messageKey)) });
      } else if (action === 'move') {
        const dest = String(input.destFolder ?? '').trim();
        if (!dest) {
          throw new Error('destFolder is required for move');
        }
        results.push({ id: messageKey, ...(await moveMessage(accountId, messageKey, dest)) });
      } else {
        throw new Error(`Unknown bulk action: ${action}`);
      }
    } catch (err) {
      results.push({
        id: messageKey,
        ok: false,
        error: err instanceof Error ? err.message : 'Action failed',
      });
    }
  }

  const failed = results.filter((row) => row.ok === false);
  return { ok: failed.length === 0, results, failed: failed.length };
}
