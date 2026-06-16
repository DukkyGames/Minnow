/**
 * Gmail API transport for OAuth-linked email accounts.
 */

import { createHash } from 'node:crypto';
import { google } from 'googleapis';
import { getEmailAccount } from './accounts.js';
import { getValidAccessToken } from '../oauth/flow.js';
import { mergeMessagesIntoCache } from './cache.js';
import { computeThreadId, normalizeMessageId } from './threads.js';
import { buildBodyPreview } from './parse-body.js';
import { DEFAULT_FETCH_LIMIT } from './imap.js';

/**
 * Build an authenticated Gmail client for an OAuth email account.
 * @param {import('./accounts.js').EmailAccount} account
 */
async function createGmailClient(account) {
  if (!account.oauthConnectionId) {
    throw new Error('Gmail API requires an OAuth connection');
  }
  const accessToken = await getValidAccessToken(account.oauthConnectionId);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth });
}

/**
 * Decode Gmail API base64url body data.
 * @param {string} data
 */
function decodeGmailBody(data) {
  if (!data) {
    return '';
  }
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

/**
 * Extract plain text from Gmail message payload.
 * @param {import('googleapis').gmail_v1.Schema$MessagePart | undefined} part
 */
function extractBodyFromPart(part) {
  if (!part) {
    return '';
  }
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeGmailBody(part.body.data);
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    const html = decodeGmailBody(part.body.data);
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const text = extractBodyFromPart(child);
      if (text) {
        return text;
      }
    }
  }
  return '';
}

/**
 * @param {import('googleapis').gmail_v1.Schema$Message} message
 * @param {string} folder
 */
export function mapGmailMessage(message, folder) {
  const headers = message.payload?.headers ?? [];
  const headerMap = Object.fromEntries(
    headers.filter((h) => h.name && h.value).map((h) => [h.name.toLowerCase(), h.value]),
  );

  const messageId = normalizeMessageId(headerMap['message-id'] ?? message.id ?? '');
  const inReplyTo = headerMap['in-reply-to']
    ? normalizeMessageId(headerMap['in-reply-to'])
    : '';
  const references = (headerMap.references ?? '')
    .split(/\s+/)
    .map((ref) => normalizeMessageId(ref))
    .filter(Boolean);
  const subject = headerMap.subject ?? '';
  const from = headerMap.from ?? '';
  const to = (headerMap.to ?? '')
    .split(',')
    .map((row) => row.trim())
    .filter(Boolean);
  const date = headerMap.date ? new Date(headerMap.date).toISOString() : new Date().toISOString();
  const bodyText = extractBodyFromPart(message.payload) || message.snippet || '';
  const bodyPreview = buildBodyPreview(bodyText);
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');
  const threadId = computeThreadId({ messageId, inReplyTo, references, subject });
  const uid = String(message.id ?? '');

  const attachments = [];
  const walkParts = (part) => {
    if (!part) {
      return;
    }
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        contentType: part.mimeType ?? 'application/octet-stream',
        size: part.body.size ?? 0,
      });
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walkParts(child);
      }
    }
  };
  walkParts(message.payload);

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
    hasAttachments: attachments.length > 0,
    attachments,
    inReplyTo,
    references,
  };
}

/** @param {string} accountId */
export async function testGmailConnection(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const gmail = await createGmailClient(account);
  await gmail.users.getProfile({ userId: 'me' });
  return { ok: true };
}

/** @param {string} accountId */
export async function listGmailFolders(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const gmail = await createGmailClient(account);
  const res = await gmail.users.labels.list({ userId: 'me' });
  const labels = res.data.labels ?? [];
  return labels.map((label) => ({
    path: label.id ?? 'INBOX',
    name: label.name ?? label.id ?? 'INBOX',
    specialUse: label.id === 'INBOX' ? '\\Inbox' : null,
    subscribed: true,
  }));
}

/**
 * Sync messages from a Gmail label into cache.
 * @param {string} accountId
 * @param {{ folder?: string, limit?: number, offset?: number }} options
 */
export async function syncGmailFolder(accountId, options = {}) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }

  const folder = String(options.folder ?? account.folders[0] ?? 'INBOX');
  const limit = Math.min(200, Math.max(1, Number(options.limit) || DEFAULT_FETCH_LIMIT));
  const offset = Math.max(0, Number(options.offset) || 0);

  const gmail = await createGmailClient(account);
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    labelIds: [folder],
    maxResults: limit + offset,
  });

  const ids = (listRes.data.messages ?? []).map((row) => row.id).filter(Boolean);
  const pageIds = ids.slice(offset, offset + limit);
  const parsedMessages = [];

  for (const id of pageIds) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });
    if (full.data) {
      parsedMessages.push(mapGmailMessage(full.data, folder));
    }
  }

  const highestUid = pageIds.length > 0 ? Number(pageIds[0]) || 0 : 0;
  const cache = await mergeMessagesIntoCache(accountId, parsedMessages, folder, highestUid);
  return {
    messages: parsedMessages,
    total: cache.messages.filter((row) => String(row.folder) === folder).length,
    folder,
    synced: parsedMessages.length,
  };
}

/**
 * Send email via Gmail API.
 * @param {import('./accounts.js').EmailAccount} account
 * @param {{ to: string, subject: string, body: string, inReplyTo?: string, references?: string }} mail
 */
export async function sendGmailMessage(account, mail) {
  const gmail = await createGmailClient(account);
  const lines = [
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    'Content-Type: text/plain; charset=utf-8',
  ];
  if (mail.inReplyTo) {
    lines.push(`In-Reply-To: ${mail.inReplyTo}`);
  }
  if (mail.references) {
    lines.push(`References: ${mail.references}`);
  }
  lines.push('', mail.body);
  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return {
    ok: true,
    messageId: res.data.id ?? null,
    accepted: [mail.to],
    rejected: [],
  };
}
