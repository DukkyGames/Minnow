export interface ParsedCompressCommand {
  kind: 'compress' | 'summarize-alias';
}

const COMPRESS_RE = /^\s*\/(?:compress|summarize)\s*$/i;

/** True when raw composer text is a manual compress command. */
export function parseCompressSlashInput(rawText: string): ParsedCompressCommand | null {
  if (!COMPRESS_RE.test(rawText)) return null;
  const lower = rawText.trim().toLowerCase();
  return {
    kind: lower.startsWith('/summarize') ? 'summarize-alias' : 'compress',
  };
}
