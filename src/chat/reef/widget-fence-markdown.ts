/**
 * Helpers for patching ```reef-widget fences inside assistant markdown.
 */

const REEF_WIDGET_FENCE_RE = /```reef-widget\r?\n([\s\S]*?)```/g;

/** Extract fence bodies in document order. */
export function listReefWidgetFenceBodies(markdown: string): string[] {
  const bodies: string[] = [];
  const re = new RegExp(REEF_WIDGET_FENCE_RE.source, REEF_WIDGET_FENCE_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    bodies.push(match[1]);
  }
  return bodies;
}

/**
 * Replace one reef-widget fence body by index (0-based). Returns original markdown when index is out of range.
 */
export function replaceReefWidgetFenceInMarkdown(
  markdown: string,
  newBody: string,
  widgetIndex = 0,
): string {
  const trimmedBody = newBody.trim();
  let index = 0;
  return markdown.replace(REEF_WIDGET_FENCE_RE, (full, body) => {
    if (index !== widgetIndex) {
      index += 1;
      return full;
    }
    index += 1;
    if (body === trimmedBody) return full;
    return `\`\`\`reef-widget\n${trimmedBody}\n\`\`\``;
  });
}

/** Parse the first ```reef-widget block from a model reply (repair completion). */
export function extractFirstReefWidgetFenceBody(text: string): string | null {
  const match = text.match(/```reef-widget\r?\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}
