/**
 * IMAP connect, folder listing, and paginated message fetch (imapflow).
 */

import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { readAccountPassword, getEmailAccount } from './accounts.js';
import { computeThreadId, normalizeMessageId } from './threads.js';
import {
  buildBodyPreview,
  decodeMimeHeader,
  formatAddressList,
  formatFromAddress,
  stripHtmlToText,
} from './parse-body.js';
import { mergeMessagesIntoCache } from './cache.js';
import { withImapErrors } from './imap-errors.js';

/** Default page size for inbox fetch. */
export const DEFAULT_FETCH_LIMIT = 50;

/** Maximum messages per agent/tool request. */
export const MAX_TOOL_LIMIT = 20;

/**
 * Build an imapflow client for an account (caller must connect/disconnect).
 * @param {import('./accounts.js').EmailAccount} account
 * @param {string} password
 */
export function createImapClient(account, password) {
  return new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.tls,
    auth: {
      user: account.username,
      pass: password,
    },
    logger: false,
    emitLogs: false,
  });
}

/**
 * Test IMAP login for an account.
 * @param {string} accountId
 */
export async function testImapConnection(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const password = await readAccountPassword(accountId);
  return withImapErrors(account, async () => {
    const client = createImapClient(account, password);
    try {
      await client.connect();
      await client.logout();
      return { ok: true };
    } finally {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  });
}

/**
 * List selectable IMAP folders.
 * @param {string} accountId
 */
export async function listImapFolders(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const password = await readAccountPassword(accountId);
  return withImapErrors(account, async () => {
    const client = createImapClient(account, password);
    try {
      await client.connect();
      const folders = [];
      const list = await client.list();
      for (const entry of list) {
        folders.push({
          path: entry.path,
          name: entry.name,
          specialUse: entry.specialUse ?? null,
          subscribed: entry.subscribed ?? true,
        });
      }
      return folders;
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
 * Parse a raw RFC822 source into normalized metadata.
 * @param {Buffer} source
 * @param {{ uid: number, folder: string }} context
 */
export async function parseRawMessage(source, context) {
  const parsed = await simpleParser(source);
  const messageId = normalizeMessageId(parsed.messageId ?? '');
  const references = Array.isArray(parsed.references)
    ? parsed.references.map((ref) => normalizeMessageId(String(ref)))
    : typeof parsed.references === 'string'
      ? parsed.references.split(/\s+/).map((ref) => normalizeMessageId(ref))
      : [];

  const inReplyTo = parsed.inReplyTo ? normalizeMessageId(String(parsed.inReplyTo)) : '';
  const subject = decodeMimeHeader(parsed.subject ?? '');
  const from = formatFromAddress(
    parsed.from?.value?.map((row) => ({ name: row.name, address: row.address })) ?? [],
  );
  const to = formatAddressList(
    parsed.to?.value?.map((row) => ({ name: row.name, address: row.address })) ?? [],
  );

  const plain = parsed.text ?? '';
  const htmlText = parsed.html ? stripHtmlToText(parsed.html) : '';
  const bodyText = plain.trim() || htmlText;
  const bodyPreview = buildBodyPreview(bodyText);
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');

  const attachments = Array.isArray(parsed.attachments)
    ? parsed.attachments.map((att) => ({
        filename: att.filename ?? 'attachment',
        contentType: att.contentType ?? 'application/octet-stream',
        size: att.size ?? 0,
      }))
    : [];

  const threadId = computeThreadId({
    messageId,
    inReplyTo,
    references,
    subject,
  });

  const date = parsed.date ? parsed.date.toISOString() : new Date().toISOString();

  return {
    id: `${context.folder}:${context.uid}`,
    uid: String(context.uid),
    messageId,
    threadId,
    folder: context.folder,
    from,
    to,
    subject,
    date,
    bodyPreview,
    bodyText,
    bodyHash,
    hasAttachments: attachments.length > 0,
    attachments,
    inReplyTo,
    references,
  };
}

/**
 * Fetch recent messages from a folder and merge into cache.
 * @param {string} accountId
 * @param {{ folder?: string, limit?: number, offset?: number }} options
 */
export async function syncFolderMessages(accountId, options = {}) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }

  const folder = String(options.folder ?? account.folders[0] ?? 'INBOX');
  const limit = Math.min(200, Math.max(1, Number(options.limit) || DEFAULT_FETCH_LIMIT));
  const offset = Math.max(0, Number(options.offset) || 0);

  const password = await readAccountPassword(accountId);
  return withImapErrors(account, async () => {
    const client = createImapClient(account, password);

    /** @type {Array<Record<string, unknown>>} */
    const parsedMessages = [];
    let highestUid = 0;

    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        const status = await client.status(folder, { uidNext: true, messages: true });
        if (!status.messages) {
          return { messages: [], total: 0, folder, synced: 0 };
        }

        const search = await client.search({ all: true }, { uid: true });
        const uids = Array.isArray(search) ? search.slice().sort((a, b) => b - a) : [];
        const pageUids = uids.slice(offset, offset + limit);

        for (const uid of pageUids) {
          highestUid = Math.max(highestUid, uid);
          const downloaded = await client.download(uid.toString(), undefined, { uid: true });
          if (!downloaded?.content) {
            continue;
          }
          const chunks = [];
          for await (const chunk of downloaded.content) {
            chunks.push(chunk);
          }
          const source = Buffer.concat(chunks);
          const row = await parseRawMessage(source, { uid, folder });
          parsedMessages.push(row);
        }
      } finally {
        lock.release();
      }
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

    const cache = await mergeMessagesIntoCache(accountId, parsedMessages, folder, highestUid);
    return {
      messages: parsedMessages,
      total: cache.messages.filter((row) => String(row.folder) === folder).length,
      folder,
      synced: parsedMessages.length,
    };
  });
}
