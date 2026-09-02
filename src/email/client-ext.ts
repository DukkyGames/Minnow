/**
 * Extended email API client — dashboard, actions, SSE, automations.
 */

import type {
  EmailAccount,
  EmailAutomation,
  EmailAutomationDryRun,
  EmailAutomationRun,
  EmailDraft,
  EmailFollowup,
  EmailInboxCategory,
  EmailInboxSummary,
  EmailMessage,
  EmailNarrativeDigest,
  EmailPendingAction,
  EmailCatchupSummary,
  OutboxEntry,
  ReplyVariant,
} from './client';
import { withSessionToken } from '../api/session-token.ts';

export type {
  EmailAutomation,
  EmailAutomationDryRun,
  EmailAutomationRun,
  EmailFollowup,
  EmailInboxSummary,
  EmailNarrativeDigest,
  EmailPendingAction,
  EmailCatchupSummary,
  ReplyVariant,
};

async function parseJson<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : res.statusText);
  }
  return payload;
}

export async function fetchInboxSummary(accountId: string): Promise<{
  summary: EmailInboxSummary;
  unreadByFolder: Record<string, number>;
  digest: EmailNarrativeDigest | null;
  pendingActions: EmailPendingAction[];
  followups: EmailFollowup[];
}> {
  const res = await fetch(`/api/email/accounts/${encodeURIComponent(accountId)}/summary`);
  return parseJson(res);
}

export async function queueDigestActionGroup(
  accountId: string,
  groupId: string,
): Promise<{ pending: EmailPendingAction }> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/digest/groups/${encodeURIComponent(groupId)}/queue`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  return parseJson(res);
}

export async function applyPendingEmailAction(
  accountId: string,
  actionId: string,
  options?: { alwaysAllow?: boolean },
): Promise<{ action: EmailPendingAction }> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/pending-actions/${encodeURIComponent(actionId)}/apply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alwaysAllow: options?.alwaysAllow === true }),
    },
  );
  return parseJson(res);
}

export async function dismissPendingEmailAction(
  accountId: string,
  actionId: string,
): Promise<{ action: EmailPendingAction }> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/pending-actions/${encodeURIComponent(actionId)}/dismiss`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  return parseJson(res);
}

export async function sendPriorityFeedback(
  accountId: string,
  sender: string,
  level: 'high' | 'low' | '',
): Promise<{ sender: string; level: string }> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/priority-feedback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, level }),
    },
  );
  return parseJson(res);
}

/** File a conversation into a local inbox tab (Primary / Social / Other). */
export async function setEmailThreadCategory(
  accountId: string,
  threadId: string,
  category: EmailInboxCategory,
  options?: { rememberSender?: boolean; sender?: string },
): Promise<{
  threadId: string;
  category: EmailInboxCategory;
  override: { sender: string; category: string } | null;
}> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/threads/${encodeURIComponent(threadId)}/category`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category,
        rememberSender: options?.rememberSender === true,
        sender: options?.sender,
      }),
    },
  );
  return parseJson(res);
}

export async function dismissEmailFollowup(
  accountId: string,
  followupId: string,
): Promise<{ followup: EmailFollowup }> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/followups/${encodeURIComponent(followupId)}/dismiss`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  return parseJson(res);
}

export async function dismissAttentionHighlight(
  accountId: string,
  messageId: string,
): Promise<{ messageId: string; dismissed: boolean }> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/highlights/${encodeURIComponent(messageId)}/dismiss`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  return parseJson(res);
}

export async function requestThreadSummary(
  accountId: string,
  threadId: string,
  options?: { force?: boolean },
): Promise<{ eligible: boolean; summary: EmailCatchupSummary | null }> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/threads/${encodeURIComponent(threadId)}/summary`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: options?.force === true }),
    },
  );
  return parseJson(res);
}

export async function suggestEmailSubject(body: string): Promise<{ subject: string }> {
  const res = await fetch('/api/email/suggest-subject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return parseJson(res);
}

export async function fetchEmailMessagesExtended(
  accountId: string,
  query?: {
    folder?: string;
    offset?: number;
    limit?: number;
    search?: string;
    filter?: 'all' | 'unread' | 'flagged' | 'snoozed';
  },
): Promise<{ messages: EmailMessage[]; total: number; offset: number; limit: number }> {
  const params = new URLSearchParams();
  if (query?.folder) params.set('folder', query.folder);
  if (query?.offset !== undefined) params.set('offset', String(query.offset));
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.search) params.set('query', query.search);
  if (query?.filter && query.filter !== 'all') params.set('filter', query.filter);
  const qs = params.toString();
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/messages${qs ? `?${qs}` : ''}`,
  );
  return parseJson(res);
}

export async function setEmailMessageFlags(
  accountId: string,
  messageId: string,
  flags: { seen?: boolean; flagged?: boolean },
): Promise<void> {
  const res = await fetch(`/api/email/messages/${encodeURIComponent(messageId)}/flags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, ...flags }),
  });
  await parseJson(res);
}

export async function bulkEmailAction(input: {
  accountId: string;
  ids: string[];
  action: 'read' | 'unread' | 'flag' | 'unflag' | 'archive' | 'delete' | 'move' | 'spam';
  destFolder?: string;
}): Promise<{ ok: boolean; failed: number }> {
  const res = await fetch('/api/email/messages/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

/** Mark every unread message in a folder (optional search) as read. */
export async function markAllEmailRead(
  accountId: string,
  input: { folder: string; query?: string },
): Promise<{ ok: boolean; attempted: number; updated: number; failed: number }> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/messages/mark-all-read`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder: input.folder,
        query: input.query ?? '',
      }),
    },
  );
  return parseJson(res);
}

export async function archiveEmailMessage(accountId: string, messageId: string): Promise<void> {
  const res = await fetch(`/api/email/messages/${encodeURIComponent(messageId)}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  await parseJson(res);
}

export async function moveEmailMessage(
  accountId: string,
  messageId: string,
  destFolder: string,
): Promise<void> {
  const res = await fetch(`/api/email/messages/${encodeURIComponent(messageId)}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, destFolder }),
  });
  await parseJson(res);
}

export async function deleteEmailMessage(
  accountId: string,
  messageId: string,
  permanent = false,
): Promise<void> {
  const params = new URLSearchParams({ accountId });
  if (permanent) params.set('permanent', '1');
  const res = await fetch(
    `/api/email/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
    { method: 'DELETE' },
  );
  await parseJson(res);
}

export async function regenerateReplyVariants(input: {
  accountId: string;
  messageId: string;
  threadId: string;
  instructions?: string;
}): Promise<{ variants: ReplyVariant[] }> {
  const res = await fetch(
    `/api/email/messages/${encodeURIComponent(input.messageId)}/reply-variants`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return parseJson(res);
}

/** Queue a reply variant. Recallable during its undo window, like any send. */
export async function sendReplyVariant(input: {
  accountId: string;
  messageId: string;
  threadId: string;
  variantId: string;
}): Promise<{ queued: boolean; entry: OutboxEntry }> {
  const res = await fetch(
    `/api/email/messages/${encodeURIComponent(input.messageId)}/reply-variants/${encodeURIComponent(input.variantId)}/send`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return parseJson(res);
}

export async function fetchAutomations(): Promise<EmailAutomation[]> {
  const res = await fetch('/api/email/automations');
  const data = await parseJson<{ rules: EmailAutomation[] }>(res);
  return data.rules;
}

export async function saveAutomation(
  input: Partial<EmailAutomation> & { accountId: string },
): Promise<EmailAutomation> {
  const res = await fetch('/api/email/automations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ rule: EmailAutomation }>(res);
  return data.rule;
}

export async function updateAutomationRule(
  id: string,
  patch: Partial<EmailAutomation>,
): Promise<EmailAutomation> {
  const res = await fetch(`/api/email/automations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await parseJson<{ rule: EmailAutomation }>(res);
  return data.rule;
}

export async function deleteAutomationRule(id: string): Promise<void> {
  const res = await fetch(`/api/email/automations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJson(res);
}

export async function fetchAutomationRuns(id: string): Promise<EmailAutomationRun[]> {
  const res = await fetch(`/api/email/automations/${encodeURIComponent(id)}/runs`);
  const data = await parseJson<{ runs: EmailAutomationRun[] }>(res);
  return data.runs;
}

export async function dryRunAutomation(
  rule: Partial<EmailAutomation> & { accountId: string },
  days?: number,
): Promise<EmailAutomationDryRun> {
  const res = await fetch('/api/email/automations/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: rule.accountId, rule, days }),
  });
  return parseJson<EmailAutomationDryRun>(res);
}

/**
 * Subscribe to email SSE events; returns unsubscribe function.
 */
export function subscribeEmailEvents(
  onEvent: (type: string, payload: Record<string, unknown>) => void,
): () => void {
  const source = new EventSource(withSessionToken('/api/email/events'));

  const handler = (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as Record<string, unknown>;
      onEvent(event.type || String(payload.type ?? ''), payload);
    } catch {}
  };

  source.addEventListener('summary_updated', handler);
  source.addEventListener('message_new', handler);
  source.addEventListener('flags_changed', handler);
  source.addEventListener('automation_notify', handler);
  source.addEventListener('digest_updated', handler);
  source.addEventListener('pending_actions_updated', handler);
  source.addEventListener('followups_updated', handler);
  source.addEventListener('sync_progress', handler);

  return () => {
    source.close();
  };
}

export async function fetchEmailFolders(
  accountId: string,
): Promise<Array<{ path: string; name: string }>> {
  const res = await fetch(`/api/email/accounts/${encodeURIComponent(accountId)}/folders`);
  const data = await parseJson<{ folders: Array<{ path: string; name: string }> }>(res);
  return data.folders;
}

export type { EmailAccount, EmailDraft, EmailMessage };
