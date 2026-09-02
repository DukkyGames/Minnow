/**
 * Attachment byte download.
 *
 * Metadata for a message lands in the `attachments` table during the lazy body
 * fetch (`ensureMessageBody`), but the bytes are never stored — a mailbox of
 * 50MB decks would otherwise be mirrored to disk for chips nobody clicks. The
 * download route re-fetches the message source on demand and slices the part
 * out of it, so the store stays metadata-only.
 *
 * `index` is the part ordinal `simpleParser` assigns, which is the same
 * ordering persisted as `attachments.idx`.
 */

import { simpleParser } from 'mailparser';
import { getCachedMessage } from './cache.js';
import { withMailbox } from './imap-session.js';

/** Refuse to buffer a part larger than this into memory. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Path separators, characters Windows forbids, and C0/DEL control codes. */
const UNSAFE_FILENAME_CHARS = new RegExp('[\\\\/<>:"|?*\\u0000-\\u001f\\u007f]', 'g');

/**
 * Strip anything that could escape a `Content-Disposition` header or write
 * outside a download directory. Never trust a filename from the network.
 * @param {string} raw
 */
export function safeAttachmentFilename(raw) {
  const base = String(raw ?? '')
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/^\.+/, '')
    .trim();
  return base.slice(0, 200) || 'attachment';
}

/**
 * Download the raw source for a cached message.
 * @param {string} accountId
 * @param {Record<string, unknown>} message
 * @returns {Promise<Buffer>}
 */
async function fetchMessageSource(accountId, message) {
  const folder = String(message.folder ?? 'INBOX');
  const uid = Number(message.uid);
  if (!Number.isFinite(uid)) {
    throw new Error('Message uid is invalid');
  }

  const source = await withMailbox(accountId, folder, async (client) => {
    const downloaded = await client.fetchOne(
      String(uid),
      { uid: true, source: true },
      { uid: true },
    );
    if (!downloaded?.source) return null;
    return Buffer.isBuffer(downloaded.source)
      ? downloaded.source
      : Buffer.from(String(downloaded.source));
  });

  if (!source) {
    throw new Error('Message source unavailable on the server');
  }
  return source;
}

/**
 * Fetch one attachment's bytes, addressed either by part index or Content-ID.
 *
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ index?: number, contentId?: string }} selector
 * @returns {Promise<{ filename: string, contentType: string, size: number, content: Buffer, inline: boolean }>}
 */
export async function fetchMessageAttachment(accountId, messageKey, selector = {}) {
  const message = await getCachedMessage(accountId, messageKey);
  if (!message) {
    throw new Error('Cached message not found');
  }

  const source = await fetchMessageSource(accountId, message);
  const parsed = await simpleParser(source);
  const parts = Array.isArray(parsed.attachments) ? parsed.attachments : [];

  const contentId = String(selector.contentId ?? '').trim();
  let part = null;
  if (contentId) {
    const needle = contentId.replace(/^<|>$/g, '').toLowerCase();
    part = parts.find((row) => String(row.cid ?? '').toLowerCase() === needle) ?? null;
  } else {
    const index = Number(selector.index);
    if (!Number.isInteger(index) || index < 0 || index >= parts.length) {
      throw new Error('Attachment not found');
    }
    part = parts[index];
  }

  if (!part) {
    throw new Error('Attachment not found');
  }

  const content = Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content ?? '');
  if (content.length > MAX_ATTACHMENT_BYTES) {
    const err = new Error('Attachment is too large to download');
    /** @type {{ status?: number }} */ (err).status = 413;
    throw err;
  }

  return {
    filename: safeAttachmentFilename(part.filename ?? 'attachment'),
    contentType: String(part.contentType ?? 'application/octet-stream'),
    size: content.length,
    content,
    inline: String(part.contentDisposition ?? '').toLowerCase() === 'inline',
  };
}
