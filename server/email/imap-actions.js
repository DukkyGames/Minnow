/**
 * IMAP message mutations — flags, move, archive, delete (imapflow).
 */

import { readAccountPassword, getEmailAccount } from './accounts.js';
import { createImapClient, listImapFolders } from './imap.js';
import { withImapErrors } from './imap-errors.js';
import {
  getCachedMessage,
  removeMessageFromCache,
  updateMessageFlags,
  updateMessageFolder,
} from './cache.js';

/**
 * Convert imapflow flag set to normalized cache flags.
 * @param {Set<string> | string[] | undefined} flagSet
 */
export function imapFlagsToObject(flagSet) {
  const flags = flagSet instanceof Set ? [...flagSet] : Array.isArray(flagSet) ? flagSet : [];
  const set = new Set(flags);
  return {
    seen: set.has('\\Seen'),
    flagged: set.has('\\Flagged'),
    answered: set.has('\\Answered'),
  };
}

/**
 * Resolve provider-specific folder names (Gmail archive/trash heuristics).
 * @param {Array<{ path: string, name: string, specialUse?: string | null }>} folders
 * @param {string} preferred
 * @param {'trash' | 'archive' | 'junk' | ''} role
 */
export function resolveMailFolder(folders, preferred, role = '') {
  const names = folders.map((row) => row.path);
  if (preferred && names.includes(preferred)) {
    return preferred;
  }

  const roleFlags = {
    trash: ['\\Trash'],
    archive: ['\\Archive', '\\All'],
    junk: ['\\Junk'],
  }[role] ?? [];

  for (const entry of folders) {
    const special = String(entry.specialUse ?? '');
    if (roleFlags.some((flag) => special.includes(flag))) {
      return entry.path;
    }
  }

  const candidates = {
    trash: [
      'Trash',
      '[Gmail]/Trash',
      '[Google Mail]/Trash',
      'Bin',
      '[Gmail]/Bin',
      'Deleted Messages',
      'Deleted Items',
    ],
    archive: [
      'Archive',
      'Archives',
      '[Gmail]/All Mail',
      '[Google Mail]/All Mail',
      'All Mail',
    ],
    junk: ['Junk', 'Spam', '[Gmail]/Spam', '[Google Mail]/Spam'],
  }[role] ?? [];

  const lowerMap = Object.fromEntries(names.map((name) => [name.toLowerCase(), name]));
  for (const candidate of candidates) {
    const found = lowerMap[candidate.toLowerCase()];
    if (found) {
      return found;
    }
  }

  return preferred;
}

/**
 * @param {string} accountId
 * @param {(client: import('imapflow').ImapFlow, account: import('./accounts.js').EmailAccount) => Promise<unknown>} fn
 */
async function withConnectedImap(accountId, fn) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const password = await readAccountPassword(accountId);
  return withImapErrors(account, async () => {
    const client = createImapClient(account, password);
    try {
      await client.connect();
      return await fn(client, account);
    } finally {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  });
}

/**
 * @param {string} accountId
 * @param {string} messageKey
 */
async function resolveCachedMessage(accountId, messageKey) {
  const message = await getCachedMessage(accountId, messageKey);
  if (!message) {
    throw new Error('Cached message not found');
  }
  const folder = String(message.folder ?? 'INBOX');
  const uid = Number(message.uid);
  if (!Number.isFinite(uid)) {
    throw new Error('Message uid is invalid');
  }
  return { message, folder, uid };
}

/**
 * Set \\Seen / \\Flagged on one message.
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ seen?: boolean, flagged?: boolean }} flags
 */
export async function setImapMessageFlags(accountId, messageKey, flags) {
  const { message, folder, uid } = await resolveCachedMessage(accountId, messageKey);

  await withConnectedImap(accountId, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      if (flags.seen === true) {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      } else if (flags.seen === false) {
        await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
      }
      if (flags.flagged === true) {
        await client.messageFlagsAdd(uid, ['\\Flagged'], { uid: true });
      } else if (flags.flagged === false) {
        await client.messageFlagsRemove(uid, ['\\Flagged'], { uid: true });
      }
    } finally {
      lock.release();
    }
  });

  const nextFlags = {
    seen: flags.seen ?? message.flags?.seen ?? false,
    flagged: flags.flagged ?? message.flags?.flagged ?? false,
    answered: message.flags?.answered ?? false,
  };
  await updateMessageFlags(accountId, messageKey, nextFlags);
  return { ok: true, flags: nextFlags };
}

/**
 * Move a message to another folder.
 * @param {string} accountId
 * @param {string} messageKey
 * @param {string} destFolder
 * @param {'trash' | 'archive' | 'junk' | ''} [role]
 */
export async function moveImapMessage(accountId, messageKey, destFolder, role = '') {
  const { message, folder, uid } = await resolveCachedMessage(accountId, messageKey);
  const folders = await listImapFolders(accountId);
  const target = resolveMailFolder(folders, destFolder, role);

  let newUid = uid;
  await withConnectedImap(accountId, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const moved = await client.messageMove(uid, target, { uid: true });
      if (moved && typeof moved === 'object' && moved.uidMap) {
        const mapped = moved.uidMap.get(uid);
        if (mapped) {
          newUid = mapped;
        }
      }
    } finally {
      lock.release();
    }
  });

  await updateMessageFolder(accountId, messageKey, target, String(newUid));
  return { ok: true, folder: target, uid: String(newUid) };
}

/**
 * Archive — move to provider archive folder.
 * @param {string} accountId
 * @param {string} messageKey
 */
export async function archiveImapMessage(accountId, messageKey) {
  const folders = await listImapFolders(accountId);
  const archiveFolder = resolveMailFolder(folders, 'Archive', 'archive');
  return moveImapMessage(accountId, messageKey, archiveFolder, 'archive');
}

/**
 * Delete — move to trash or expunge when already in trash.
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ permanent?: boolean }} [options]
 */
export async function deleteImapMessage(accountId, messageKey, options = {}) {
  const { message, folder, uid } = await resolveCachedMessage(accountId, messageKey);
  const folders = await listImapFolders(accountId);
  const trashFolder = resolveMailFolder(folders, 'Trash', 'trash');
  const folderLower = folder.toLowerCase();

  if (options.permanent || folderLower.includes('trash') || folderLower.includes('bin')) {
    await withConnectedImap(accountId, async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
        await client.messageDelete(uid, { uid: true });
      } finally {
        lock.release();
      }
    });
    await removeMessageFromCache(accountId, messageKey);
    return { ok: true, deleted: true };
  }

  return moveImapMessage(accountId, messageKey, trashFolder, 'trash');
}
