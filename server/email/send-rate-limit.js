/**
 * Per-account send rate limiting.
 *
 * A compromised renderer, a runaway automation, or a loop in a reply rule can
 * all turn the send path into a spam cannon using the user's own credentials —
 * which gets the account blacklisted, not just the app. The cap is well above
 * any plausible human sending rate, so it only ever trips on a malfunction.
 */

/** Sends allowed per account per window. */
const MAX_SENDS_PER_WINDOW = 20;

/** Sliding window length. */
const WINDOW_MS = 60_000;

/** @type {Map<string, number[]>} accountId -> send timestamps within the window */
const sendTimestamps = new Map();

/**
 * @param {string} accountId
 * @param {number} now
 * @returns {number[]} timestamps still inside the window
 */
function recentSends(accountId, now) {
  const cutoff = now - WINDOW_MS;
  const kept = (sendTimestamps.get(accountId) ?? []).filter((ts) => ts > cutoff);
  if (kept.length === 0) {
    sendTimestamps.delete(accountId);
  } else {
    sendTimestamps.set(accountId, kept);
  }
  return kept;
}

/**
 * Record one send, or throw when the account is over its limit.
 * @param {string} accountId
 * @param {number} [now]
 */
export function consumeSendAllowance(accountId, now = Date.now()) {
  const key = String(accountId ?? '').trim() || 'unknown';
  const recent = recentSends(key, now);
  if (recent.length >= MAX_SENDS_PER_WINDOW) {
    const retryAfterMs = Math.max(0, recent[0] + WINDOW_MS - now);
    const err = new Error(
      `Send rate limit reached for this account (${MAX_SENDS_PER_WINDOW}/min). Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    // Surfaced as HTTP 429 by the middleware.
    /** @type {Error & { status?: number, retryAfterMs?: number }} */ (err).status = 429;
    /** @type {Error & { status?: number, retryAfterMs?: number }} */ (err).retryAfterMs =
      retryAfterMs;
    throw err;
  }
  recent.push(now);
  sendTimestamps.set(key, recent);
}

/** Reset all counters (tests). */
export function resetSendRateLimitForTests() {
  sendTimestamps.clear();
}
