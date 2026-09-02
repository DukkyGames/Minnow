import { ImapFlow } from 'imapflow';
import { getEmailAccount, readAccountPassword } from './accounts.js';
import { withImapErrors } from './imap-errors.js';
import { getCachedFolders, setCachedFolders } from './cache.js';

export const IDLE_CLOSE_MS = 5 * 60_000;

export const FOLDER_CACHE_TTL_MS = 24 * 60 * 60_000;

const MAX_BACKOFF_MS = 60_000;

/**
 * @typedef {object} ImapSession
 * @property {import('imapflow').ImapFlow | null} client
 * @property {Promise<import('imapflow').ImapFlow> | null} connecting
 * @property {NodeJS.Timeout | null} idleTimer
 * @property {number} borrowed
 * @property {number} failures
 */

/** @type {Map<string, ImapSession>} */
const sessions = new Map();

/** @type {Map<string, Promise<unknown>>} */
const queues = new Map();

function getSession(accountId) {
  let session = sessions.get(accountId);
  if (!session) {
    session = { client: null, connecting: null, idleTimer: null, borrowed: 0, failures: 0 };
    sessions.set(accountId, session);
  }
  return session;
}

function clearIdleTimer(session) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

function scheduleIdleClose(accountId) {
  const session = getSession(accountId);
  clearIdleTimer(session);
  session.idleTimer = setTimeout(() => {
    if (session.borrowed === 0) {
      void closeImapSession(accountId);
    }
  }, IDLE_CLOSE_MS);
  session.idleTimer.unref?.();
}

/**
 * @param {import('./accounts.js').EmailAccount} account
 * @param {string} password
 */
export function createSessionClient(account, password) {
  return new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.tls,
    auth: { user: account.username, pass: password },
    logger: false,
    emitLogs: false,
  });
}

/**
 * @param {string} accountId
 * @returns {Promise<{ client: import('imapflow').ImapFlow, account: import('./accounts.js').EmailAccount }>}
 */
async function acquireClient(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const session = getSession(accountId);

  if (session.client && session.client.usable) {
    return { client: session.client, account };
  }

  if (!session.connecting) {
    if (session.failures > 0) {
      const backoff = Math.min(MAX_BACKOFF_MS, 500 * 2 ** (session.failures - 1));
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
    const password = await readAccountPassword(accountId);
    const client = createSessionClient(account, password);
    client.on('error', () => {
    });
    client.on('close', () => {
      if (sessions.get(accountId)?.client === client) {
        getSession(accountId).client = null;
      }
    });
    session.connecting = client
      .connect()
      .then(() => {
        session.client = client;
        session.failures = 0;
        return client;
      })
      .catch((err) => {
        session.failures += 1;
        try {
          void client.close();
        } catch {
        }
        throw err;
      })
      .finally(() => {
        session.connecting = null;
      });
  }

  await session.connecting;
  return { client: session.client, account };
}

/**
 * @template T
 * @param {string} accountId
 * @param {string | null} folder
 * @param {(client: import('imapflow').ImapFlow, account: import('./accounts.js').EmailAccount) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withMailbox(accountId, folder, fn) {
  const previous = queues.get(accountId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => runBorrow(accountId, folder, fn));
  queues.set(
    accountId,
    run.catch(() => {}),
  );
  return run;
}

async function runBorrow(accountId, folder, fn, retry = true) {
  const session = getSession(accountId);
  clearIdleTimer(session);
  session.borrowed += 1;

  try {
    const { client, account } = await acquireClient(accountId);
    return await withImapErrors(account, async () => {
      if (!folder) {
        return fn(client, account);
      }
      const lock = await client.getMailboxLock(folder);
      try {
        return await fn(client, account);
      } finally {
        lock.release();
      }
    });
  } catch (err) {
    const session2 = getSession(accountId);
    const dead = !session2.client?.usable;
    if (retry && dead) {
      session2.client = null;
      return runBorrow(accountId, folder, fn, false);
    }
    throw err;
  } finally {
    session.borrowed -= 1;
    if (session.borrowed === 0) {
      scheduleIdleClose(accountId);
    }
  }
}

/**
 * @param {string} accountId
 */
export async function closeImapSession(accountId) {
  const session = sessions.get(accountId);
  if (!session) return;
  clearIdleTimer(session);
  const client = session.client;
  session.client = null;
  sessions.delete(accountId);
  if (!client) return;
  try {
    await client.logout();
  } catch {
  }
  try {
    await client.close();
  } catch {
  }
}

export async function closeAllImapSessions() {
  await Promise.all([...sessions.keys()].map((accountId) => closeImapSession(accountId)));
  queues.clear();
}

/**
 * @param {string} accountId
 * @param {{ force?: boolean }} [options]
 */
export async function listFoldersCached(accountId, options = {}) {
  if (!options.force) {
    const cached = await getCachedFolders(accountId);
    if (cached?.folders?.length) {
      const age = Date.now() - new Date(cached.fetchedAt ?? 0).getTime();
      if (Number.isFinite(age) && age < FOLDER_CACHE_TTL_MS) {
        return cached.folders;
      }
    }
  }

  const folders = await withMailbox(accountId, null, async (client) => {
    const list = await client.list();
    return list.map((entry) => ({
      path: entry.path,
      name: entry.name,
      specialUse: entry.specialUse ?? null,
      subscribed: entry.subscribed ?? true,
    }));
  });

  await setCachedFolders(accountId, folders);
  return folders;
}

// IDLE watchers

/** @type {Map<string, { client: import('imapflow').ImapFlow, stopped: boolean }>} */
const watchers = new Map();

/**
 * @param {string} accountId
 * @param {(info: { folder: string, reason: string }) => void | Promise<void>} onChange
 */
export async function startIdleWatcher(accountId, onChange, folder = 'INBOX') {
  if (watchers.has(accountId)) {
    return { started: false, reason: 'already_watching' };
  }

  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const password = await readAccountPassword(accountId);
  const client = createSessionClient(account, password);
  const entry = { client, stopped: false };
  watchers.set(accountId, entry);

  client.on('error', () => {
  });
  client.on('exists', () => {
    if (!entry.stopped) {
      void Promise.resolve(onChange({ folder, reason: 'exists' })).catch(() => {});
    }
  });
  client.on('flags', () => {
    if (!entry.stopped) {
      void Promise.resolve(onChange({ folder, reason: 'flags' })).catch(() => {});
    }
  });

  try {
    await client.connect();
    await client.mailboxOpen(folder);
    return { started: true, folder };
  } catch (err) {
    watchers.delete(accountId);
    entry.stopped = true;
    try {
      await client.close();
    } catch {
    }
    throw err;
  }
}

export async function stopIdleWatcher(accountId) {
  const entry = watchers.get(accountId);
  if (!entry) return { stopped: false };
  entry.stopped = true;
  watchers.delete(accountId);
  try {
    await entry.client.logout();
  } catch {
  }
  try {
    await entry.client.close();
  } catch {
  }
  return { stopped: true };
}

export async function stopAllIdleWatchers() {
  await Promise.all([...watchers.keys()].map((accountId) => stopIdleWatcher(accountId)));
}

export function watchedAccountsForTests() {
  return [...watchers.keys()];
}

export function openSessionsForTests() {
  return [...sessions.keys()];
}
