/**
 * Parse persisted user message content (text, file blocks, image placeholders).
 * Format matches {@link buildHistoryUserContent} in tools/loop.ts.
 */

/** One inlined text/PDF attachment from history. */
export interface HistoryFilePart {
  name: string;
  body: string;
}

/** One image placeholder from history (`[image: name]`). */
export interface HistoryImagePart {
  name: string;
}

/** Editor selection reference (`<code-ref path="…" start="…" end="…">`). */
export interface HistoryCodeRefPart {
  workspacePath: string;
  startLine: number;
  endLine: number;
  body: string;
}

/** Parsed segments for chat UI rendering. */
export interface ParsedHistoryUserMessage {
  /** User-typed prose without attachment markers or file bodies. */
  text: string;
  files: HistoryFilePart[];
  images: HistoryImagePart[];
  codeRefs: HistoryCodeRefPart[];
}

const FILE_BLOCK_RE = /<file name="([^"]*)">\n([\s\S]*?)\n<\/file>/g;
const CODE_REF_BLOCK_RE =
  /<code-ref path="([^"]*)" start="(\d+)" end="(\d+)">\n([\s\S]*?)\n<\/code-ref>/g;
const IMAGE_PLACEHOLDER_RE = /\[image:\s*([^\]]+)\]/g;

/** Remove attachment blocks from visible prose; collapse extra blank lines. */
function stripAttachmentMarkers(content: string): string {
  const withoutFiles = content.replace(FILE_BLOCK_RE, '');
  const withoutCodeRefs = withoutFiles.replace(CODE_REF_BLOCK_RE, '');
  const withoutImages = withoutCodeRefs.replace(IMAGE_PLACEHOLDER_RE, '');
  return withoutImages.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Split persisted user `content` into display text and attachment parts.
 * Skill tags are left in `text` for callers that strip them separately.
 */
export function parseHistoryUserContent(content: string): ParsedHistoryUserMessage {
  const files: HistoryFilePart[] = [];
  const images: HistoryImagePart[] = [];
  const codeRefs: HistoryCodeRefPart[] = [];

  for (const match of content.matchAll(FILE_BLOCK_RE)) {
    const name = match[1] ?? '';
    const body = match[2] ?? '';
    if (name) files.push({ name, body });
  }

  for (const match of content.matchAll(CODE_REF_BLOCK_RE)) {
    const workspacePath = match[1] ?? '';
    const startLine = Number(match[2]);
    const endLine = Number(match[3]);
    const body = match[4] ?? '';
    if (workspacePath && Number.isFinite(startLine) && Number.isFinite(endLine)) {
      codeRefs.push({
        workspacePath,
        startLine,
        endLine,
        body,
      });
    }
  }

  for (const match of content.matchAll(IMAGE_PLACEHOLDER_RE)) {
    const name = (match[1] ?? '').trim();
    if (name) images.push({ name });
  }

  return {
    text: stripAttachmentMarkers(content),
    files,
    images,
    codeRefs,
  };
}

/** True when content includes inlined files or image placeholders. */
export function historyUserContentHasAttachments(content: string): boolean {
  FILE_BLOCK_RE.lastIndex = 0;
  CODE_REF_BLOCK_RE.lastIndex = 0;
  IMAGE_PLACEHOLDER_RE.lastIndex = 0;
  return (
    FILE_BLOCK_RE.test(content) ||
    CODE_REF_BLOCK_RE.test(content) ||
    IMAGE_PLACEHOLDER_RE.test(content)
  );
}
