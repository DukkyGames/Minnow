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
  /** Plain text appended below the body of a new message. */
  signature?: string;
  /** Classify sent mail for "Waiting on" reply tracking (default on). */
  followupTracking?: boolean;
  /** Opt-in local writing-style profile injected into AI drafts. */
  styleProfileEnabled?: boolean;
}

export interface EmailAttachment {
  /** Part ordinal — how the download route addresses this attachment. */
  index: number;
  filename: string;
  contentType: string;
  size: number;
  /** Bracket-stripped Content-ID, for parts referenced as `cid:` in the body. */
  contentId?: string;
  /** Inline parts render in the body; they are not offered as downloads. */
  inline?: boolean;
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
  /** False until the full RFC822 source has been parsed on first open. */
  bodyComplete?: boolean;
  bodyHash?: string;
  hasAttachments: boolean;
  attachments?: EmailAttachment[];
  /** ISO timestamp the message is hidden until; empty when not snoozed. */
  snoozeUntil?: string;
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
    category?: EmailTriageCategory;
    deadline?: string;
    people?: string[];
    cachedAt: string;
  };
}

export type EmailTriageCategory =
  | 'needs_reply'
  | 'fyi'
  | 'newsletter'
  | 'notification'
  | 'receipt'
  | 'calendar'
  | 'security';

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
    category?: EmailTriageCategory;
    deadline?: string;
    people?: string[];
    priority?: number;
    priorityBucket?: 'high' | 'normal' | 'low';
    summary: string;
    unseen: boolean;
    replyVariants: ReplyVariant[];
  }>;
}

export interface EmailNarrativeDigest {
  narrative: string;
  actionGroups: Array<{
    id: string;
    label: string;
    action: 'archive' | 'read' | 'flag';
    messageIds: string[];
    threadIds: string[];
  }>;
  generatedAt: string;
}

export interface EmailPendingAction {
  id: string;
  source: string;
  label: string;
  action: string;
  messageIds: string[];
  threadIds: string[];
  destFolder: string;
  state: 'pending' | 'applied' | 'dismissed' | 'failed';
  detail: string;
  createdAt: string;
  resolvedAt: string;
}

export interface EmailFollowup {
  id: string;
  threadId: string;
  messageId: string;
  to: string;
  subject: string;
  sentAt: string;
  expectedBy: string;
  state: 'waiting' | 'satisfied' | 'dismissed';
  notified: boolean;
  satisfiedAt: string;
  satisfiedBy: string;
}

export interface EmailCatchupSummary {
  text: string;
  bodyHash: string;
  generatedAt: string;
  messageCount: number;
}

export type EmailAutomationTrigger = 'on_new_message' | 'on_high_urgency' | 'on_tag_match';

export type EmailAutomationConditionField =
  | 'sender'
  | 'domain'
  | 'subject'
  | 'has_attachment'
  | 'category'
  | 'urgency';

export type EmailAutomationConditionOp =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'is_true'
  | 'is_false';

export interface EmailAutomationCondition {
  field: EmailAutomationConditionField;
  op: EmailAutomationConditionOp;
  value: string;
}

export type EmailAutomationActionType =
  | 'triage'
  | 'generate_variants'
  | 'mark_read'
  | 'flag'
  | 'archive'
  | 'move_to_folder'
  | 'forward_to'
  | 'os_notify'
  | 'run_scheduler_job';

export interface EmailAutomationAction {
  type: EmailAutomationActionType;
  folder?: string;
  to?: string;
  title?: string;
  body?: string;
  jobId?: string;
}

export interface EmailAutomation {
  id: string;
  name: string;
  enabled: boolean;
  accountId: string;
  trigger: EmailAutomationTrigger;
  conditions: EmailAutomationCondition[];
  actions: EmailAutomationAction[];
  trusted: boolean;
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EmailAutomationRun {
  id: number;
  ruleId: string;
  messageRowId: number | null;
  action: string;
  outcome: string;
  detail: string;
  ranAt: string;
}

export interface EmailAutomationDryRun {
  days: number;
  total: number;
  matched: number;
  sample: Array<{ id: string; from: string; subject: string; date: string }>;
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
  options?: { untilComplete?: boolean; full?: boolean },
): Promise<{
  synced: number;
  folder: string;
  cached?: number;
  folderTotal?: number;
  backfillComplete?: boolean;
}> {
  const res = await fetch(`/api/email/accounts/${encodeURIComponent(accountId)}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder,
      untilComplete: options?.untilComplete !== false,
      full: options?.full === true,
    }),
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

export interface EmailThreadSummary {
  threadId: string;
  subject: string;
  participants: string[];
  messageCount: number;
  unreadCount: number;
  flagged: boolean;
  hasAttachments: boolean;
  lastDate: string;
  folders: string[];
  snippet: string;
  summary: string | null;
}

/** Conversation rollups for the thread list. */
export async function fetchEmailThreads(
  accountId: string,
  query?: { folder?: string; offset?: number; limit?: number; filter?: string; query?: string },
): Promise<{ threads: EmailThreadSummary[]; total: number }> {
  const params = new URLSearchParams();
  if (query?.folder) params.set('folder', query.folder);
  if (query?.offset !== undefined) params.set('offset', String(query.offset));
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.filter) params.set('filter', query.filter);
  if (query?.query) params.set('query', query.query);
  const qs = params.toString();
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/threads${qs ? `?${qs}` : ''}`,
  );
  return parseJson(res);
}

/** Full-text search across folders (all accounts when accountId is omitted). */
export async function searchEmail(query: {
  q: string;
  accountId?: string;
  folder?: string;
  limit?: number;
  offset?: number;
}): Promise<{ messages: Array<EmailMessage & { accountId: string }>; total: number }> {
  const params = new URLSearchParams({ q: query.q });
  if (query.accountId) params.set('accountId', query.accountId);
  if (query.folder) params.set('folder', query.folder);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const res = await fetch(`/api/email/search?${params.toString()}`);
  return parseJson(res);
}

/**
 * Load the full body for a message. Sync stores headers plus a text preview,
 * so the HTML part arrives on first open.
 */
export async function fetchEmailMessageBody(
  accountId: string,
  messageId: string,
  options?: { force?: boolean },
): Promise<{ message: EmailMessage }> {
  const params = new URLSearchParams({ accountId });
  if (options?.force) params.set('force', '1');
  const res = await fetch(
    `/api/email/messages/${encodeURIComponent(messageId)}/body?${params.toString()}`,
  );
  return parseJson(res);
}

/** True when the reader should download the full MIME source before rendering. */
export function messageNeedsBodyFetch(message: EmailMessage): boolean {
  return message.bodyComplete !== true;
}

/**
 * Download full bodies for messages opened in the reader. Sync stores headers
 * plus a transfer-encoded preview only — HTML and attachments arrive here.
 */
export async function hydrateThreadBodies(
  accountId: string,
  messages: EmailMessage[],
): Promise<EmailMessage[]> {
  const pending = messages.filter((message) => messageNeedsBodyFetch(message));
  if (!pending.length) return messages;

  const loaded = await Promise.all(
    pending.map(async (message) => {
      const { message: full } = await fetchEmailMessageBody(accountId, message.id);
      return full;
    }),
  );
  const byId = new Map(loaded.map((message) => [message.id, message]));
  return messages.map((message) => byId.get(message.id) ?? message);
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

export type ComposeImproveMode =
  | 'improve'
  | 'correct'
  | 'shorten'
  | 'expand'
  | 'friendlier'
  | 'firmer';

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

/** A send parked in the outbox during its undo window. */
export interface OutboxEntry {
  id: string;
  accountId: string;
  to: string;
  subject: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
  queuedAt: string;
  sendAt: string;
  error: string | null;
}

/**
 * Queue a message. It is not delivered immediately — the returned entry can be
 * recalled with {@link cancelOutboxSend} until `sendAt`.
 */
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
  /** Base64 payloads; `contentId` marks a part the body references as `cid:`. */
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: string;
    contentId?: string;
  }>;
  /** ISO timestamp for send-later; omit to use the ordinary undo window. */
  sendAt?: string;
}): Promise<{ queued: boolean; entry: OutboxEntry }> {
  const res = await fetch('/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function fetchOutbox(): Promise<{ entries: OutboxEntry[] }> {
  const res = await fetch('/api/email/outbox');
  return parseJson(res);
}

/** Recall a queued send. Fails once the undo window has closed. */
export async function cancelOutboxSend(id: string): Promise<{ entry: OutboxEntry }> {
  const res = await fetch(`/api/email/outbox/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return parseJson(res);
}

/**
 * Reduce a From header to a bare, comparable address.
 * Mirrors `normalizeSender` in `server/email/image-allowlist.js`.
 */
export function normalizeSender(from: string | null | undefined): string {
  const raw = String(from ?? '').trim();
  const angled = /<([^>]+)>/.exec(raw);
  return (angled ? angled[1] : raw).trim().toLowerCase();
}

/** Senders whose remote images load without asking. */
export async function fetchImageAllowlist(): Promise<string[]> {
  const res = await fetch('/api/email/image-allowlist');
  const data = await parseJson<{ senders: string[] }>(res);
  return data.senders;
}

export async function allowImagesFromSender(sender: string): Promise<string[]> {
  const res = await fetch('/api/email/image-allowlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender }),
  });
  const data = await parseJson<{ senders: string[] }>(res);
  return data.senders;
}

export async function blockImagesFromSender(sender: string): Promise<string[]> {
  const res = await fetch(
    `/api/email/image-allowlist?sender=${encodeURIComponent(sender)}`,
    { method: 'DELETE' },
  );
  const data = await parseJson<{ senders: string[] }>(res);
  return data.senders;
}

export interface EmailPreferences {
  alwaysLoadRemoteImages: boolean;
}

/** Global email reader/privacy preferences. */
export async function fetchEmailPreferences(): Promise<EmailPreferences> {
  const res = await fetch('/api/email/preferences');
  const data = await parseJson<EmailPreferences>(res);
  return {
    alwaysLoadRemoteImages: data.alwaysLoadRemoteImages === true,
  };
}

export async function updateEmailPreferences(
  patch: Partial<EmailPreferences>,
): Promise<EmailPreferences> {
  const res = await fetch('/api/email/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await parseJson<EmailPreferences>(res);
  return {
    alwaysLoadRemoteImages: data.alwaysLoadRemoteImages === true,
  };
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Path of the attachment route for a part.
 *
 * `selector` is either a part index or `cid:<content-id>`; the latter is how the
 * body iframe resolves inline images.
 */
export function emailAttachmentPath(
  accountId: string,
  messageKey: string,
  selector: number | string,
  options: { inline?: boolean } = {},
): string {
  const query = new URLSearchParams({ accountId });
  if (options.inline) query.set('inline', '1');
  return `/api/email/messages/${encodeURIComponent(messageKey)}/attachments/${encodeURIComponent(
    String(selector),
  )}?${query.toString()}`;
}

/**
 * Download one attachment's bytes.
 *
 * Deliberately a `fetch` rather than an `<a href>`: the session token rides on a
 * header added by the fetch interceptor, and a plain navigation would not carry
 * it (nor should the token end up in a URL the browser keeps in history).
 */
export async function downloadEmailAttachment(
  accountId: string,
  messageKey: string,
  selector: number | string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(emailAttachmentPath(accountId, messageKey, selector));
  if (!res.ok) {
    let message = res.statusText;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      /* a non-JSON error body is fine; the status text stands */
    }
    throw new Error(message || 'Attachment download failed');
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]*)"/.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] || 'attachment' };
}

/** Hand a downloaded attachment to the browser's save flow. */
export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can race the download in some engines; one tick is
  // enough for the click to have been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
