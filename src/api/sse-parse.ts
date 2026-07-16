/**
 * SSE framing helpers for OpenAI-style chat completion streams.
 * Splits on blank-line event boundaries, joins multi-line `data:` fields, and
 * tolerates concatenated JSON objects in a single payload (llmster / proxy quirks).
 */

import type { ChatCompletionChunk } from '../types';

/** Normalize CRLF / lone CR so event boundaries are consistent. */
export function normalizeSseText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Detect Express/Vite-style HTML error pages mistaken for JSON/SSE bodies. */
export function looksLikeHtmlErrorPage(text: string): boolean {
  const head = text.trim().slice(0, 256).toLowerCase();
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.includes('<pre>internal server error</pre>')
  );
}

/**
 * Parse the first complete JSON value in a string (handles `{}{}` glued payloads).
 * Returns null when no valid object/array starts at offset zero.
 */
export function extractFirstJsonValue(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const start = trimmed[0];
  if (start !== '{' && start !== '[') return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }

    if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(0, i + 1);
      }
    }
  }

  return null;
}

/**
 * Walk a buffer that may contain multiple concatenated JSON values (`{}{}`).
 * Invokes `onSlice` for each complete top-level object/array substring.
 */
export function forEachJsonValueInText(
  text: string,
  onSlice: (jsonSlice: string) => void,
): void {
  let rest = text.trim();
  while (rest.length > 0) {
    const first = extractFirstJsonValue(rest);
    if (!first) break;
    onSlice(first);
    rest = rest.slice(first.length).trim();
  }
}

/** Try JSON.parse on payload; on glued JSON, emit every concatenated chunk. */
function parseOpenAiChunkPayload(
  payload: string,
  onChunk: (chunk: ChatCompletionChunk) => void,
): void {
  if (!payload || payload === '[DONE]') return;

  const trimmed = payload.trim();
  if (!trimmed) return;

  try {
    onChunk(JSON.parse(trimmed) as ChatCompletionChunk);
    return;
  } catch {
    let parsedAny = false;
    forEachJsonValueInText(trimmed, (jsonSlice) => {
      try {
        onChunk(JSON.parse(jsonSlice) as ChatCompletionChunk);
        parsedAny = true;
      } catch {
        /* Ignore malformed provider payloads. */
      }
    });
    if (!parsedAny) {
      /* no-op */
    }
  }
}

/**
 * Parse one SSE event block (lines between blank-line separators).
 * Joins multiple `data:` lines per the SSE spec before JSON.parse.
 */
export function parseSseEventBlock(
  block: string,
  onChunk: (chunk: ChatCompletionChunk) => void,
): void {
  const dataLines: string[] = [];

  for (const line of normalizeSseText(block).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    if (trimmed.startsWith('data:')) {
      dataLines.push(trimmed.slice(5).trim());
    }
  }

  if (!dataLines.length) return;

  const payload = dataLines.join('\n');
  parseOpenAiChunkPayload(payload, onChunk);
}

/** Incremental buffer: feed UTF-8 text; emits complete SSE events. */
export interface SseEventBuffer {
  buffer: string;
}

export function createSseEventBuffer(): SseEventBuffer {
  return { buffer: '' };
}

/** Append decoded stream text and invoke onChunk for each completed SSE event. */
export function feedSseEventBuffer(
  state: SseEventBuffer,
  text: string,
  onChunk: (chunk: ChatCompletionChunk) => void,
): void {
  state.buffer += normalizeSseText(text);

  let endIndex = state.buffer.indexOf('\n\n');
  while (endIndex >= 0) {
    const block = state.buffer.slice(0, endIndex);
    state.buffer = state.buffer.slice(endIndex + 2);
    if (block.trim()) {
      parseSseEventBlock(block, onChunk);
    }
    endIndex = state.buffer.indexOf('\n\n');
  }
}

/** Flush trailing bytes after the upstream stream ends. */
export function flushSseEventBuffer(
  state: SseEventBuffer,
  onChunk: (chunk: ChatCompletionChunk) => void,
): void {
  if (!state.buffer.trim()) {
    state.buffer = '';
    return;
  }
  parseSseEventBlock(state.buffer, onChunk);
  state.buffer = '';
}

/** True when a completion chunk carries assistant text or structured parsed JSON. */
function completionChunkHasAssistantMessage(chunk: ChatCompletionChunk): boolean {
  const msg = chunk.choices?.[0]?.message;
  if (!msg) return false;
  return (
    msg.content != null ||
    msg.parsed != null ||
    msg.reasoning != null ||
    msg.reasoning_content != null
  );
}

/** Prefer the last chunk that carries assistant content over trailing control events. */
function selectBestCompletionChunk(
  last: ChatCompletionChunk | null,
  lastWithMessage: ChatCompletionChunk | null,
): ChatCompletionChunk | null {
  if (lastWithMessage) return lastWithMessage;
  return last;
}

/**
 * Parse a full response body from {@link postChatCompletions} (JSON or SSE bytes).
 * Used by non-streaming fallback — never call Response.json() on the SSE shim.
 */
export function parseCompletionResponseBody(text: string): ChatCompletionChunk {
  const normalized = normalizeSseText(text).trim();
  if (!normalized) {
    throw new Error('Empty completion response');
  }
  if (looksLikeHtmlErrorPage(normalized)) {
    throw new Error(
      'Provider returned an HTML error page instead of JSON (check LM Studio / provider is running and the model is loaded)',
    );
  }

  if (normalized.startsWith('{') || normalized.startsWith('[')) {
    const tryParseChunk = (slice: string): ChatCompletionChunk | null => {
      try {
        const parsed = JSON.parse(slice) as ChatCompletionChunk | ChatCompletionChunk[];
        if (Array.isArray(parsed)) {
          return parsed[parsed.length - 1] ?? null;
        }
        return parsed;
      } catch {
        return null;
      }
    };

    const direct = tryParseChunk(normalized);
    if (direct) return direct;

    let lastGlued: ChatCompletionChunk | null = null;
    let lastWithMessage: ChatCompletionChunk | null = null;
    forEachJsonValueInText(normalized, (jsonSlice) => {
      const chunk = tryParseChunk(jsonSlice);
      if (!chunk) return;
      lastGlued = chunk;
      if (completionChunkHasAssistantMessage(chunk)) {
        lastWithMessage = chunk;
      }
    });
    const glued = selectBestCompletionChunk(lastGlued, lastWithMessage);
    if (glued) return glued;
  }

  let last: ChatCompletionChunk | null = null;
  let lastWithMessage: ChatCompletionChunk | null = null;
  const state = createSseEventBuffer();
  const trackCompletionChunk = (chunk: ChatCompletionChunk): void => {
    last = chunk;
    if (completionChunkHasAssistantMessage(chunk)) {
      lastWithMessage = chunk;
    }
  };
  feedSseEventBuffer(state, normalized, trackCompletionChunk);
  flushSseEventBuffer(state, trackCompletionChunk);

  const selected = selectBestCompletionChunk(last, lastWithMessage);
  if (selected) return selected;
  const preview =
    normalized.length > 200 ? `${normalized.slice(0, 200)}…` : normalized;
  throw new Error(
    `Could not parse completion response (body preview: ${preview.replace(/\s+/g, ' ').trim()})`,
  );
}

/** Legacy line-based parser (single-line `data:` rows). Kept for tests and small snippets. */
export function parseSsePayloads(
  text: string,
  onChunk: (chunk: ChatCompletionChunk) => void,
): void {
  const state = createSseEventBuffer();
  feedSseEventBuffer(state, `${normalizeSseText(text)}\n\n`, onChunk);
  flushSseEventBuffer(state, onChunk);
}
