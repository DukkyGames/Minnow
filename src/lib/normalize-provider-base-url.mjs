/**
 * Normalize provider base URL: trim, drop trailing slash, preserve pathname prefix.
 * Gateway prefixes (e.g. OpenCode `/zen`, OpenRouter `/api`) live on baseUrl, not path fields.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeProviderBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('baseUrl is required');
  }
  const trimmed = raw.trim().replace(/\/+$/, '');
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error('Invalid baseUrl');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https');
  }
  const pathname = u.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') {
    return u.origin;
  }
  return `${u.origin}${pathname}`;
}
