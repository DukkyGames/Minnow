/**
 * Microsoft Graph mail transport for OAuth-linked email accounts.
 */

import { createHash } from 'node:crypto';
import { getEmailAccount } from './accounts.js';
import { getValidAccessToken } from '../oauth/flow.js';
import { mergeMessagesIntoCache } from './cache.js';
import { computeThreadId, normalizeMessageId } from './threads.js';
import { buildBodyPreview } from './parse-body.js';
import { DEFAULT_FETCH_LIMIT } from './imap.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * @param {import('./accounts.js').EmailAccount} account
 */
async function graphFetch(account, path, init = {}) {
  if (!account.oauthConnectionId) {
    throw new Error('Microsoft Graph requires an OAuth connection');
  }
  const accessToken = await getValidAccessToken(account.oauthConnectionId);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error?.message || res.statusText;
    throw new Error(`Microsoft Graph error: ${detail}`);
  }
  return data;
}

/**
 * @param {Record<string, unknown>} message
 * @param {string} folder
 */
export function mapGraphMessage(message, folder) {
  const from =
    message.from?.emailAddress?.name && message.from?.emailAddress?.address
      ? `${message.from.emailAddress.name} <${message.from.emailAddress.address}>`
      : String(message.from?.emailAddress?.address ?? '');
  const to = Array.isArray(message.toRecipients)
    ? message.toRecipients.map((row) => {
        const addr = row.emailAddress;
        if (!addr) {
          return '';
        }
        return addr.name ? `${addr.name} <${addr.address}>` : String(addr.address ?? '');
      }).filter(Boolean)
    : [];

  const subject = String(message.subject ?? '');
  const messageId = normalizeMessageId(
    String(message.internetMessageId ?? message.id ?? ''),
  );
  const date = message.receivedDateTime
    ? new Date(String(message.receivedDateTime)).toISOString()
    : new Date().toISOString();
  const bodyText = String(message.body?.content ?? message.bodyPreview ?? '');
  const bodyPreview = buildBodyPreview(bodyText);
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');
  const threadId = computeThreadId({
    messageId,
    subject,
    inReplyTo: '',
    references: [],
  });
  const uid = String(message.id ?? '');

  return {
    id: `${folder}:${uid}`,
    uid,
    messageId,
    threadId,
    folder,
    from,
    to,
    subject,
    date,
    bodyPreview,
    bodyText,
    bodyHash,
    hasAttachments: Boolean(message.hasAttachments),
    attachments: [],
    inReplyTo: '',
    references: [],
  };
}

/** @param {string} accountId */
export async function testGraphMailConnection(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  await graphFetch(account, '/me/mailFolders/inbox');
  return { ok: true };
}

/** @param {string} accountId */
export async function listGraphMailFolders(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const data = await graphFetch(account, '/me/mailFolders?$top=50');
  const folders = Array.isArray(data.value) ? data.value : [];
  return folders.map((folder) => ({
    path: String(folder.id ?? 'inbox'),
    name: String(folder.displayName ?? 'Inbox'),
    specialUse: folder.displayName === 'Inbox' ? '\\Inbox' : null,
    subscribed: true,
  }));
}

/**
 * @param {string} accountId
 * @param {{ folder?: string, limit?: number, offset?: number }} options
 */
export async function syncGraphMailFolder(accountId, options = {}) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }

  const folder = String(options.folder ?? account.folders[0] ?? 'inbox');
  const limit = Math.min(200, Math.max(1, Number(options.limit) || DEFAULT_FETCH_LIMIT));
  const offset = Math.max(0, Number(options.offset) || 0);

  const folderPath =
    folder.toLowerCase() === 'inbox' || folder === 'INBOX'
      ? '/me/mailFolders/inbox/messages'
      : `/me/mailFolders/${encodeURIComponent(folder)}/messages`;

  const data = await graphFetch(
    account,
    `${folderPath}?$top=${limit + offset}&$orderby=receivedDateTime desc`,
  );
  const rows = Array.isArray(data.value) ? data.value : [];
  const pageRows = rows.slice(offset, offset + limit);
  const parsedMessages = pageRows.map((row) => mapGraphMessage(row, folder));

  const highestUid = pageRows.length;
  const cache = await mergeMessagesIntoCache(accountId, parsedMessages, folder, highestUid);
  return {
    messages: parsedMessages,
    total: cache.messages.filter((row) => String(row.folder) === folder).length,
    folder,
    synced: parsedMessages.length,
  };
}

/**
 * @param {import('./accounts.js').EmailAccount} account
 * @param {{ to: string, subject: string, body: string }} mail
 */
export async function sendGraphMailMessage(account, mail) {
  const data = await graphFetch(account, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: mail.subject,
        body: { contentType: 'Text', content: mail.body },
        toRecipients: [
          {
            emailAddress: { address: mail.to },
          },
        ],
      },
      saveToSentItems: true,
    }),
  });

  return {
    ok: true,
    messageId: data?.id ?? null,
    accepted: [mail.to],
    rejected: [],
  };
}
