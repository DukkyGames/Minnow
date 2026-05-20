/**
 * Parse POST /api/tools result strings for file-tree CRUD feedback.
 */

/** Treat tool output starting with Error: as failure. */
export function parseToolResult(content: string): { ok: boolean; message: string } {
  const trimmed = content.trim();
  if (trimmed.startsWith('Error:')) {
    return { ok: false, message: trimmed.replace(/^Error:\s*/i, '').trim() };
  }
  return { ok: true, message: trimmed };
}
