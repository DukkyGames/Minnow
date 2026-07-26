/**
 * Optional bearer auth for /api/session/* when MINNOW_TOKEN is set.
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
 * @returns {boolean}
 */
export function isSessionRequestAuthorized(req) {
  if (!isSessionAuthRequired()) return true;
  const expected = process.env.MINNOW_TOKEN?.trim() ?? '';
  const header = req.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1].trim() === expected;
}

/**
 * @param {import('http').ServerResponse} res
 */
export function sendSessionUnauthorized(res) {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}
