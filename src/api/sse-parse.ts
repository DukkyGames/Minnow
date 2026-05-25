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

/** Try JSON.parse on payload; on glued JSON, parse only the first value. */
function parseOpenAiChunkPayload(
  payload: string,
  onChunk: (chunk: ChatCompletionChunk) => void,
): void {
  if (!payload || payload === '[DONE]') return;

  try {
    onChunk(JSON.parse(payload) as ChatCompletionChunk);
    return;
  } catch {
    const first = extractFirstJsonValue(payload);
    if (!first) return;
    try {
      onChunk(JSON.parse(first) as ChatCompletionChunk);
    } catch {
      /* Ignore malformed provider payloads. */
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

/**
 * Parse a full response body from {@link postChatCompletions} (JSON or SSE bytes).
 * Used by non-streaming fallback — never call Response.json() on the SSE shim.
 */
export function parseCompletionResponseBody(text: string): ChatCompletionChunk {
  const normalized = normalizeSseText(text).trim();
  if (!normalized) {
    throw new Error('Empty completion response');
  }

  if (normalized.startsWith('{') || normalized.startsWith('[')) {
    const first = extractFirstJsonValue(normalized) ?? normalized;
    try {
      const parsed = JSON.parse(first) as ChatCompletionChunk | ChatCompletionChunk[];
      if (Array.isArray(parsed)) {
        return parsed[parsed.length - 1] ?? ({} as ChatCompletionChunk);
      }
      return parsed;
    } catch {
      /* Fall through — body may be SSE with leading noise. */
    }
  }

  let last: ChatCompletionChunk | null = null;
  const state = createSseEventBuffer();
  feedSseEventBuffer(state, normalized, (chunk) => {
    last = chunk;
  });
  flushSseEventBuffer(state, (chunk) => {
    last = chunk;
  });

  if (last) return last;
  throw new Error('Could not parse completion response');
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
