/**
 * Reply header helpers — target resolution, References chain, subject prefix.
 */

/**
 * Extract bare email address from a From/Reply-To header value.
 * @param {string | undefined} header
 */
export function extractEmailAddress(header) {
  const raw = String(header ?? '').trim();
  if (!raw) {
    return '';
  }
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] ?? raw).trim();
}

/**
 * Normalize an email address for comparison.
 * @param {string | undefined} email
 */
export function normalizeEmailAddress(email) {
  return extractEmailAddress(email).toLowerCase();
}

/**
 * Collect normalized addresses that belong to the active account.
 * @param {{ username?: string, fromAddress?: string }} account
 */
export function collectAccountEmails(account) {
  const emails = [];
  const username = String(account?.username ?? '').trim();
  const fromAddress = String(account?.fromAddress ?? '').trim();
  if (username) {
    emails.push(normalizeEmailAddress(username));
  }
  if (fromAddress) {
    emails.push(normalizeEmailAddress(fromAddress));
  }
  return [...new Set(emails.filter(Boolean))];
}

/**
 * Whether an address belongs to the account (self-sent mail).
 * @param {string | undefined} address
 * @param {string[]} accountEmails
 */
export function isOwnAddress(address, accountEmails) {
  const normalized = normalizeEmailAddress(address);
  return normalized !== '' && accountEmails.includes(normalized);
}

/**
 * Pick reply target from thread, skipping own messages and honoring Reply-To.
 * @param {Array<{ from?: string, replyTo?: string }>} thread
 * @param {string[]} accountEmails
 */
export function resolveReplyTarget(thread, accountEmails) {
  if (!Array.isArray(thread) || thread.length === 0) {
    return '';
  }

  for (let index = thread.length - 1; index >= 0; index -= 1) {
    const message = thread[index];
    const replyTo = String(message.replyTo ?? '').trim();
    const from = String(message.from ?? '').trim();
    const candidate = replyTo || from;
    if (candidate && !isOwnAddress(candidate, accountEmails)) {
      return extractEmailAddress(candidate);
    }
  }

  const latest = thread[thread.length - 1];
  const fallback = String(latest.replyTo || latest.from || '').trim();
  return extractEmailAddress(fallback);
}

/**
 * Build References header chain for a reply to the given message.
 * @param {{ messageId?: string, references?: string[] }} message
 */
export function buildReferencesChain(message) {
  const inReplyTo = String(message?.messageId ?? '').trim();
  const priorRefs = Array.isArray(message?.references) ? message.references : [];
  return [inReplyTo, ...priorRefs].filter(Boolean).join(' ');
}

/**
 * Prefix subject with Re: when missing.
 * @param {string | undefined} subject
 */
export function buildReplySubject(subject) {
  const trimmed = String(subject ?? '').trim();
  if (!trimmed) {
    return 'Re:';
  }
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/**
 * Compute reply headers from a cached thread (no LLM).
 * @param {Array<{ messageId?: string, references?: string[], from?: string, replyTo?: string, subject?: string }>} thread
 * @param {{ username?: string, fromAddress?: string }} account
 */
export function computeReplyHeaders(thread, account) {
  if (!Array.isArray(thread) || thread.length === 0) {
    throw new Error('Thread not found in cache — sync the folder first');
  }

  const latest = thread[thread.length - 1];
  const accountEmails = collectAccountEmails(account);

  return {
    to: resolveReplyTarget(thread, accountEmails),
    subject: buildReplySubject(latest.subject),
    inReplyTo: String(latest.messageId ?? ''),
    references: buildReferencesChain(latest),
  };
}
