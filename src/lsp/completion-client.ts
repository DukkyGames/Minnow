/**
 * Browser client for LSP document sync and completion (requires npm start).
 */

import { detectLocalServer } from '../tools/client';

/** Completion item returned by POST /api/lsp/completion */
export interface LspCompletionItem {
  label: string;
  insertText: string;
  kind?: number;
  detail?: string;
}

/** Notify the Node LSP bridge of editor document lifecycle events. */
export async function notifyLspDocument(
  path: string,
  event: 'open' | 'change' | 'close',
  text?: string,
): Promise<void> {
  const ok = await detectLocalServer();
  if (!ok) return;
  try {
    await fetch('/api/lsp/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, event, ...(text !== undefined ? { text } : {}) }),
    });
  } catch {
    /* offline or transient — completions degrade gracefully */
  }
}

/** Fetch completion items at a 0-based line/character (LSP positions). */
export async function fetchCompletions(
  path: string,
  line: number,
  character: number,
): Promise<LspCompletionItem[]> {
  const ok = await detectLocalServer();
  if (!ok) return [];
  try {
    const res = await fetch('/api/lsp/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, line, character }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: LspCompletionItem[] };
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}
