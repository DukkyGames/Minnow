/**
 * Normalize LSP hover MarkupContent for plain-text prompts (no browser deps).
 */

/** Plain-text hover for prompts (markdown stripped to string). */
export function hoverContentsToPlainText(contents: unknown): string {
  if (contents == null) return '';
  if (typeof contents === 'string') return contents.trim();
  if (Array.isArray(contents)) {
    return contents
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'value' in part) {
          return String((part as { value: string }).value ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof contents === 'object' && contents !== null && 'value' in contents) {
    return String((contents as { value: string }).value ?? '').trim();
  }
  return String(contents).trim();
}
