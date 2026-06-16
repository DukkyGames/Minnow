/**
 * Gmail API transport for OAuth-linked email accounts.
 */

import { createHash } from 'node:crypto';
import { google } from 'googleapis';
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
 * Walk all MIME parts depth-first.
 * @param {import('googleapis').gmail_v1.Schema$MessagePart | undefined} part
 * @param {(part: import('googleapis').gmail_v1.Schema$MessagePart) => void} visit
 */
function walkMimeParts(part, visit) {
  if (!part) {
    return;
  }
  visit(part);
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      walkMimeParts(child, visit);
    }
  }
}

/**
 * Extract plain text from Gmail message payload (prefers text/plain).
 * @param {import('googleapis').gmail_v1.Schema$MessagePart | undefined} payload
 */
function extractPlainFromPayload(payload) {
  let plain = '';
  let htmlFallback = '';
  walkMimeParts(payload, (part) => {
    if (part.mimeType === 'text/plain' && part.body?.data && !plain) {
      plain = decodeGmailBody(part.body.data);
    }
    if (part.mimeType === 'text/html' && part.body?.data && !htmlFallback) {
      htmlFallback = stripHtmlToText(decodeGmailBody(part.body.data));
    }
  });
  return plain.trim() || htmlFallback;
}

/**
 * Extract HTML body from Gmail message payload (first text/html part).
 * @param {import('googleapis').gmail_v1.Schema$MessagePart | undefined} payload
 */
function extractHtmlFromPayload(payload) {
  let html = '';
  walkMimeParts(payload, (part) => {
    if (part.mimeType === 'text/html' && part.body?.data && !html) {
      html = decodeGmailBody(part.body.data);
    }
  });
  return html.trim();
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
  const bodyText = extractPlainFromPayload(message.payload) || message.snippet || '';
  const bodyHtml = sanitizeEmailHtml(extractHtmlFromPayload(message.payload));
  const bodyPreview = buildBodyPreview(bodyText);
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');
  const threadId = computeThreadId({ messageId, inReplyTo, references, subject });
  const uid = String(message.id ?? '');
  const labelIds = message.labelIds ?? [];
  const flags = {
    seen: !labelIds.includes('UNREAD'),
    flagged: labelIds.includes('STARRED'),
    answered: labelIds.includes('SENT') && labelIds.includes('INBOX'),
  };

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
    bodyHtml,
    bodyHash,
    hasAttachments: attachments.length > 0,
    attachments,
    inReplyTo,
    references,
    flags,
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

/**
 * @param {string} accountId
 * @param {string} messageKey
 */
async function resolveGmailMessage(accountId, messageKey) {
  const message = await getCachedMessage(accountId, messageKey);
  if (!message) {
    throw new Error('Cached message not found');
  }
  const gmailId = String(message.uid);
  return { message, gmailId };
}

/**
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ seen?: boolean, flagged?: boolean }} flags
 */
export async function setGmailMessageFlags(accountId, messageKey, flags) {
  const { message, gmailId } = await resolveGmailMessage(accountId, messageKey);
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const gmail = await createGmailClient(account);

  /** @type {{ addLabelIds?: string[], removeLabelIds?: string[] }} */
  const body = {};
  if (flags.seen === true) {
    body.removeLabelIds = ['UNREAD'];
  } else if (flags.seen === false) {
    body.addLabelIds = ['UNREAD'];
  }
  if (flags.flagged === true) {
    body.addLabelIds = [...(body.addLabelIds ?? []), 'STARRED'];
  } else if (flags.flagged === false) {
    body.removeLabelIds = [...(body.removeLabelIds ?? []), 'STARRED'];
  }

  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailId,
    requestBody: body,
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
export async function moveGmailMessage(accountId, messageKey, destFolder) {
  const { message, gmailId } = await resolveGmailMessage(accountId, messageKey);
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const gmail = await createGmailClient(account);
  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailId,
    requestBody: {
      addLabelIds: [destFolder],
      removeLabelIds: [String(message.folder ?? 'INBOX')],
    },
  });
  await updateMessageFolder(accountId, messageKey, destFolder, gmailId);
  return { ok: true, folder: destFolder, uid: gmailId };
}

/** @param {string} accountId @param {string} messageKey */
export async function archiveGmailMessage(accountId, messageKey) {
  const { gmailId } = await resolveGmailMessage(accountId, messageKey);
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const gmail = await createGmailClient(account);
  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailId,
    requestBody: { removeLabelIds: ['INBOX'] },
  });
  await updateMessageFolder(accountId, messageKey, 'ARCHIVE', gmailId);
  return { ok: true, folder: 'ARCHIVE', uid: gmailId };
}

/**
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ permanent?: boolean }} [options]
 */
export async function deleteGmailMessage(accountId, messageKey, options = {}) {
  const { message, gmailId } = await resolveGmailMessage(accountId, messageKey);
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const gmail = await createGmailClient(account);

  if (options.permanent) {
    await gmail.users.messages.delete({ userId: 'me', id: gmailId });
    await removeMessageFromCache(accountId, messageKey);
    return { ok: true, deleted: true };
  }

  await gmail.users.messages.trash({ userId: 'me', id: gmailId });
  await updateMessageFolder(accountId, messageKey, 'TRASH', gmailId);
  return { ok: true, folder: 'TRASH', uid: gmailId };
}
