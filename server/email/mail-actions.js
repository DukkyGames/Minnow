/**
 * Mail mutation router — IMAP flag, move, archive, and delete actions.
 */

import {
  archiveImapMessage,
  deleteImapMessage,
  moveImapMessage,
  setImapMessageFlags,
} from './imap-actions.js';

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
  const results = [];

  for (const messageKey of ids) {
    try {
      if (action === 'read') {
        results.push({ id: messageKey, ...(await setMessageFlags(accountId, messageKey, { seen: true })) });
      } else if (action === 'unread') {
        results.push({ id: messageKey, ...(await setMessageFlags(accountId, messageKey, { seen: false })) });
      } else if (action === 'flag') {
        results.push({ id: messageKey, ...(await setMessageFlags(accountId, messageKey, { flagged: true })) });
      } else if (action === 'unflag') {
        results.push({ id: messageKey, ...(await setMessageFlags(accountId, messageKey, { flagged: false })) });
      } else if (action === 'archive') {
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
