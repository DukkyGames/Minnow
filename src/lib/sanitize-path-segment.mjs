/**
 * Single sanitizer for worktree path segments and git ref fragments.
 * Shared by the client worktree helpers (src/state/chat-worktree.ts) and the
 * server worktree paths (server/worktree/paths.js) so a slot name always resolves to
 * the same directory on both sides.
 */

/** Max characters per segment — keeps deep worktree paths under Windows MAX_PATH. */
export const PATH_SEGMENT_MAX = 64;

/**
 * Keep word chars, dot, dash and underscore; collapse everything else to a single
 * dash; trim leading/trailing separators; bound length. Never returns an empty string.
 * @param {string|number} raw
 * @returns {string}
 */
export function sanitizePathSegment(raw) {
  const cleaned = String(raw)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, PATH_SEGMENT_MAX)
    .replace(/[-.]+$/g, '');
  return cleaned || 'x';
}
