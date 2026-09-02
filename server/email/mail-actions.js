/**
 * Mail mutation router — IMAP flag, move, archive, and delete actions.
 */

import { listUnreadMessageIds } from './cache.js';
import { listFoldersCached } from './imap-session.js';
import {
  archiveImapMessage,
  deleteImapMessage,
  moveImapMessage,
  resolveMailFolder,
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

/** Chunk size for mark-all-read STORE batches (matches the bulk endpoint limit). */
const MARK_ALL_READ_CHUNK = 100;

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

  let junkFolder = '';
  if (action === 'spam') {
    const folders = await listFoldersCached(accountId);
    junkFolder = resolveMailFolder(folders, 'Junk', 'junk');
  }

  for (const messageKey of ids) {
    try {
      if (action === 'archive') {
        results.push({ id: messageKey, ...(await archiveMessage(accountId, messageKey)) });
      } else if (action === 'delete') {
        results.push({ id: messageKey, ...(await deleteMessage(accountId, messageKey)) });
      } else if (action === 'spam') {
        results.push({
          id: messageKey,
          ...(await moveImapMessage(accountId, messageKey, junkFolder, 'junk')),
        });
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

/**
 * Mark every unseen message in a folder (optional FTS query) as read.
 * Processes ids in bounded chunks and reports attempted / updated / failed.
 *
 * @param {string} accountId
 * @param {{ folder?: string, query?: string }} [input]
 */
export async function markAllMessagesRead(accountId, input = {}) {
  const folder = String(input.folder ?? '').trim();
  const query = String(input.query ?? '').trim();
  const ids = listUnreadMessageIds(accountId, { folder, query });
  if (ids.length === 0) {
    return { ok: true, attempted: 0, updated: 0, failed: 0 };
  }

  let updated = 0;
  let failed = 0;
  for (let offset = 0; offset < ids.length; offset += MARK_ALL_READ_CHUNK) {
    const chunk = ids.slice(offset, offset + MARK_ALL_READ_CHUNK);
    const results = await setImapMessageFlagsBulk(accountId, chunk, { seen: true });
    for (const row of results) {
      if (row.ok === false) failed += 1;
      else updated += 1;
    }
  }

  return {
    ok: failed === 0,
    attempted: ids.length,
    updated,
    failed,
  };
}
