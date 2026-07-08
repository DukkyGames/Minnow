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

/** Append `?token=`/`&token=` to a same-origin URL. No-ops when there's no token. */
export function withSessionToken(url: string): string {
  const token = getSessionToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
