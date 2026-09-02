/**
 * Some OpenAI-compatible providers return constrained tool calls as JSON in
 * assistant message text instead of streaming `delta.tool_calls`. Merge that
 * shape into normal `ToolCall[]` so the tool loop can execute tools.
 */
import type { ToolCall } from '../../src/types.js';
/**
 * Parse `{"tool_calls":[{ "name", "arguments" }|{ "function": { name, arguments }}]}` from
 * assistant `content` when SSE `tool_calls` deltas were empty.
 */
export declare function tryParseToolCallsFromAssistantContent(text: string): ToolCall[];
/** True when serialized tool arguments carry no usable fields (e.g. `{}` or blank). */
export declare function isEmptyToolArgumentsJson(argumentsRaw: string): boolean;
/** Score parsed tool arguments so partial SSE payloads lose to fuller content JSON. */
export declare function toolArgumentsRichnessScore(argumentsRaw: string): number;
/**
 * Prefer streamed `tool_calls`; when empty, recover tool calls embedded in assistant text.
 * When both exist (common with constrained decoding), keep streamed ids but prefer
 * non-empty `arguments` from assistant JSON when SSE only delivered `{}`.
 * Harmony / gpt-oss commentary-channel payloads are parsed when SSE `tool_calls` are empty,
 * as are Qwen-style `<tool_call>` blocks from mlx-lm / llama.cpp servers.
 *
 * `thinkingXmlParseText` holds `<tool_call>` blocks captured inside a `<think>` span
 * or on the native `reasoning_content` channel (Qwen3.8 / MTPLX emit the call *before*
 * `</think>`, and some servers map that span onto reasoning instead of `content`).
 * It is a last-resort fallback only: a model that drafts a call while reasoning and
 * then calls something else must never have its streamed arguments rewritten from the draft.
 */
export declare function mergeContentJsonToolCalls(fullText: string, streamed: ToolCall[], options?: {
    harmonyParseText?: string;
    xmlParseText?: string;
    thinkingXmlParseText?: string;
}): ToolCall[];
