/**
 * Retry a fetch-shaped call when the failure is a blip, not a bad request.
 *
 * Used by main chat, sub-agents, and goal evaluation. One policy: TypeError
 * transport failures and transient HTTP statuses share the same backoff.
 * A second retry helper would desynchronise those callers (P8-A / MIN-754).
 */

/** Same-request-would-succeed-later. Mirrors generations/fallback.js. */
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 502, 503, 504, 529]);

/** Initial try plus retries. Same ceiling as generations same-candidate retries. */
const MAX_TRANSIENT_FETCH_ATTEMPTS = 3;

function isTransientFetchError(err) {
  if (!(err instanceof TypeError)) return false;
  const message = err.message;
  return message.includes("Failed to fetch") || message.includes("NetworkError");
}

function httpStatusFromError(err) {
  if (!(err instanceof Error)) return null;
  const match = err.message.match(/^HTTP (\d{3})\b/);
  if (!match) return null;
  return Number(match[1]);
}

function isTransientHttpError(err) {
  const status = httpStatusFromError(err);
  return status != null && TRANSIENT_HTTP_STATUSES.has(status);
}

function isRetryableTransientError(err) {
  return isTransientFetchError(err) || isTransientHttpError(err);
}

/**
 * Run `fn` with exponential backoff on transient failures.
 * The export name is historical (it used to retry once); callers keep the name
 * so chat and the runner cannot grow a second policy.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [delayMs=400]
 * @returns {Promise<T>}
 */
async function retryOnceOnTransientFetch(fn, delayMs = 400) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_TRANSIENT_FETCH_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableTransientError(err) || attempt === MAX_TRANSIENT_FETCH_ATTEMPTS) {
        throw err;
      }
      const waitMs = delayMs <= 0 ? 0 : delayMs * 2 ** (attempt - 1);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }
  throw lastErr;
}

export {
  isTransientFetchError,
  isTransientHttpError,
  retryOnceOnTransientFetch,
  TRANSIENT_HTTP_STATUSES,
  MAX_TRANSIENT_FETCH_ATTEMPTS
};
