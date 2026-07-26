/**
 * Optional shared-secret gate for /api/session/* when MINNOW_TOKEN is set.
 * Complements the per-boot session token checked by auth-middleware.js.
 *
 * EventSource cannot send Authorization headers, so clients may also pass
 * the shared secret as `?minnowToken=` (distinct from `?token=` session token).
 */

/**
 * @returns {boolean}
 */
export function isSessionAuthRequired() {
  const token = process.env.MINNOW_TOKEN;
  return typeof token === 'string' && token.trim().length > 0;
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function extractMinnowToken(req) {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const fromQuery = url.searchParams.get('minnowToken');
    if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();
  } catch {
    /* ignore malformed URL */
  }
  return '';
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export function isSessionRequestAuthorized(req) {
  if (!isSessionAuthRequired()) return true;
  const expected = process.env.MINNOW_TOKEN?.trim() ?? '';
  return extractMinnowToken(req) === expected;
}

/**
 * @param {import('http').ServerResponse} res
 */
export function sendSessionUnauthorized(res) {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}
