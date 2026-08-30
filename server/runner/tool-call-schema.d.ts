/**
 * Build per-turn JSON Schema for constrained tool-call decoding.
 */
import type { OpenAIFunctionDefinition } from '../../src/tools/definitions.js';
import type { ResponseFormatJsonSchema } from '../../src/providers/completion-types.js';
/** Max tool branches in the constrained schema (matches practical turn limits). */
export declare const MAX_TOOL_CALL_SCHEMA_BRANCHES = 8;
/**
 * Build a strict root schema: `{ tool_calls: [{ name, arguments }] }` with oneOf per tool.
 * Returns null when there are no tools (caller must not attach response_format).
 */
export declare function buildToolCallResponseFormat(tools: OpenAIFunctionDefinition[]): ResponseFormatJsonSchema | null;
