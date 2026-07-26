/**
 * Reads the per-boot session token injected into index.html by the server
 * (window.__MINNOW_SESSION_TOKEN__) and appends it to URLs that can't carry
 * a custom header (WebSocket, EventSource, direct navigation).
 */

declare global {
  interface Window {
    __MINNOW_SESSION_TOKEN__?: string;
  }
}

/** The current window's session token, or empty string if unset (headless/tests). */
export function getSessionToken(): string {
  return typeof window !== 'undefined' ? (window.__MINNOW_SESSION_TOKEN__ ?? '') : '';
}

/** Update the in-memory session token after a server restart (browser only). */
export function setSessionToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.__MINNOW_SESSION_TOKEN__ = token;
}

/**
 * Fetch the current per-boot token from the dev server (loopback host-gated).
 * Used when index.html injection is stale after `npm start` restarts.
 */
export async function refreshSessionTokenFromServer(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const res = await fetchImpl('/api/auth/session-token', { method: 'GET' });
    if (!res.ok) return false;
    const body = (await res.json()) as { token?: unknown };
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) return false;
    setSessionToken(token);
    return true;
  } catch {
    return false;
  }
}

/** Append `?token=`/`&token=` to a same-origin URL. No-ops when there's no token. */
export function withSessionToken(url: string): string {
  const token = getSessionToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
