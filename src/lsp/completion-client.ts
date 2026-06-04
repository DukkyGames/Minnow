/**
 * Browser client for LSP document sync, completion, hover, diagnostics, and navigation.
 */

import { detectLocalServer } from '../tools/client';

/** Completion item returned by POST /api/lsp/completion */
export interface LspCompletionItem {
  label: string;
  insertText: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: 'markdown' | 'plaintext'; value: string };
  data?: unknown;
  insertTextFormat?: number;
  additionalTextEdits?: LspTextEdit[];
  /** When set, replace this LSP range instead of the matched word span. */
  textEditRange?: LspRange;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspStructuredDiagnostic {
  message: string;
  severity: number;
  source?: string;
  code?: string;
  range: LspRange;
}

export interface LspHoverResult {
  contents?: unknown;
  range?: LspRange;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspSignatureHelp {
  signatures?: Array<{
    label?: string;
    documentation?: unknown;
    parameters?: Array<{ label?: string | [number, number]; documentation?: unknown }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}

async function postLspJson<T>(pathname: string, body: Record<string, unknown>): Promise<T | null> {
  const ok = await detectLocalServer();
  if (!ok) return null;
  try {
    const res = await fetch(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
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
    /* offline or transient — LSP UX degrades gracefully */
  }
}

/** Fetch completion items at a 0-based line/character (LSP positions). */
export async function fetchCompletions(
  path: string,
  line: number,
  character: number,
): Promise<LspCompletionItem[]> {
  const data = await postLspJson<{ items?: LspCompletionItem[] }>('/api/lsp/completion', {
    path,
    line,
    character,
  });
  return Array.isArray(data?.items) ? data.items : [];
}

/** Resolve a completion item (documentation, additionalTextEdits). */
export async function resolveLspCompletion(
  path: string,
  item: LspCompletionItem,
): Promise<LspCompletionItem | null> {
  const data = await postLspJson<{ item?: LspCompletionItem | null }>('/api/lsp/resolve', {
    path,
    item,
  });
  return data?.item ?? null;
}

/** Hover at a 0-based LSP position. */
export async function fetchLspHover(
  path: string,
  line: number,
  character: number,
): Promise<LspHoverResult | null> {
  const data = await postLspJson<{ hover?: LspHoverResult | null }>('/api/lsp/hover', {
    path,
    line,
    character,
  });
  return data?.hover ?? null;
}

/** Definition / declaration targets at a 0-based LSP position. */
export async function fetchLspDefinition(
  path: string,
  line: number,
  character: number,
): Promise<LspLocation | LspLocation[] | null> {
  const data = await postLspJson<{ locations?: LspLocation | LspLocation[] | null }>(
    '/api/lsp/definition',
    { path, line, character },
  );
  return data?.locations ?? null;
}

/** Signature help at a 0-based LSP position. */
export async function fetchLspSignature(
  path: string,
  line: number,
  character: number,
): Promise<LspSignatureHelp | null> {
  const data = await postLspJson<{ signatureHelp?: LspSignatureHelp | null }>(
    '/api/lsp/signature',
    { path, line, character },
  );
  return data?.signatureHelp ?? null;
}

/** Structured diagnostics for squiggles (not LLM-formatted text). */
export async function fetchLspDiagnostics(path: string): Promise<LspStructuredDiagnostic[]> {
  const data = await postLspJson<{ diagnostics?: LspStructuredDiagnostic[] }>(
    '/api/lsp/diagnostics-structured',
    { path },
  );
  return Array.isArray(data?.diagnostics) ? data.diagnostics : [];
}
