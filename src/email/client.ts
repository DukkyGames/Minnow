/**
 * Email API client for the MinnowOS Email app.
 */

export interface EmailAccount {
  id: string;
  label: string;
  imap: { host: string; port: number; tls: boolean };
  smtp?: { host: string; port: number; starttls: boolean };
  username: string;
  hasPassword?: boolean;
  fromAddress?: string;
  isDefault: boolean;
  pollingEnabled: boolean;
  pollingIntervalMinutes: number;
  folders: string[];
}

export interface EmailMessage {
  id: string;
  uid: string;
  messageId?: string;
  threadId: string;
  folder: string;
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  date: string;
  bodyPreview: string;
  bodyText?: string;
  bodyHtml?: string;
  bodyHash?: string;
  hasAttachments: boolean;
  attachments?: Array<{ filename: string; contentType: string; size: number }>;
  inReplyTo?: string;
  references?: string[];
  flags?: {
    seen: boolean;
    flagged: boolean;
    answered?: boolean;
  };
  replyVariants?: ReplyVariant[];
  triage?: {
    summary: string;
    tags: string[];
    urgency: 'low' | 'normal' | 'high';
    cachedAt: string;
  };
}

export interface ReplyVariant {
  id: string;
  label: string;
  body: string;
  createdAt: string;
}

export interface EmailInboxSummary {
  generatedAt: string;
  text: string;
  stats: { high: number; normal: number; low: number };
  unread: number;
  highlights: Array<{
    threadId: string;
    messageId: string;
    subject: string;
    from: string;
    urgency: string;
    summary: string;
    unseen: boolean;
    replyVariants: ReplyVariant[];
  }>;
}

export interface EmailAutomation {
  id: string;
  name: string;
  enabled: boolean;
  accountId: string;
  trigger: 'on_new_message' | 'on_high_urgency' | 'on_tag_match';
  action: 'triage' | 'generate_variants' | 'notify' | 'run_scheduler_job';
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EmailDraft {
  accountId: string;
  threadId: string;
  to: string;
  subject: string;
  inReplyTo?: string;
  references?: string;
  body: string;
  note?: string;
}

async function parseJson<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : res.statusText);
  }
  return payload;
}

export async function fetchEmailAccounts(): Promise<EmailAccount[]> {
  const res = await fetch('/api/email/accounts');
  const data = await parseJson<{ accounts: EmailAccount[] }>(res);
  return data.accounts;
}

export async function createEmailAccount(input: Record<string, unknown>): Promise<EmailAccount> {
  const res = await fetch('/api/email/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ account: EmailAccount }>(res);
  return data.account;
}

export async function updateEmailAccount(
  id: string,
  input: Record<string, unknown>,
): Promise<EmailAccount> {
  const res = await fetch(`/api/email/accounts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ account: EmailAccount }>(res);
  return data.account;
}

export async function deleteEmailAccount(id: string): Promise<void> {
  const res = await fetch(`/api/email/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJson(res);
}

export async function testEmailAccount(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/email/accounts/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });
  return parseJson(res);
}

export async function syncEmailFolder(
  accountId: string,
  folder?: string,
): Promise<{ synced: number; folder: string }> {
  const res = await fetch(`/api/email/accounts/${encodeURIComponent(accountId)}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder }),
  });
  return parseJson(res);
}

export async function fetchEmailMessages(
  accountId: string,
  query?: { folder?: string; offset?: number; limit?: number; query?: string; filter?: string },
): Promise<{ messages: EmailMessage[]; total: number }> {
  const params = new URLSearchParams();
  if (query?.folder) params.set('folder', query.folder);
  if (query?.offset !== undefined) params.set('offset', String(query.offset));
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.query) params.set('query', query.query);
  if (query?.filter) params.set('filter', query.filter);
  const qs = params.toString();
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/messages${qs ? `?${qs}` : ''}`,
  );
  return parseJson(res);
}

export async function fetchEmailThread(
  accountId: string,
  threadId: string,
): Promise<{ messages: EmailMessage[] }> {
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/threads/${encodeURIComponent(threadId)}`,
  );
  return parseJson(res);
}

export async function triageEmailMessage(
  accountId: string,
  messageId: string,
): Promise<EmailMessage['triage']> {
  const res = await fetch(`/api/email/messages/${encodeURIComponent(messageId)}/triage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  const data = await parseJson<{ triage: EmailMessage['triage'] }>(res);
  return data.triage;
}

export async function draftEmailReply(input: {
  accountId: string;
  threadId: string;
  instructions?: string;
}): Promise<EmailDraft> {
  const res = await fetch('/api/email/draft-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ draft: EmailDraft }>(res);
  return data.draft;
}

export type ComposeImproveMode = 'improve' | 'correct' | 'shorten' | 'expand';

export async function improveEmailText(input: {
  text: string;
  fullBody?: string;
  threadContext?: string;
  mode?: ComposeImproveMode;
  instructions?: string;
}): Promise<{ text: string }> {
  const res = await fetch('/api/email/improve-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function sendEmailMessage(input: {
  accountId: string;
  to: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
  confirmed: boolean;
}): Promise<{ ok: boolean; messageId?: string }> {
  const res = await fetch('/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}
