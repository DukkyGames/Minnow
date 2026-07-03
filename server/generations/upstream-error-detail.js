/**
 * Normalize upstream provider HTTP error bodies for user-facing messages.
 */

/** Max chars of upstream error detail kept in generation / research errors. */
export const UPSTREAM_ERROR_DETAIL_MAX = 2000;

/**
 * Extract a human-readable message from common provider JSON error shapes.
 * @param {unknown} data
 * @returns {string | null}
 */
function extractJsonErrorMessage(data) {
  if (typeof data === 'string') {
    const trimmed = data.trim();
    return trimmed || null;
  }
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = /** @type {Record<string, unknown>} */ (data);

  if (typeof record.error === 'string') {
    return record.error.trim() || null;
  }
  if (record.error && typeof record.error === 'object') {
    const nested = extractJsonErrorMessage(record.error);
    if (nested) return nested;
  }

  if (typeof record.message === 'string') {
    return record.message.trim() || null;
  }

  if (typeof record.detail === 'string') {
    return record.detail.trim() || null;
  }
  if (Array.isArray(record.detail)) {
    const parts = record.detail
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object' && typeof item.msg === 'string') {
          return item.msg.trim();
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join('; ');
  }

  // OpenCode Zen may surface upstream failures as chat.completion with an empty assistant.
  if (record.object === 'chat.completion' && Array.isArray(record.choices)) {
    const choice = record.choices[0];
    const message = choice?.message;
    const hasContent =
      (typeof message?.content === 'string' && message.content.trim().length > 0) ||
      (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0);
    if (!hasContent) {
      return 'Provider returned an empty completion (check model, API key, and OpenCode Zen billing)';
    }
  }

  return null;
}

/**
 * Collapse whitespace and parse JSON error bodies when possible.
 * @param {string} raw
 * @returns {string}
 */
export function formatUpstreamHttpErrorDetail(raw) {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';

  let message = collapsed;
  if (collapsed.startsWith('{') || collapsed.startsWith('[')) {
    try {
      const parsed = extractJsonErrorMessage(JSON.parse(collapsed));
      if (parsed) message = parsed;
    } catch {
      /* keep collapsed text */
    }
  }

  if (message.length <= UPSTREAM_ERROR_DETAIL_MAX) return message;
  return `${message.slice(0, UPSTREAM_ERROR_DETAIL_MAX)}…`;
}

/**
 * Build `Upstream HTTP <status>` with optional provider detail suffix.
 * @param {number} status
 * @param {string} rawBody
 * @returns {string}
 */
export function formatUpstreamHttpErrorMessage(status, rawBody) {
  const detail = formatUpstreamHttpErrorDetail(rawBody);
  const lower = detail.toLowerCase();
  const html = lower.includes('<!doctype') || lower.includes('<html');
  const suffix = detail
    ? html
      ? ' (provider returned an HTML error page — check LM Studio / provider logs)'
      : `: ${detail}`
    : '';
  return `Upstream HTTP ${status}${suffix}`;
}
