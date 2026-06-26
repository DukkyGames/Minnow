/**
 * OAuth redirect base URL (dev server origin or MINNOW_OAUTH_REDIRECT_BASE).
 */

import { defaultMinnowLocalOrigin } from '../constants/minnow-port.js';

/** @type {string} */
let oauthRedirectBase = (
  process.env.MINNOW_OAUTH_REDIRECT_BASE ||
  defaultMinnowLocalOrigin()
).replace(/\/$/, '');

/** Record the URL Vite resolved at startup. */
export function setOAuthRedirectBase(url) {
  const trimmed = String(url ?? '').trim().replace(/\/$/, '');
  if (trimmed) {
    oauthRedirectBase = trimmed;
  }
}

/** Full redirect URI registered with Google / Microsoft. */
export function getOAuthRedirectUri() {
  return `${oauthRedirectBase}/api/oauth/callback`;
}

/** Public origin for Settings UI copy-paste. */
export function getOAuthRedirectBase() {
  return oauthRedirectBase;
}
