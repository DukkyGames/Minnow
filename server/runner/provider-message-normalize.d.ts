/**
 * Provider-specific outbound message fixes (LM Studio Jinja, etc.).
 */
import type { ApiMessage } from '../../src/types.js';
/**
 * Stand-in result for a `tool_call` the harness never recorded an answer for
 * (aborted batch, crashed executor, context trim that severed the pair).
 */
export declare const MISSING_TOOL_RESULT_CONTENT = "Tool call did not complete; no result was recorded.";
/**
 * Guarantee every assistant `tool_calls` id has exactly one matching `tool` row.
 *
 * Every OpenAI-compatible provider 400s a history where an assistant announced a
 * tool call with no result, or where a `tool` row answers an id nobody requested.
 * Once such a row is persisted the chat is unsendable forever, so repair on the
 * way out rather than trusting the loop to never orphan a call.
 */
export declare function repairUnpairedToolCalls(messages: ApiMessage[]): ApiMessage[];
/**
 * LM Studio / Qwen Jinja templates reject histories that start with assistant
 * prose before the first user turn ("No user query found in messages").
 * Fold that preamble into the system block; UI history is unchanged.
 */
export declare function foldLeadingAssistantPreamble(messages: ApiMessage[]): ApiMessage[];
