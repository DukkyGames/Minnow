/**
 * Optional LSP hover fetch for editor AI prompt context (Phase 4).
 * Gracefully no-ops when the server route is unavailable.
 */

import { detectLocalServer } from '../tools/client';
import type { LspHoverResult } from './completion-client';
import { hoverContentsToPlainText } from './hover-contents';

export { hoverContentsToPlainText } from './hover-contents';

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
