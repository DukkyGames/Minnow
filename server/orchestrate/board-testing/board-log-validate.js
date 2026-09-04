/**
 * Group-id sanitization for leftover V1 JSONL tails.
 * Structural invariant checking (`validateBoardLog`) was retired with MIN-713.
 */

/**
 * Mirror server/orchestrate/board-log-sink.js group id sanitization.
 * @param {string} groupId
 */
export function sanitizeGroupId(groupId) {
  const trimmed = typeof groupId === 'string' ? groupId.trim() : '';
  if (!trimmed) return null;
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return safe || null;
}
