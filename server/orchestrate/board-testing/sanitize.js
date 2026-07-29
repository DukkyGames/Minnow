/**
 * Small, allow-list based sanitizers for board-testing diagnostics.
 */

const SECRET_KEY = /authorization|cookie|token|secret|password|api[-_]?key/i;
const SECRET_TEXT =
  /((?:bearer|token|api[-_ ]?key|password|secret)\s*[:=]\s*)([^\s,;"']+)/gi;
const MAX_TEXT_LENGTH = 2_000;

/** @param {unknown} value */
export function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') {
    const redacted = value.replace(SECRET_TEXT, '$1[REDACTED]');
    return redacted.length > MAX_TEXT_LENGTH
      ? `${redacted.slice(0, MAX_TEXT_LENGTH)}…[truncated]`
      : redacted;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    output[key] = SECRET_KEY.test(key)
      ? '[REDACTED]'
      : sanitizeDiagnosticValue(item, depth + 1);
  }
  return output;
}

/** @param {unknown} entry */
export function sanitizeFakeModelRequest(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const request = /** @type {Record<string, unknown>} */ (entry);
  const body =
    request.body && typeof request.body === 'object'
      ? /** @type {Record<string, unknown>} */ (request.body)
      : {};
  const messages = Array.isArray(body.messages)
    ? body.messages.slice(-20).map((message) => {
        if (!message || typeof message !== 'object') return null;
        const row = /** @type {Record<string, unknown>} */ (message);
        return sanitizeDiagnosticValue({
          role: typeof row.role === 'string' ? row.role : undefined,
          content: row.content,
          name: typeof row.name === 'string' ? row.name : undefined,
          tool_call_id:
            typeof row.tool_call_id === 'string' ? row.tool_call_id : undefined,
        });
      })
    : [];

  return {
    at: typeof request.at === 'number' ? request.at : null,
    method: typeof request.method === 'string' ? request.method : null,
    pathname: typeof request.pathname === 'string' ? request.pathname : null,
    context: sanitizeDiagnosticValue(request.context ?? null),
    model: typeof body.model === 'string' ? sanitizeDiagnosticValue(body.model) : null,
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    messages,
  };
}
