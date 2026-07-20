/**
 * IMAP connect, folder listing, and incremental message sync (imapflow).
 *
 * Sync is incremental: new mail is fetched with `UID lastSeen+1:*` (headers +
 * text part only), and a cheap FLAGS-only pass over the visible window
 * reconciles reads/deletes/moves made in another client. Full bodies and
 * attachment metadata are downloaded lazily on first open (`ensureMessageBody`).
 */

import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { readAccountPassword, getEmailAccount } from './accounts.js';
import { computeThreadId, normalizeMessageId } from './threads.js';
import { imapFlagsToObject } from './imap-actions.js';
import {
  buildBodyPreview,
  decodeMimeHeader,
  formatAddressList,
  formatFromAddress,
  stripHtmlToText,
} from './parse-body.js';
import { sanitizeInboundEmailHtml } from './sanitize-html.js';
import {
  countCachedMessages,
  getCachedBody,
  getCachedMessage,
  getSyncState,
  listCachedUids,
  mergeMessagesIntoCache,
  migrateJsonCacheIfNeeded,
  reconcileFolderFlags,
  resetFolderCache,
  saveCachedBody,
  setSyncState,
} from './cache.js';
import { listFoldersCached, withMailbox } from './imap-session.js';
import { withImapErrors } from './imap-errors.js';

/** Default page size for the initial folder fill. */
export const DEFAULT_FETCH_LIMIT = 50;

/** Maximum messages per agent/tool request. */
export const MAX_TOOL_LIMIT = 20;

/** How many recent UIDs the FLAGS reconcile pass covers. */
export const FLAGS_RECONCILE_WINDOW = 200;

/** Cap on new messages ingested in one sync pass (protects a cold 5k mailbox). */
export const MAX_NEW_PER_SYNC = 500;

/** Skip inline text-part download above this size; the body loads lazily instead. */
const MAX_PREVIEW_PART_BYTES = 256 * 1024;

/**
 * Build a one-shot imapflow client (connection tests; pooled work uses
 * `withMailbox` from imap-session.js).
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
 * Test IMAP login for an account. Deliberately unpooled — a credential check
 * must not reuse (or poison) the live session.
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
 * List selectable IMAP folders (served from the per-account folder cache).
 * @param {string} accountId
 * @param {{ force?: boolean }} [options]
 */
export async function listImapFolders(accountId, options = {}) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  return listFoldersCached(accountId, options);
}

/**
 * Parse a raw RFC822 source into normalized metadata.
 * @param {Buffer} source
 * @param {{ uid: number, folder: string, flags?: Set<string> | string[] }} context
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
  const replyTo = formatFromAddress(
    parsed.replyTo?.value?.map((row) => ({ name: row.name, address: row.address })) ?? [],
  );

  const plain = parsed.text ?? '';
  const rawHtml = parsed.html ? String(parsed.html) : '';
  const htmlText = rawHtml ? stripHtmlToText(rawHtml) : '';
  const bodyText = plain.trim() || htmlText;
  const bodyHtml = rawHtml ? sanitizeInboundEmailHtml(rawHtml) : undefined;
  const bodyPreview = buildBodyPreview(bodyText);
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');

  const attachments = Array.isArray(parsed.attachments)
    ? parsed.attachments.map((att, index) => ({
        index,
        filename: att.filename ?? 'attachment',
        contentType: att.contentType ?? 'application/octet-stream',
        size: att.size ?? 0,
        // `cid` is the bracket-stripped Content-ID; the reader matches
        // `cid:` body sources against it.
        contentId: String(att.cid ?? '').trim(),
        inline: String(att.contentDisposition ?? '').toLowerCase() === 'inline',
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
    replyTo,
    subject,
    date,
    bodyPreview,
    bodyText,
    bodyHtml,
    bodyHash,
    bodyComplete: true,
    hasAttachments: attachments.some((att) => !att.inline),
    attachments,
    inReplyTo,
    references,
    flags: imapFlagsToObject(context.flags),
  };
}

/**
 * Walk an imapflow bodyStructure and return the first text/plain (else
 * text/html) leaf small enough to fetch inline during sync.
 * @param {Record<string, any> | undefined} node
 */
export function pickPreviewPart(node) {
  if (!node) return null;
  /** @type {Array<Record<string, any>>} */
  const queue = [node];
  /** @type {{ part: string, type: string, size: number } | null} */
  let htmlFallback = null;

  while (queue.length) {
    const current = queue.shift();
    const type = String(current?.type ?? '').toLowerCase();
    const part = current?.part ? String(current.part) : '1';
    const size = Number(current?.size) || 0;
    const disposition = String(current?.disposition ?? '').toLowerCase();

    if (Array.isArray(current?.childNodes) && current.childNodes.length) {
      queue.push(...current.childNodes);
      continue;
    }
    if (disposition === 'attachment' || size > MAX_PREVIEW_PART_BYTES) {
      continue;
    }
    if (type === 'text/plain') {
      return { part, type, size };
    }
    if (type === 'text/html' && !htmlFallback) {
      htmlFallback = { part, type, size };
    }
  }

  return htmlFallback;
}

/** Does this bodyStructure carry a real attachment part? */
export function structureHasAttachments(node) {
  if (!node) return false;
  const queue = [node];
  while (queue.length) {
    const current = queue.shift();
    if (Array.isArray(current?.childNodes) && current.childNodes.length) {
      queue.push(...current.childNodes);
      continue;
    }
    if (String(current?.disposition ?? '').toLowerCase() === 'attachment') {
      return true;
    }
  }
  return false;
}

/**
 * Build a message row from headers + body structure, without the full source.
 * @param {{ uid: number, folder: string, headers?: Buffer, flags?: Set<string> | string[], bodyStructure?: object }} input
 * @param {string} previewSource — decoded text of the preview part (may be empty)
 */
export async function parseEnvelopeMessage(input, previewSource = '') {
  const headerBuffer = Buffer.isBuffer(input.headers)
    ? input.headers
    : Buffer.from(String(input.headers ?? ''));
  const parsed = await simpleParser(headerBuffer);

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
  const replyTo = formatFromAddress(
    parsed.replyTo?.value?.map((row) => ({ name: row.name, address: row.address })) ?? [],
  );

  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(previewSource);
  const bodyText = looksHtml ? stripHtmlToText(previewSource) : previewSource;
  const bodyPreview = buildBodyPreview(bodyText);
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');
  const date = parsed.date ? parsed.date.toISOString() : new Date().toISOString();

  return {
    id: `${input.folder}:${input.uid}`,
    uid: String(input.uid),
    messageId,
    threadId: computeThreadId({ messageId, inReplyTo, references, subject }),
    folder: input.folder,
    from,
    to,
    replyTo,
    subject,
    date,
    bodyPreview,
    bodyText,
    bodyHash,
    // Envelope sync stores text only; HTML arrives with the lazy body fetch so
    // tracking markup for unopened mail never touches disk.
    bodyComplete: false,
    hasAttachments: structureHasAttachments(input.bodyStructure),
    inReplyTo,
    references,
    flags: imapFlagsToObject(input.flags),
  };
}

/**
 * Decode one bodyPart buffer to text.
 * @param {Map<string, Buffer> | undefined} bodyParts
 * @param {string} part
 */
function readBodyPart(bodyParts, part) {
  if (!bodyParts) return '';
  const value = bodyParts instanceof Map ? bodyParts.get(part) : bodyParts?.[part];
  if (!value) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

/**
 * Fetch and store rows for a UID range.
 * @param {import('imapflow').ImapFlow} client
 * @param {string} folder
 * @param {string} range
 * @param {number} max
 */
async function fetchEnvelopeRange(client, folder, range, max) {
  /** @type {Array<Record<string, unknown>>} */
  const rows = [];
  let highestUid = 0;

  /** @type {Array<{ uid: number, flags: any, bodyStructure: any, headers: any }>} */
  const descriptors = [];
  for await (const message of client.fetch(
    range,
    { uid: true, flags: true, bodyStructure: true, headers: true },
    { uid: true },
  )) {
    descriptors.push({
      uid: message.uid,
      flags: message.flags,
      bodyStructure: message.bodyStructure,
      headers: message.headers,
    });
    if (descriptors.length >= max) {
      break;
    }
  }

  for (const descriptor of descriptors) {
    highestUid = Math.max(highestUid, descriptor.uid);
    const preview = pickPreviewPart(descriptor.bodyStructure);
    let previewText = '';
    if (preview) {
      try {
        const fetched = await client.fetchOne(
          String(descriptor.uid),
          { uid: true, bodyParts: [preview.part] },
          { uid: true },
        );
        previewText = readBodyPart(fetched?.bodyParts, preview.part);
      } catch {
        // A missing part must not abort the whole sync — the body loads lazily.
      }
    }
    rows.push(await parseEnvelopeMessage({ ...descriptor, folder }, previewText));
  }

  return { rows, highestUid };
}

/**
 * Read server flags for a set of UIDs (the reconcile pass).
 * @param {import('imapflow').ImapFlow} client
 * @param {number[]} uids
 */
async function fetchFlagsForUids(client, uids) {
  /** @type {Map<number, { seen: boolean, flagged: boolean, answered: boolean }>} */
  const flags = new Map();
  if (!uids.length) return flags;

  const range = uids.slice().sort((a, b) => a - b).join(',');
  for await (const message of client.fetch(range, { uid: true, flags: true }, { uid: true })) {
    flags.set(message.uid, imapFlagsToObject(message.flags));
  }
  return flags;
}

/**
 * Incrementally sync one folder into the mail store.
 *
 * @param {string} accountId
 * @param {{ folder?: string, limit?: number, offset?: number, full?: boolean }} options
 */
export async function syncFolderMessages(accountId, options = {}) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }

  await migrateJsonCacheIfNeeded(accountId);

  const folder = String(options.folder ?? account.folders[0] ?? 'INBOX');
  const limit = Math.min(200, Math.max(1, Number(options.limit) || DEFAULT_FETCH_LIMIT));

  const state = await getSyncState(accountId, folder);
  /** @type {{ rows: Array<Record<string, unknown>>, highestUid: number, uidValidity: string, modseq: string, reset: boolean }} */
  const result = await withMailbox(accountId, folder, async (client) => {
    const mailbox = client.mailbox;
    const uidValidity = String(mailbox?.uidValidity ?? '');
    const modseq = mailbox?.highestModseq ? String(mailbox.highestModseq) : '';
    const reset = Boolean(state.uidValidity) && Boolean(uidValidity) && state.uidValidity !== uidValidity;

    if (!mailbox?.exists) {
      return { rows: [], highestUid: 0, uidValidity, modseq, reset };
    }

    const cursor = reset || options.full ? 0 : state.highestUid;

    if (cursor > 0) {
      const { rows, highestUid } = await fetchEnvelopeRange(
        client,
        folder,
        `${cursor + 1}:*`,
        MAX_NEW_PER_SYNC,
      );
      // `uid:N:*` always returns at least the highest existing UID even when
      // nothing is newer, so drop anything at or below the cursor.
      const fresh = rows.filter((row) => Number(row.uid) > cursor);
      return { rows: fresh, highestUid: Math.max(highestUid, cursor), uidValidity, modseq, reset };
    }

    // Cold start (or uidvalidity reset): newest `limit` messages.
    const search = await client.search({ all: true }, { uid: true });
    const uids = Array.isArray(search) ? search.slice().sort((a, b) => b - a) : [];
    const pageUids = uids.slice(0, limit);
    if (!pageUids.length) {
      return { rows: [], highestUid: 0, uidValidity, modseq, reset };
    }
    const { rows, highestUid } = await fetchEnvelopeRange(
      client,
      folder,
      pageUids.slice().sort((a, b) => a - b).join(','),
      limit,
    );
    return { rows, highestUid, uidValidity, modseq, reset };
  });

  if (result.reset) {
    await resetFolderCache(accountId, folder);
  }

  await mergeMessagesIntoCache(accountId, result.rows, folder, result.highestUid);
  await setSyncState(accountId, folder, {
    uidValidity: result.uidValidity,
    highestModseq: result.modseq,
  });

  const reconciled = await reconcileFolder(accountId, folder, {
    changedSince: result.reset ? '' : state.highestModseq,
  });

  return {
    messages: result.rows,
    total: await countCachedMessages(accountId, folder),
    folder,
    synced: result.rows.length,
    reconciled,
    uidValidityReset: result.reset,
  };
}

/**
 * FLAGS-only pass over the visible window — picks up reads, stars, deletes and
 * moves performed in another mail client, which previously drifted silently.
 *
 * @param {string} accountId
 * @param {string} folder
 * @param {{ window?: number, changedSince?: string }} [options]
 */
export async function reconcileFolder(accountId, folder, options = {}) {
  const windowUids = await listCachedUids(
    accountId,
    folder,
    Number(options.window) || FLAGS_RECONCILE_WINDOW,
  );
  if (!windowUids.length) {
    return { updated: 0, removed: 0, checked: 0 };
  }

  const serverFlags = await withMailbox(accountId, folder, async (client) => {
    // When the server advertises CONDSTORE and its HIGHESTMODSEQ has not moved
    // since the last pass, nothing in the folder changed — skip the fetch
    // entirely. A plain FLAGS fetch already reports both flags and existence,
    // so `changedSince` buys nothing beyond this early-out.
    const modseq = client.mailbox?.highestModseq ? String(client.mailbox.highestModseq) : '';
    if (
      client.enabled?.has?.('CONDSTORE') &&
      options.changedSince &&
      modseq &&
      modseq === String(options.changedSince)
    ) {
      return null;
    }
    return fetchFlagsForUids(client, windowUids);
  });

  if (!serverFlags) {
    return { updated: 0, removed: 0, checked: 0, skipped: 'unchanged_modseq' };
  }

  const applied = await reconcileFolderFlags(accountId, folder, serverFlags, windowUids);
  return { ...applied, checked: windowUids.length };
}

/**
 * Download and cache the full body (and attachment metadata) for one message.
 * Called on first open — sync itself only stores headers + a text preview.
 *
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ force?: boolean }} [options]
 */
export async function ensureMessageBody(accountId, messageKey, options = {}) {
  const message = await getCachedMessage(accountId, messageKey);
  if (!message) {
    throw new Error('Cached message not found');
  }

  if (!options.force) {
    const cached = await getCachedBody(accountId, messageKey);
    if (cached?.complete) {
      return { ...message, bodyText: cached.bodyText, bodyHtml: cached.bodyHtml, cached: true };
    }
  }

  const folder = String(message.folder ?? 'INBOX');
  const uid = Number(message.uid);
  if (!Number.isFinite(uid)) {
    throw new Error('Message uid is invalid');
  }

  const source = await withMailbox(accountId, folder, async (client) => {
    const downloaded = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
    if (!downloaded?.source) {
      return null;
    }
    return Buffer.isBuffer(downloaded.source)
      ? downloaded.source
      : Buffer.from(String(downloaded.source));
  });

  if (!source) {
    throw new Error('Message source unavailable on the server');
  }

  const parsed = await parseRawMessage(source, { uid, folder, flags: [] });
  const updated = await saveCachedBody(accountId, messageKey, {
    bodyText: parsed.bodyText,
    bodyHtml: parsed.bodyHtml,
    bodyHash: parsed.bodyHash,
    attachments: parsed.attachments,
    complete: true,
  });

  return { ...updated, cached: false };
}
