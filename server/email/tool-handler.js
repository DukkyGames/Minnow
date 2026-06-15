/**
 * Agent tools: list_mail and draft_reply.
 */

import { resolveDefaultAccountId } from './accounts.js';
import { listCachedMessages, listCachedThread } from './cache.js';
import { MAX_TOOL_LIMIT } from './imap.js';
import { draftReply } from './smtp.js';

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
