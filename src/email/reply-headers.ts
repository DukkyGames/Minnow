/**
 * Reply header helpers for the Email compose UI (mirrors server/email/reply-headers.js).
 */

import type { EmailAccount, EmailMessage } from "./client";

/** Extract bare email address from a From/Reply-To header value. */
export function extractEmailAddress(header: string | undefined): string {
  const raw = String(header ?? "").trim();
  if (!raw) {
    return "";
  }
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] ?? raw).trim();
}

/** Normalize an email address for comparison. */
export function normalizeEmailAddress(email: string | undefined): string {
  return extractEmailAddress(email).toLowerCase();
}

/** Collect normalized addresses that belong to the active account. */
export function collectAccountEmails(account: EmailAccount): string[] {
  const emails: string[] = [];
  const username = account.username.trim();
  const fromAddress = (account.fromAddress ?? "").trim();
  if (username) {
    emails.push(normalizeEmailAddress(username));
  }
  if (fromAddress) {
    emails.push(normalizeEmailAddress(fromAddress));
  }
  return [...new Set(emails.filter(Boolean))];
}

/** Whether an address belongs to the account (self-sent mail). */
export function isOwnAddress(
  address: string | undefined,
  accountEmails: string[],
): boolean {
  const normalized = normalizeEmailAddress(address);
  return normalized !== "" && accountEmails.includes(normalized);
}

/**
 * Pick reply target from thread, skipping own messages and honoring Reply-To.
 */
export function resolveReplyTarget(
  thread: EmailMessage[],
  accountEmails: string[],
): string {
  if (!thread.length) {
    return "";
  }

  for (let index = thread.length - 1; index >= 0; index -= 1) {
    const message = thread[index];
    const replyTo = (message.replyTo ?? "").trim();
    const from = message.from.trim();
    const candidate = replyTo || from;
    if (candidate && !isOwnAddress(candidate, accountEmails)) {
      return extractEmailAddress(candidate);
    }
  }

  const latest = thread[thread.length - 1];
  const fallback = (latest.replyTo || latest.from || "").trim();
  return extractEmailAddress(fallback);
}

/** Build References header chain for a reply to the given message. */
export function buildReferencesChain(message: EmailMessage | undefined): string {
  const inReplyTo = (message?.messageId ?? "").trim();
  const priorRefs = Array.isArray(message?.references) ? message.references : [];
  return [inReplyTo, ...priorRefs].filter(Boolean).join(" ");
}
