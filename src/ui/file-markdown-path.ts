/**
 * Markdown path helpers shared by file tree and viewer (avoids import cycles).
 */

/** True when the path should use markdown preview vs code editor defaults. */
export function isMarkdownFilePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}
