/**
 * Browser client for LSP document sync, completion, hover, diagnostics, and navigation.
 */

import { isLocalServerAvailable } from '../tools/config';

/** Completion context forwarded to the LSP bridge. */
export interface LspCompletionContext {
  triggerKind: number;
  triggerCharacter?: string;
}

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
  /** InsertReplaceEdit — used when the selection is empty. */
  textEditInsertRange?: LspRange;
  /** InsertReplaceEdit — used when the selection is non-empty. */
  textEditReplaceRange?: LspRange;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
  commitCharacters?: string[];
}

/** Response payload from POST /api/lsp/completion */
export interface LspCompletionResponse {
  items: LspCompletionItem[];
  isIncomplete?: boolean;
  triggerCharacters?: string[];
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

export type LspClientPostErrorKind = 'offline' | 'http' | 'server';

export type LspClientPostResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: LspClientPostErrorKind; status?: number; error?: string };

/** Last LSP bridge failure from the browser client (for UI hints). */
let lastLspClientPostError: LspClientPostResult<never> | null = null;

export function getLastLspClientPostError(): LspClientPostResult<never> | null {
  return lastLspClientPostError;
}

async function postLspJson<T>(
  pathname: string,
  body: Record<string, unknown>,
): Promise<LspClientPostResult<T>> {
  if (!isLocalServerAvailable()) {
    const result = { ok: false as const, kind: 'offline' as const };
    lastLspClientPostError = result;
    return result;
  }
  try {
    const res = await fetch(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    if (!res.ok) {
      const result = {
        ok: false as const,
        kind: 'http' as const,
        status: res.status,
        error: typeof json.error === 'string' ? json.error : res.statusText,
      };
      lastLspClientPostError = result;
      return result;
    }
    if (typeof json.error === 'string' && json.error) {
      const result = { ok: false as const, kind: 'server' as const, error: json.error };
      lastLspClientPostError = result;
      return result;
    }
    lastLspClientPostError = null;
    return { ok: true, data: json as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result = { ok: false as const, kind: 'offline' as const, error: message };
    lastLspClientPostError = result;
    return result;
  }
}

/** Notify the Node LSP bridge of editor document lifecycle events. */
export async function notifyLspDocument(
  path: string,
  event: 'open' | 'change' | 'close',
  text?: string,
): Promise<void> {
  if (!isLocalServerAvailable()) return;
  try {
    await fetch('/api/lsp/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, event, ...(text !== undefined ? { text } : {}) }),
    });
  } catch {}
}

export interface FetchCompletionsOptions {
  editorText?: string;
  context?: LspCompletionContext;
}

/** Fetch completion items at a 0-based line/character (LSP positions). */
export async function fetchCompletions(
  path: string,
  line: number,
  character: number,
  options?: FetchCompletionsOptions,
): Promise<LspCompletionResponse> {
  const body: Record<string, unknown> = { path, line, character };
  if (options?.editorText !== undefined) {
    body.text = options.editorText;
  }
  if (options?.context) {
    body.context = options.context;
  }
  const data = await postLspJson<{
    items?: LspCompletionItem[];
    isIncomplete?: boolean;
    triggerCharacters?: string[];
  }>('/api/lsp/completion', body);
  if (!data.ok) {
    return { items: [], isIncomplete: false };
  }
  const payload = data.data;
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    isIncomplete: payload?.isIncomplete === true,
    triggerCharacters: Array.isArray(payload?.triggerCharacters)
      ? payload.triggerCharacters.map(String)
      : undefined,
  };
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
  return data.ok ? (data.data.item ?? null) : null;
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
  return data.ok ? (data.data.hover ?? null) : null;
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
  return data.ok ? (data.data.locations ?? null) : null;
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
  return data.ok ? (data.data.signatureHelp ?? null) : null;
}

/** Structured diagnostics for squiggles (not LLM-formatted text). */
export async function fetchLspDiagnostics(
  path: string,
  editorText?: string,
): Promise<LspStructuredDiagnostic[]> {
  const body: Record<string, unknown> = { path };
  if (editorText !== undefined) {
    body.text = editorText;
  }
  const data = await postLspJson<{ diagnostics?: LspStructuredDiagnostic[] }>(
    '/api/lsp/diagnostics-structured',
    body,
  );
  return data.ok && Array.isArray(data.data.diagnostics) ? data.data.diagnostics : [];
}

/** Document symbol tree node from POST /api/lsp/document-symbols. */
export interface LspDocumentSymbol {
  name: string;
  kind?: number;
  range?: LspRange;
  selectionRange?: LspRange;
  children?: LspDocumentSymbol[];
}

/** Fetch document symbols for editor AI context (graceful empty on failure). */
export async function fetchLspDocumentSymbols(
  path: string,
): Promise<{ symbols: LspDocumentSymbol[] }> {
  const data = await postLspJson<{ symbols?: LspDocumentSymbol[] }>(
    '/api/lsp/document-symbols',
    { path },
  );
  return {
    symbols: data.ok && Array.isArray(data.data.symbols) ? data.data.symbols : [],
  };
}

export interface LspFormatResponse {
  edits: LspTextEdit[];
  serverId?: string;
  error?: string;
}

/** Whole-document format via POST /api/lsp/format. */
export async function fetchLspDocumentFormat(
  path: string,
  options?: { text?: string; tabSize?: number; insertSpaces?: boolean },
): Promise<LspFormatResponse> {
  const body: Record<string, unknown> = { path };
  if (options?.text !== undefined) body.text = options.text;
  if (options?.tabSize !== undefined) body.tabSize = options.tabSize;
  if (options?.insertSpaces !== undefined) body.insertSpaces = options.insertSpaces;
  const data = await postLspJson<LspFormatResponse>('/api/lsp/format', body);
  if (!data.ok) {
    return { edits: [], error: data.error };
  }
  const payload = data.data;
  return {
    edits: Array.isArray(payload.edits) ? payload.edits : [],
    serverId: payload.serverId,
    error: payload.error,
  };
}
