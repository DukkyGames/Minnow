/**
 * Microsoft Graph mail transport for OAuth-linked email accounts.
 */

import { createHash } from 'node:crypto';
import { getEmailAccount } from './accounts.js';
import { getValidAccessToken } from '../oauth/flow.js';
import { mergeMessagesIntoCache } from './cache.js';
import { computeThreadId, normalizeMessageId } from './threads.js';
import { buildBodyPreview, stripHtmlToText } from './parse-body.js';
import { sanitizeEmailHtml } from './sanitize-html.js';
import { DEFAULT_FETCH_LIMIT } from './imap.js';
import {
  getCachedMessage,
  removeMessageFromCache,
  updateMessageFlags,
  updateMessageFolder,
} from './cache.js';

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
  const rawBody = String(message.body?.content ?? message.bodyPreview ?? '');
  const isHtml = String(message.body?.contentType ?? '').toLowerCase() === 'html';
  const bodyHtml = isHtml ? sanitizeEmailHtml(rawBody) : undefined;
  const bodyText = isHtml ? stripHtmlToText(rawBody) : rawBody;
  const bodyPreview = buildBodyPreview(bodyText);
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');
  const threadId = computeThreadId({
    messageId,
    subject,
    inReplyTo: '',
    references: [],
  });
  const uid = String(message.id ?? '');
  const flags = {
    seen: Boolean(message.isRead),
    flagged: message.flag?.flagStatus === 'flagged',
    answered: false,
  };

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
    bodyHtml,
    bodyHash,
    hasAttachments: Boolean(message.hasAttachments),
    attachments: [],
    inReplyTo: '',
    references: [],
    flags,
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

/**
 * @param {string} accountId
 * @param {string} messageKey
 */
async function resolveGraphMessage(accountId, messageKey) {
  const message = await getCachedMessage(accountId, messageKey);
  if (!message) {
    throw new Error('Cached message not found');
  }
  return { message, graphId: String(message.uid) };
}

/**
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ seen?: boolean, flagged?: boolean }} flags
 */
export async function setGraphMessageFlags(accountId, messageKey, flags) {
  const { message, graphId } = await resolveGraphMessage(accountId, messageKey);
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }

  /** @type {Record<string, unknown>} */
  const patch = {};
  if (flags.seen !== undefined) {
    patch.isRead = flags.seen;
  }
  if (flags.flagged !== undefined) {
    patch.flag = { flagStatus: flags.flagged ? 'flagged' : 'notFlagged' };
  }

  await graphFetch(account, `/me/messages/${encodeURIComponent(graphId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
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
 * @param {string} accountId
 * @param {string} messageKey
 * @param {string} destFolder
 */
export async function moveGraphMessage(accountId, messageKey, destFolder) {
  const { message, graphId } = await resolveGraphMessage(accountId, messageKey);
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }

  await graphFetch(account, `/me/messages/${encodeURIComponent(graphId)}/move`, {
    method: 'POST',
    body: JSON.stringify({ destinationId: destFolder }),
  });

  await updateMessageFolder(accountId, messageKey, destFolder, graphId);
  return { ok: true, folder: destFolder, uid: graphId };
}

/** @param {string} accountId @param {string} messageKey */
export async function archiveGraphMessage(accountId, messageKey) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const archiveFolder = await graphFetch(account, '/me/mailFolders/archive');
  return moveGraphMessage(accountId, messageKey, String(archiveFolder.id ?? 'archive'));
}

/**
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ permanent?: boolean }} [options]
 */
export async function deleteGraphMessage(accountId, messageKey, options = {}) {
  const { graphId } = await resolveGraphMessage(accountId, messageKey);
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }

  if (options.permanent) {
    await graphFetch(account, `/me/messages/${encodeURIComponent(graphId)}`, {
      method: 'DELETE',
    });
    await removeMessageFromCache(accountId, messageKey);
    return { ok: true, deleted: true };
  }

  await graphFetch(account, `/me/messages/${encodeURIComponent(graphId)}/move`, {
    method: 'POST',
    body: JSON.stringify({ destinationId: 'deleteditems' }),
  });
  await updateMessageFolder(accountId, messageKey, 'deleteditems', graphId);
  return { ok: true, folder: 'deleteditems', uid: graphId };
}
