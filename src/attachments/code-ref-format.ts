/**
 * Code-reference label and history serialization (no store dependency).
 */

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

/** Label for composer chips and chat links: `foo.ts L15-36`. */
export function formatCodeRefLabel(
  workspacePath: string,
  startLine: number,
  endLine: number,
): string {
  const range =
    startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
  return `${basename(workspacePath)} ${range}`;
}

/** Persisted/API block for a code reference (body is the selected snippet). */
export function codeRefHistoryBlock(
  workspacePath: string,
  startLine: number,
  endLine: number,
  body: string,
): string {
  const safePath = workspacePath.replace(/"/g, "'");
  return `<code-ref path="${safePath}" start="${startLine}" end="${endLine}">\n${body}\n</code-ref>`;
}
