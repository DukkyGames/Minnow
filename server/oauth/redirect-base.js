/**
 * OAuth redirect base URL (dev server origin or MINNOW_OAUTH_REDIRECT_BASE).
 */

/** @type {string} */
let oauthRedirectBase = (
  process.env.MINNOW_OAUTH_REDIRECT_BASE ||
  `http://localhost:${process.env.PORT || 5173}`
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
