/**
 * Draft, contact, and snooze endpoints.
 *
 * Kept out of `client.ts` so the compose surface's growing API does not bloat
 * the module every screen already imports.
 */

import type { EmailMessage } from './client';

export interface StoredDraft {
  id: string;
  threadId: string;
  replyToKey: string;
  mode: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  bodyHtml: string;
  inReplyTo: string;
  references: string;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
  imapUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailContact {
  address: string;
  name: string;
  /** What to insert into a recipient field. */
  header: string;
  seenCount: number;
  repliedCount: number;
  lastSeenAt: string;
}

async function parseJson<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : res.statusText);
  }
  return payload;
}

/** Create or update a draft. Called on every autosave tick. */
export async function saveEmailDraft(
  input: Partial<StoredDraft> & { accountId: string; syncToImap?: boolean },
): Promise<{ draft: StoredDraft; imap?: { synced: boolean; error?: string } }> {
  const res = await fetch('/api/email/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function fetchEmailDrafts(
  accountId: string,
  query?: { threadId?: string; limit?: number },
): Promise<StoredDraft[]> {
  const params = new URLSearchParams({ accountId });
  if (query?.threadId) params.set('threadId', query.threadId);
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  const res = await fetch(`/api/email/drafts?${params.toString()}`);
  const data = await parseJson<{ drafts: StoredDraft[] }>(res);
  return data.drafts;
}

export async function deleteEmailDraft(accountId: string, draftId: string): Promise<void> {
  const res = await fetch(
    `/api/email/drafts/${encodeURIComponent(draftId)}?accountId=${encodeURIComponent(accountId)}`,
    { method: 'DELETE' },
  );
  await parseJson(res);
}

/** Autocomplete over addresses harvested from mail history. */
export async function fetchEmailContacts(
  accountId: string,
  query: string,
  limit = 8,
): Promise<EmailContact[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(
    `/api/email/accounts/${encodeURIComponent(accountId)}/contacts?${params.toString()}`,
  );
  const data = await parseJson<{ contacts: EmailContact[] }>(res);
  return data.contacts;
}

/** Hide a message until `until`; pass an empty string to un-snooze. */
export async function snoozeEmailMessage(
  accountId: string,
  messageKey: string,
  until: string,
): Promise<EmailMessage> {
  const res = await fetch(
    `/api/email/messages/${encodeURIComponent(messageKey)}/snooze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, until }),
    },
  );
  const data = await parseJson<{ message: EmailMessage }>(res);
  return data.message;
}

/** Read a File into the base64 payload the send route expects. */
export function fileToAttachment(
  file: File,
): Promise<{ filename: string; contentType: string; content: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      // A data: URL is `data:<mime>;base64,<payload>` — keep only the payload.
      const comma = result.indexOf(',');
      resolve({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        content: comma >= 0 ? result.slice(comma + 1) : '',
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}
