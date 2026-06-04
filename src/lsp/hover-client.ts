/**
 * Optional LSP hover fetch for editor AI prompt context (Phase 4).
 * Gracefully no-ops when the server route is unavailable.
 */

import { detectLocalServer } from '../tools/client';
import type { LspHoverResult } from './completion-client';

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

/** Markdown/plain hover text from POST /api/lsp/hover when supported. */
export async function fetchLspHover(
  path: string,
  line: number,
  character: number,
): Promise<string | null> {
  const ok = await detectLocalServer();
  if (!ok) return null;
  try {
    const res = await fetch('/api/lsp/hover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, line, character }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { hover?: LspHoverResult | null };
    const text = hoverContentsToPlainText(data.hover?.contents);
    return text || null;
  } catch {
    return null;
  }
}
