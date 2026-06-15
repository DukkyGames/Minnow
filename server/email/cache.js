/**
 * Local message metadata cache (~/.minnow/email/cache/<accountId>/).
 */

import fs from 'node:fs/promises';
import { emailCacheDir, emailCacheMessagesPath } from './paths.js';

/**
 * @typedef {object} EmailCacheFile
 * @property {number} version
 * @property {Record<string, { highestUid?: number }>} folderCursors
 * @property {Array<Record<string, unknown>>} messages
 */

/**
 * @param {string} accountId
 * @returns {Promise<EmailCacheFile>}
 */
export async function readMessageCache(accountId) {
  const filePath = emailCacheMessagesPath(accountId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: parsed?.version ?? 1,
      folderCursors:
        parsed?.folderCursors && typeof parsed.folderCursors === 'object'
          ? parsed.folderCursors
          : {},
      messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
    };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { version: 1, folderCursors: {}, messages: [] };
    }
    throw err;
  }
}

/**
 * @param {string} accountId
 * @param {EmailCacheFile} cache
 */
export async function writeMessageCache(accountId, cache) {
  const filePath = emailCacheMessagesPath(accountId);
  await fs.mkdir(emailCacheDir(accountId), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = {
    version: 1,
    folderCursors: cache.folderCursors ?? {},
    messages: cache.messages ?? [],
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * Merge fetched messages into cache (by uid + folder).
 * @param {string} accountId
 * @param {Array<Record<string, unknown>>} incoming
 * @param {string} folder
 * @param {number | undefined} highestUid
 */
export async function mergeMessagesIntoCache(accountId, incoming, folder, highestUid) {
  const cache = await readMessageCache(accountId);
  const key = (row) => `${row.folder}:${row.uid}`;
  const map = new Map(cache.messages.map((row) => [key(row), row]));

  for (const message of incoming) {
    map.set(key(message), { ...map.get(key(message)), ...message });
  }

  cache.messages = Array.from(map.values()).sort((a, b) => {
    const da = new Date(String(a.date ?? 0)).getTime();
    const db = new Date(String(b.date ?? 0)).getTime();
    return db - da;
  });

  if (!cache.folderCursors[folder]) {
    cache.folderCursors[folder] = {};
  }
  if (highestUid && Number.isFinite(highestUid)) {
    const prev = cache.folderCursors[folder].highestUid ?? 0;
    cache.folderCursors[folder].highestUid = Math.max(prev, highestUid);
  }

  await writeMessageCache(accountId, cache);
  return cache;
}

/**
 * List cached messages with optional folder filter and pagination.
 * @param {string} accountId
 * @param {{ folder?: string, offset?: number, limit?: number, query?: string }} options
 */
export async function listCachedMessages(accountId, options = {}) {
  const cache = await readMessageCache(accountId);
  let rows = cache.messages.slice();

  const folder = options.folder ? String(options.folder) : '';
  if (folder) {
    rows = rows.filter((row) => String(row.folder) === folder);
  }

  const query = String(options.query ?? '').trim().toLowerCase();
  if (query) {
    rows = rows.filter((row) => {
      const hay = [
        row.subject,
        row.from,
        row.bodyPreview,
        ...(Array.isArray(row.to) ? row.to : []),
      ]
        .map((part) => String(part ?? '').toLowerCase())
        .join(' ');
      return hay.includes(query);
    });
  }

  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
  const total = rows.length;
  const page = rows.slice(offset, offset + limit);

  return { messages: page, total, offset, limit };
}

/**
 * @param {string} accountId
 * @param {string} compositeId — `${folder}:${uid}` or message cache id
 */
export async function getCachedMessage(accountId, compositeId) {
  const cache = await readMessageCache(accountId);
  const needle = String(compositeId);
  return (
    cache.messages.find(
      (row) =>
        row.id === needle ||
        `${row.folder}:${row.uid}` === needle ||
        String(row.uid) === needle,
    ) ?? null
  );
}

/**
 * @param {string} accountId
 * @param {string} threadId
 */
export async function listCachedThread(accountId, threadId) {
  const cache = await readMessageCache(accountId);
  const rows = cache.messages
    .filter((row) => String(row.threadId) === String(threadId))
    .sort((a, b) => new Date(String(a.date)).getTime() - new Date(String(b.date)).getTime());
  return rows;
}

/**
 * Update triage metadata on a cached message.
 * @param {string} accountId
 * @param {string} messageKey
 * @param {object} triage
 */
export async function updateMessageTriage(accountId, messageKey, triage) {
  const cache = await readMessageCache(accountId);
  const index = cache.messages.findIndex(
    (row) =>
      row.id === messageKey ||
      `${row.folder}:${row.uid}` === messageKey ||
      String(row.uid) === messageKey,
  );
  if (index < 0) {
    throw new Error('Cached message not found');
  }
  cache.messages[index] = {
    ...cache.messages[index],
    triage: {
      ...triage,
      cachedAt: new Date().toISOString(),
    },
  };
  await writeMessageCache(accountId, cache);
  return cache.messages[index];
}
