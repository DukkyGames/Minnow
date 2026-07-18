/**
 * IMAP message mutations — flags, move, archive, delete (imapflow).
 */

import { listFoldersCached, withMailbox } from './imap-session.js';
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

  await withMailbox(accountId, folder, async (client) => {
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
 * Set flags on many messages with one STORE per folder (imapflow accepts a UID
 * set), instead of one connection + one STORE per message.
 *
 * @param {string} accountId
 * @param {string[]} messageKeys
 * @param {{ seen?: boolean, flagged?: boolean }} flags
 */
export async function setImapMessageFlagsBulk(accountId, messageKeys, flags) {
  /** @type {Map<string, Array<{ key: string, uid: number, message: Record<string, any> }>>} */
  const byFolder = new Map();
  /** @type {Array<{ id: string, ok: false, error: string }>} */
  const failures = [];

  for (const key of messageKeys) {
    try {
      const { message, folder, uid } = await resolveCachedMessage(accountId, key);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push({ key, uid, message });
    } catch (err) {
      failures.push({
        id: key,
        ok: false,
        error: err instanceof Error ? err.message : 'Message not found',
      });
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const results = [...failures];

  for (const [folder, entries] of byFolder) {
    const uidSet = entries.map((entry) => entry.uid).join(',');
    try {
      await withMailbox(accountId, folder, async (client) => {
        if (flags.seen === true) {
          await client.messageFlagsAdd(uidSet, ['\\Seen'], { uid: true });
        } else if (flags.seen === false) {
          await client.messageFlagsRemove(uidSet, ['\\Seen'], { uid: true });
        }
        if (flags.flagged === true) {
          await client.messageFlagsAdd(uidSet, ['\\Flagged'], { uid: true });
        } else if (flags.flagged === false) {
          await client.messageFlagsRemove(uidSet, ['\\Flagged'], { uid: true });
        }
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Bulk flag update failed';
      for (const entry of entries) {
        results.push({ id: entry.key, ok: false, error });
      }
      continue;
    }

    for (const entry of entries) {
      const nextFlags = {
        seen: flags.seen ?? entry.message.flags?.seen ?? false,
        flagged: flags.flagged ?? entry.message.flags?.flagged ?? false,
        answered: entry.message.flags?.answered ?? false,
      };
      await updateMessageFlags(accountId, entry.key, nextFlags);
      results.push({ id: entry.key, ok: true, flags: nextFlags });
    }
  }

  return results;
}

/**
 * Move a message to another folder.
 * @param {string} accountId
 * @param {string} messageKey
 * @param {string} destFolder
 * @param {'trash' | 'archive' | 'junk' | ''} [role]
 */
export async function moveImapMessage(accountId, messageKey, destFolder, role = '') {
  const { folder, uid } = await resolveCachedMessage(accountId, messageKey);
  const folders = await listFoldersCached(accountId);
  const target = resolveMailFolder(folders, destFolder, role);

  let newUid = uid;
  await withMailbox(accountId, folder, async (client) => {
    const moved = await client.messageMove(uid, target, { uid: true });
    if (moved && typeof moved === 'object' && moved.uidMap) {
      const mapped = moved.uidMap.get(uid);
      if (mapped) {
        newUid = mapped;
      }
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
  const folders = await listFoldersCached(accountId);
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
  const { folder, uid } = await resolveCachedMessage(accountId, messageKey);
  const folders = await listFoldersCached(accountId);
  const trashFolder = resolveMailFolder(folders, 'Trash', 'trash');
  const folderLower = folder.toLowerCase();

  if (options.permanent || folderLower.includes('trash') || folderLower.includes('bin')) {
    await withMailbox(accountId, folder, async (client) => {
      await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
      await client.messageDelete(uid, { uid: true });
    });
    await removeMessageFromCache(accountId, messageKey);
    return { ok: true, deleted: true };
  }

  return moveImapMessage(accountId, messageKey, trashFolder, 'trash');
}
