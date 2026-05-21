/**
 * Provider id, URL, and enum validation for ~/.minnow/providers.
 */

const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const API_KINDS = new Set(['lm-studio-v0', 'openai-v1']);
const AUTH_STYLES = new Set(['bearer', 'api-key', 'x-api-key']);

/**
 * @param {string} id
 * @returns {string}
 */
export function validateProviderId(id) {
  if (typeof id !== 'string' || !PROVIDER_ID_RE.test(id)) {
    throw new Error('Invalid provider id');
  }
  return id;
}

/**
 * Normalize base URL to origin without trailing slash.
 * @param {string} raw
 * @returns {string}
 */
export function validateBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('baseUrl is required');
  }
  const trimmed = raw.trim().replace(/\/$/, '');
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error('Invalid baseUrl');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https');
  }
  return u.origin;
}

/**
 * @param {string} apiKind
 * @returns {'lm-studio-v0' | 'openai-v1'}
 */
export function validateApiKind(apiKind) {
  if (!API_KINDS.has(apiKind)) {
    throw new Error('Invalid apiKind');
  }
  return /** @type {'lm-studio-v0' | 'openai-v1'} */ (apiKind);
}

/**
 * @param {string | undefined} style
 * @returns {'bearer' | 'api-key' | 'x-api-key'}
 */
export function validateAuthStyle(style) {
  if (!style) return 'bearer';
  if (!AUTH_STYLES.has(style)) {
    throw new Error('Invalid authStyle');
  }
  return /** @type {'bearer' | 'api-key' | 'x-api-key'} */ (style);
}

/**
 * @param {string} pathnameSegment
 * @returns {boolean}
 */
export function isSafeProviderPathSegment(pathnameSegment) {
  return typeof pathnameSegment === 'string' && PROVIDER_ID_RE.test(pathnameSegment);
}
