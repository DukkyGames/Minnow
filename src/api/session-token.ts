/**
 * Reads the per-boot session token injected into index.html by the server
 * (window.__MINNOW_SESSION_TOKEN__) and appends it to URLs that can't carry
 * a custom header (WebSocket, EventSource, direct navigation).
 *
 * Companion device tokens are mirrored to a first-party cookie so installs that
 * share cookie storage with the pairing browser (common on Android) keep access.
 */

declare global {
  interface Window {
    __MINNOW_SESSION_TOKEN__?: string;
  }
}

const DEVICE_TOKEN_STORAGE_KEY = 'minnow.auth.deviceToken';
const DEVICE_TOKEN_COOKIE_NAME = 'minnow_device';
const DEVICE_TOKEN_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

function isValidDeviceToken(token: string): boolean {
  return token.startsWith('minnow_device_');
}

/** Parse the companion device cookie when localStorage is empty. */
function readDeviceTokenCookie(): string {
  if (typeof document === 'undefined') return '';
  const prefix = `${DEVICE_TOKEN_COOKIE_NAME}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const value = decodeURIComponent(trimmed.slice(prefix.length));
    return isValidDeviceToken(value) ? value : '';
  }
  return '';
}

/** Mirror the device token into a first-party cookie for cross-context hydration. */
function writeDeviceTokenCookie(token: string): void {
  if (typeof document === 'undefined') return;
  const secure = window.isSecureContext ? '; Secure' : '';
  document.cookie = [
    `${DEVICE_TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${DEVICE_TOKEN_COOKIE_MAX_AGE_SEC}`,
    secure,
  ].join('; ');
}

/** Drop the mirrored cookie when the device credential is cleared. */
function clearDeviceTokenCookie(): void {
  if (typeof document === 'undefined') return;
  const secure = window.isSecureContext ? '; Secure' : '';
  document.cookie = [
    `${DEVICE_TOKEN_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    secure,
  ].join('; ');
}

/** Read the paired-device credential without throwing in private storage modes. */
export function getDeviceToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    const stored = window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) ?? '';
    if (stored) return stored;
    const fromCookie = readDeviceTokenCookie();
    if (!fromCookie) return '';
    window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, fromCookie);
    return fromCookie;
  } catch {
    return readDeviceTokenCookie();
  }
}

/** Persist the credential returned by a successful one-time pairing exchange. */
export function saveDeviceToken(token: string): void {
  if (typeof window === 'undefined' || !isValidDeviceToken(token)) {
    throw new Error('Invalid companion device token');
  }
  window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
  writeDeviceTokenCookie(token);
}

/** Remove a revoked or rejected paired-device credential. */
export function clearDeviceToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable in private browsing mode. */
  }
  clearDeviceTokenCookie();
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
