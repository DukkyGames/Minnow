/**
 * SSE framing helpers for OpenAI-style chat completion streams.
 * Splits on blank-line event boundaries, joins multi-line `data:` fields, and
 * tolerates concatenated JSON objects in a single payload (llmster / proxy quirks).
 */
import type { ChatCompletionChunk } from '../../src/types.js';
/** Normalize CRLF / lone CR so event boundaries are consistent. */
export declare function normalizeSseText(text: string): string;
/** Detect Express/Vite-style HTML error pages mistaken for JSON/SSE bodies. */
export declare function looksLikeHtmlErrorPage(text: string): boolean;
/**
 * Parse the first complete JSON value in a string (handles `{}{}` glued payloads).
 * Returns null when no valid object/array starts at offset zero.
 */
export declare function extractFirstJsonValue(text: string): string | null;
/**
 * Walk a buffer that may contain multiple concatenated JSON values (`{}{}`).
 * Invokes `onSlice` for each complete top-level object/array substring.
 */
export declare function forEachJsonValueInText(text: string, onSlice: (jsonSlice: string) => void): void;
/**
 * Parse one SSE event block (lines between blank-line separators).
 * Joins multiple `data:` lines per the SSE spec before JSON.parse.
 */
export declare function parseSseEventBlock(block: string, onChunk: (chunk: ChatCompletionChunk) => void): void;
/**
 * mlx-lm SSE comment: `: keepalive 128/4096`. Extra whitespace is tolerated.
 * Returns null for unrelated comments (`: ping`, `: connected`, ...).
 */
export declare function parseKeepaliveComment(line: string): {
    processed: number;
    total: number;
} | null;
/** Incremental buffer: feed UTF-8 text; emits complete SSE events. */
export interface SseEventBuffer {
    buffer: string;
}
export declare function createSseEventBuffer(): SseEventBuffer;
/** Append decoded stream text and invoke onChunk for each completed SSE event. */
export declare function feedSseEventBuffer(state: SseEventBuffer, text: string, onChunk: (chunk: ChatCompletionChunk) => void): void;
/** Flush trailing bytes after the upstream stream ends. */
export declare function flushSseEventBuffer(state: SseEventBuffer, onChunk: (chunk: ChatCompletionChunk) => void): void;
/**
 * Parse a full response body from {@link postChatCompletions} (JSON or SSE bytes).
 * Used by non-streaming fallback — never call Response.json() on the SSE shim.
 */
export declare function parseCompletionResponseBody(text: string): ChatCompletionChunk;
/** Legacy line-based parser (single-line `data:` rows). Kept for tests and small snippets. */
export declare function parseSsePayloads(text: string, onChunk: (chunk: ChatCompletionChunk) => void): void;
