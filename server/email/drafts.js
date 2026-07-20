/**
 * Draft persistence.
 *
 * Before this, closing or discarding a compose pane destroyed whatever had been
 * typed with no way back — the single most expensive thing a mail client can do
 * to someone. Drafts now autosave locally as you type, survive a restart, and
 * optionally get mirrored into the account's IMAP Drafts folder so other
 * clients see them too.
 *
 * The local row is the source of truth: an IMAP mirror that fails (no Drafts
 * folder, offline, permission denied) must never cost the user their text.
 */

import { randomUUID } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { getMailDb } from './store.js';
import { getEmailAccount } from './accounts.js';
import { listFoldersCached, withMailbox } from './imap-session.js';
import { resolveMailFolder } from './imap-actions.js';
import { sanitizeEmailHtml } from './sanitize-html.js';

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {Record<string, any>} row
 */
function rowToDraft(row) {
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.thread_id ?? '',
    replyToKey: row.reply_to_key ?? '',
    mode: row.mode ?? 'new',
    to: row.to_addr ?? '',
    cc: row.cc ?? '',
    bcc: row.bcc ?? '',
    subject: row.subject ?? '',
    body: row.body ?? '',
    bodyHtml: row.body_html ?? '',
    inReplyTo: row.in_reply_to ?? '',
    references: row.references_text ?? '',
    attachments: parseJson(row.attachments_json, []),
    imapUid: row.imap_uid ?? '',
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

/**
 * Create or update a draft. Called on every autosave tick, so it must be cheap
 * and must never throw on partial input — a draft is by definition incomplete.
 *
 * @param {string} accountId
 * @param {Record<string, unknown>} input
 */
export async function saveDraft(accountId, input = {}) {
  const db = getMailDb(accountId);
  const id = String(input.id ?? '').trim() || randomUUID();
  const existing = db.prepare('SELECT created_at FROM drafts WHERE id = ?').get(id);

  // Attachment bytes stay out of the row: only the metadata is persisted, so a
  // 20MB deck does not get rewritten to disk on every keystroke.
  const attachments = Array.isArray(input.attachments)
    ? input.attachments.map((att) => ({
        filename: String(att?.filename ?? 'attachment'),
        contentType: String(att?.contentType ?? 'application/octet-stream'),
        size: Number(att?.size) || 0,
      }))
    : [];

  const values = {
    id,
    thread_id: String(input.threadId ?? ''),
    reply_to_key: String(input.replyToKey ?? ''),
    mode: String(input.mode ?? 'new'),
    to_addr: String(input.to ?? ''),
    cc: String(input.cc ?? ''),
    bcc: String(input.bcc ?? ''),
    subject: String(input.subject ?? ''),
    body: String(input.body ?? ''),
    body_html: typeof input.bodyHtml === 'string' ? input.bodyHtml : null,
    in_reply_to: String(input.inReplyTo ?? ''),
    references_text: String(input.references ?? ''),
    attachments_json: JSON.stringify(attachments),
    created_at: existing?.created_at || nowIso(),
    updated_at: nowIso(),
  };

  db.prepare(
    `INSERT INTO drafts (
       id, thread_id, reply_to_key, mode, to_addr, cc, bcc, subject, body, body_html,
       in_reply_to, references_text, attachments_json, created_at, updated_at
     ) VALUES (
       @id, @thread_id, @reply_to_key, @mode, @to_addr, @cc, @bcc, @subject, @body, @body_html,
       @in_reply_to, @references_text, @attachments_json, @created_at, @updated_at
     )
     ON CONFLICT(id) DO UPDATE SET
       thread_id = excluded.thread_id,
       reply_to_key = excluded.reply_to_key,
       mode = excluded.mode,
       to_addr = excluded.to_addr,
       cc = excluded.cc,
       bcc = excluded.bcc,
       subject = excluded.subject,
       body = excluded.body,
       body_html = excluded.body_html,
       in_reply_to = excluded.in_reply_to,
       references_text = excluded.references_text,
       attachments_json = excluded.attachments_json,
       updated_at = excluded.updated_at`,
  ).run(values);

  return getDraft(accountId, id);
}

/**
 * @param {string} accountId
 * @param {string} draftId
 */
export async function getDraft(accountId, draftId) {
  const row = getMailDb(accountId).prepare('SELECT * FROM drafts WHERE id = ?').get(String(draftId));
  return rowToDraft(row);
}

/**
 * Newest first.
 * @param {string} accountId
 * @param {{ threadId?: string, limit?: number }} [options]
 */
export async function listDrafts(accountId, options = {}) {
  const db = getMailDb(accountId);
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
  const threadId = String(options.threadId ?? '');

  const rows = threadId
    ? db
        .prepare('SELECT * FROM drafts WHERE thread_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(threadId, limit)
    : db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC LIMIT ?').all(limit);

  return rows.map(rowToDraft);
}

/**
 * @param {string} accountId
 * @param {string} draftId
 */
export async function deleteDraft(accountId, draftId) {
  const info = getMailDb(accountId)
    .prepare('DELETE FROM drafts WHERE id = ?')
    .run(String(draftId));
  return { deleted: info.changes > 0 };
}

/**
 * Build the RFC822 bytes for a draft (also what the IMAP mirror appends).
 * @param {Record<string, unknown>} draft
 * @param {{ fromAddress?: string, username?: string }} account
 */
export async function composeDraftSource(draft, account) {
  const from = String(account.fromAddress ?? '').trim() || String(account.username ?? '');
  const compiled = new MailComposer({
    from,
    to: String(draft.to ?? '') || undefined,
    cc: String(draft.cc ?? '') || undefined,
    bcc: String(draft.bcc ?? '') || undefined,
    subject: String(draft.subject ?? ''),
    text: String(draft.body ?? ''),
    html: sanitizeEmailHtml(draft.bodyHtml) || undefined,
    inReplyTo: String(draft.inReplyTo ?? '') || undefined,
    references: String(draft.references ?? '') || undefined,
  }).compile();
  return compiled.build();
}

/**
 * Mirror a draft into the account's IMAP Drafts folder.
 *
 * Best-effort by design: the local row already holds the text, so a failure
 * here is reported and dropped rather than surfaced as a lost draft. The
 * previous mirror is expunged first so the folder does not fill with one
 * message per autosave.
 *
 * @param {string} accountId
 * @param {string} draftId
 */
export async function syncDraftToImap(accountId, draftId) {
  const draft = await getDraft(accountId, draftId);
  if (!draft) {
    throw new Error('Draft not found');
  }

  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }

  let folders;
  try {
    folders = await listFoldersCached(accountId);
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : 'Folder list failed' };
  }

  const target = resolveMailFolder(folders, '', 'drafts');
  if (!target) {
    return { synced: false, reason: 'no_drafts_folder' };
  }

  const raw = await composeDraftSource(draft, account);
  const previousUid = Number(draft.imapUid);

  try {
    const uid = await withMailbox(accountId, null, async (client) => {
      const appended = await client.append(target, raw, ['\\Draft', '\\Seen']);
      return appended?.uid ?? 0;
    });

    if (Number.isFinite(previousUid) && previousUid > 0) {
      // Drop the superseded copy; a failure here is cosmetic clutter, not data
      // loss, so it must not undo the append we just made.
      try {
        await withMailbox(accountId, target, async (client) => {
          await client.messageFlagsAdd(previousUid, ['\\Deleted'], { uid: true });
          await client.messageDelete(previousUid, { uid: true });
        });
      } catch {
        /* the stale draft stays visible until the next expunge */
      }
    }

    getMailDb(accountId)
      .prepare('UPDATE drafts SET imap_uid = ? WHERE id = ?')
      .run(String(uid || ''), draftId);

    return { synced: true, folder: target, uid: String(uid || '') };
  } catch (err) {
    return {
      synced: false,
      folder: target,
      error: err instanceof Error ? err.message : 'Draft APPEND failed',
    };
  }
}
