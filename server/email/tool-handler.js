/**
 * Agent tools: list_mail, draft_reply, summarize_inbox, generate_reply_variants, email_action.
 */

import { resolveDefaultAccountId } from './accounts.js';
import { listCachedMessages, listCachedThread } from './cache.js';
import { MAX_TOOL_LIMIT } from './imap.js';
import { draftReply } from './smtp.js';
import { getOrBuildInboxSummary, generateReplyVariants } from './agent.js';
import {
  archiveMessage,
  deleteMessage,
  setMessageFlags,
} from './mail-actions.js';

/**
 * @param {Record<string, unknown>} args
 */
export async function toolListMail(args) {
  const accountId =
    typeof args.accountId === 'string' && args.accountId.trim()
      ? args.accountId.trim()
      : await resolveDefaultAccountId();

  if (!accountId) {
    return 'Error: no email accounts configured';
  }

  const folder = typeof args.folder === 'string' ? args.folder.trim() : undefined;
  const query = typeof args.query === 'string' ? args.query.trim() : undefined;
  const limitRaw = args.limit !== undefined ? Number(args.limit) : MAX_TOOL_LIMIT;
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_TOOL_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : MAX_TOOL_LIMIT;

  const { messages, total } = await listCachedMessages(accountId, {
    folder,
    query,
    offset: 0,
    limit,
  });

  if (messages.length === 0) {
    return 'No cached messages found. Run a sync from the Email app first.';
  }

  const lines = messages.map((row) => {
    const triage = row.triage && typeof row.triage === 'object' ? row.triage : null;
    const urgency = triage?.urgency ? ` [${triage.urgency}]` : '';
    const summary = triage?.summary ? ` — ${triage.summary}` : '';
    return `- ${row.date} | ${row.from} | ${row.subject}${urgency} (id=${row.id})${summary}`;
  });

  const header =
    total > messages.length
      ? `Recent mail (${messages.length} of ${total}):`
      : `Recent mail (${messages.length}):`;

  return `${header}\n${lines.join('\n')}`;
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolDraftReply(args) {
  const threadId = String(args.threadId ?? '').trim();
  if (!threadId) {
    return 'Error: threadId is required';
  }

  const accountId =
    typeof args.accountId === 'string' && args.accountId.trim()
      ? args.accountId.trim()
      : await resolveDefaultAccountId();

  if (!accountId) {
    return 'Error: no email accounts configured';
  }

  const thread = await listCachedThread(accountId, threadId);
  if (thread.length === 0) {
    return 'Error: thread not found in cache — sync inbox first';
  }

  const draft = await draftReply({
    accountId,
    threadId,
    instructions: typeof args.instructions === 'string' ? args.instructions : undefined,
  });

  return [
    'Draft reply (not sent):',
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    '',
    draft.body,
    '',
    draft.note,
  ].join('\n');
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolSummarizeInbox(args) {
  const accountId =
    typeof args.accountId === 'string' && args.accountId.trim()
      ? args.accountId.trim()
      : await resolveDefaultAccountId();

  if (!accountId) {
    return 'Error: no email accounts configured';
  }

  const summary = await getOrBuildInboxSummary(accountId);
  const lines = [
    summary.text,
    '',
    'Highlights:',
    ...summary.highlights.map(
      (row) =>
        `- [${row.urgency}] ${row.subject} — ${row.summary} (thread=${row.threadId})`,
    ),
  ];
  return lines.join('\n');
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolGenerateReplyVariants(args) {
  const threadId = String(args.threadId ?? '').trim();
  if (!threadId) {
    return 'Error: threadId is required';
  }

  const accountId =
    typeof args.accountId === 'string' && args.accountId.trim()
      ? args.accountId.trim()
      : await resolveDefaultAccountId();

  if (!accountId) {
    return 'Error: no email accounts configured';
  }

  const result = await generateReplyVariants(accountId, threadId, {
    instructions: typeof args.instructions === 'string' ? args.instructions : undefined,
    messageKey: typeof args.messageId === 'string' ? args.messageId : undefined,
  });

  return result.variants
    .map((row) => `- ${row.label}: ${row.body.slice(0, 200)}${row.body.length > 200 ? '…' : ''}`)
    .join('\n');
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolEmailAction(args) {
  const action = String(args.action ?? '').trim().toLowerCase();
  const messageId = String(args.messageId ?? '').trim();
  if (!action || !messageId) {
    return 'Error: action and messageId are required';
  }

  const accountId =
    typeof args.accountId === 'string' && args.accountId.trim()
      ? args.accountId.trim()
      : await resolveDefaultAccountId();

  if (!accountId) {
    return 'Error: no email accounts configured';
  }

  if (action === 'archive') {
    await archiveMessage(accountId, messageId);
    return `Archived message ${messageId}`;
  }
  if (action === 'delete') {
    await deleteMessage(accountId, messageId);
    return `Deleted message ${messageId}`;
  }
  if (action === 'read') {
    await setMessageFlags(accountId, messageId, { seen: true });
    return `Marked read: ${messageId}`;
  }
  if (action === 'unread') {
    await setMessageFlags(accountId, messageId, { seen: false });
    return `Marked unread: ${messageId}`;
  }
  if (action === 'flag') {
    await setMessageFlags(accountId, messageId, { flagged: true });
    return `Flagged: ${messageId}`;
  }

  return `Error: unsupported action "${action}" (use archive, delete, read, unread, flag)`;
}
