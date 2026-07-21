/**
 * Agent tools: list_mail, search_mail, get_thread, draft_reply,
 * summarize_inbox, generate_reply_variants, email_action.
 */

import { resolveDefaultAccountId } from './accounts.js';
import { listCachedMessages, listCachedThread, searchCachedMessages } from './cache.js';
import { MAX_TOOL_LIMIT } from './imap.js';
import { draftReply } from './smtp.js';
import { getOrBuildInboxSummary, generateReplyVariants } from './agent.js';
import { semanticRerankMessages } from './semantic-search.js';
import { enqueuePendingAction } from './pending-actions.js';
import { wrapUntrusted } from '../security/untrusted.js';
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
 * Full-text search (FTS5) with semantic rerank when embeddings are enabled.
 * @param {Record<string, unknown>} args
 */
export async function toolSearchMail(args) {
  const query = String(args.query ?? '').trim();
  if (!query) {
    return 'Error: query is required';
  }

  const accountId =
    typeof args.accountId === 'string' && args.accountId.trim()
      ? args.accountId.trim()
      : await resolveDefaultAccountId();

  if (!accountId) {
    return 'Error: no email accounts configured';
  }

  const limitRaw = args.limit !== undefined ? Number(args.limit) : MAX_TOOL_LIMIT;
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_TOOL_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : MAX_TOOL_LIMIT;

  const { messages, total } = await searchCachedMessages(accountId, {
    query,
    limit,
  });
  if (messages.length === 0) {
    return `No messages matched "${query}".`;
  }

  const ranked = await semanticRerankMessages(accountId, query, messages);
  const lines = ranked.map((row) => {
    const triage = row.triage && typeof row.triage === 'object' ? row.triage : null;
    const summary = triage?.summary ? ` — ${triage.summary}` : '';
    return `- ${row.date} | ${row.from} | ${row.subject} (id=${row.id}, thread=${row.threadId})${summary}`;
  });

  const header =
    total > ranked.length
      ? `Matches for "${query}" (${ranked.length} of ${total}):`
      : `Matches for "${query}" (${ranked.length}):`;
  return `${header}\n${lines.join('\n')}`;
}

/** Per-message body budget inside get_thread output. */
const GET_THREAD_BODY_CHARS = 1500;

/**
 * Return one full thread with bodies fenced as untrusted content.
 * @param {Record<string, unknown>} args
 */
export async function toolGetThread(args) {
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

  const blocks = thread.map((row) => {
    const body = String(row.bodyText ?? row.bodyPreview ?? '');
    const clipped =
      body.length > GET_THREAD_BODY_CHARS ? `${body.slice(0, GET_THREAD_BODY_CHARS)}…` : body;
    return [
      `From: ${row.from}`,
      `Date: ${row.date}`,
      `Subject: ${row.subject}`,
      `(id=${row.id})`,
      wrapUntrusted(clipped, { source: 'email' }),
    ].join('\n');
  });

  return [`Thread ${threadId} (${thread.length} messages, untrusted bodies fenced):`, ...blocks].join(
    '\n\n---\n\n',
  );
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
  const messageIds = Array.isArray(args.messageIds)
    ? args.messageIds.map(String).map((id) => id.trim()).filter(Boolean)
    : [];

  if (!action || (!messageId && messageIds.length === 0)) {
    return 'Error: action and messageId (or messageIds) are required';
  }

  const accountId =
    typeof args.accountId === 'string' && args.accountId.trim()
      ? args.accountId.trim()
      : await resolveDefaultAccountId();

  if (!accountId) {
    return 'Error: no email accounts configured';
  }

  // Batch mutations from the agent are suggestions, not actions: they land in
  // the review queue (§3.7) and run only when the user applies them.
  if (messageIds.length > 1) {
    if (!['archive', 'delete', 'read', 'unread', 'flag'].includes(action)) {
      return `Error: unsupported action "${action}" (use archive, delete, read, unread, flag)`;
    }
    const pending = await enqueuePendingAction(accountId, {
      source: 'chat_agent',
      label: `${action} ${messageIds.length} messages`,
      action,
      messageIds,
      detail: 'Suggested by chat agent',
    });
    if (pending.state === 'applied') {
      return `Applied ${action} to ${messageIds.length} messages (pre-approved by the user).`;
    }
    return `Queued ${action} for ${messageIds.length} messages as a pending action — the user must apply it from the Email dashboard review strip.`;
  }

  const singleId = messageId || messageIds[0];

  if (action === 'archive') {
    await archiveMessage(accountId, singleId);
    return `Archived message ${singleId}`;
  }
  if (action === 'delete') {
    await deleteMessage(accountId, singleId);
    return `Deleted message ${singleId}`;
  }
  if (action === 'read') {
    await setMessageFlags(accountId, singleId, { seen: true });
    return `Marked read: ${singleId}`;
  }
  if (action === 'unread') {
    await setMessageFlags(accountId, singleId, { seen: false });
    return `Marked unread: ${singleId}`;
  }
  if (action === 'flag') {
    await setMessageFlags(accountId, singleId, { flagged: true });
    return `Flagged: ${singleId}`;
  }

  return `Error: unsupported action "${action}" (use archive, delete, read, unread, flag)`;
}
