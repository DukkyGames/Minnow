/**
 * Email thread normalization via Message-ID, References, and subject.
 */

import { createHash } from 'node:crypto';

/** Strip reply/forward prefixes from a subject for thread grouping. */
export function normalizeSubject(subject) {
  let value = String(subject ?? '').trim();
  if (!value) {
    return '';
  }

  // Remove repeated Re:/Fwd:/Fw: prefixes (multilingual common forms).
  const prefixRe = /^(?:(?:re|fw|fwd|aw|sv|antw|vs|ref|tr|odp|r|回复|答复|转发)\s*:\s*)+/i;
  let prev = '';
  while (value !== prev) {
    prev = value;
    value = value.replace(prefixRe, '').trim();
  }
  return value.toLowerCase();
}

/**
 * Pick the canonical thread root id from RFC 5322 headers.
 * @param {{ messageId?: string, inReplyTo?: string, references?: string[], subject?: string }} headers
 * @returns {string}
 */
export function computeThreadId(headers) {
  const refs = Array.isArray(headers.references) ? headers.references : [];
  const firstRef = refs.find((ref) => typeof ref === 'string' && ref.trim());
  if (firstRef) {
    return normalizeMessageId(firstRef);
  }

  const inReplyTo =
    typeof headers.inReplyTo === 'string' && headers.inReplyTo.trim()
      ? normalizeMessageId(headers.inReplyTo)
      : '';
  if (inReplyTo) {
    return inReplyTo;
  }

  const messageId =
    typeof headers.messageId === 'string' && headers.messageId.trim()
      ? normalizeMessageId(headers.messageId)
      : '';
  if (messageId) {
    return messageId;
  }

  const subject = normalizeSubject(headers.subject);
  if (subject) {
    return `subject:${createHash('sha256').update(subject).digest('hex').slice(0, 16)}`;
  }

  return `orphan:${createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 16)}`;
}

/**
 * Normalize angle-bracketed Message-IDs for stable comparison.
 * @param {string} raw
 */
export function normalizeMessageId(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return '';
  }
  const inner = trimmed.replace(/^<|>$/g, '').trim().toLowerCase();
  return inner ? `<${inner}>` : '';
}

/**
 * Group parsed messages by thread id (newest first within each thread).
 * @param {Array<Record<string, unknown>>} messages
 */
export function groupMessagesByThread(messages) {
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const map = new Map();
  for (const message of messages) {
    const threadId = String(message.threadId ?? '');
    if (!threadId) {
      continue;
    }
    if (!map.has(threadId)) {
      map.set(threadId, []);
    }
    map.get(threadId).push(message);
  }

  for (const rows of map.values()) {
    rows.sort((a, b) => {
      const da = new Date(String(a.date ?? 0)).getTime();
      const db = new Date(String(b.date ?? 0)).getTime();
      return db - da;
    });
  }

  return map;
}
