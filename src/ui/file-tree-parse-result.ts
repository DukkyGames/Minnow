/**
 * Parse POST /api/tools result strings for file-tree CRUD feedback.
 */

/** Map OS lock/permission errors to actionable file-tree messages (BUG-018). */
export function friendlyFileToolError(message: string): string {
  if (/EBUSY|resource busy|locked/i.test(message)) {
    return 'File is in use — close other apps using it, then try again.';
  }
  if (/EPERM|permission denied/i.test(message)) {
    return 'Permission denied — check file permissions or close apps using this file.';
  }
  return message;
}

/** Treat tool output starting with Error: as failure. */
export function parseToolResult(content: string): { ok: boolean; message: string } {
  const trimmed = content.trim();
  if (trimmed.startsWith('Error:')) {
    const raw = trimmed.replace(/^Error:\s*/i, '').trim();
    return { ok: false, message: friendlyFileToolError(raw) };
  }
  return { ok: true, message: trimmed };
}
