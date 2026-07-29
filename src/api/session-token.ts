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

const DEVICE_TOKEN_STORAGE_KEY = 'minnow.auth.deviceToken';

/** Read the paired-device credential without throwing in private storage modes. */
export function getDeviceToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Persist the credential returned by a successful one-time pairing exchange. */
export function saveDeviceToken(token: string): void {
  if (typeof window === 'undefined' || !token.startsWith('minnow_device_')) {
    throw new Error('Invalid companion device token');
  }
  window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
}

/** Remove a revoked or rejected paired-device credential. */
export function clearDeviceToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable in private browsing mode. */
  }
}

/** Whether this page received the local host's per-boot credential. */
export function hasHostSessionToken(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__MINNOW_SESSION_TOKEN__);
}

/** The host or paired-device token, or empty string when authentication is required. */
export function getSessionToken(): string {
  if (typeof window === 'undefined') return '';
  return window.__MINNOW_SESSION_TOKEN__ ?? getDeviceToken();
}

/** Append `?token=`/`&token=` to a same-origin URL. No-ops when there's no token. */
export function withSessionToken(url: string): string {
  const token = getSessionToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
