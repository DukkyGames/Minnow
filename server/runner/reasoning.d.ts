/**
 * LM Studio reasoning streams: separate from assistant prose (`content`).
 * Supports `delta.reasoning` / `delta.reasoning_content` / `delta.thinking`
 * and non-streaming message fields.
 */
import type { ApiAssistantMessage } from '../../src/types.js';
import type { ChatCompletionChunk } from '../../src/types.js';
/** Pull reasoning text from one SSE JSON chunk (streaming). */
export declare function extractReasoningDelta(chunk: ChatCompletionChunk): string;
/** Anthropic extended-thinking signature from a streamed reasoning delta (if present). */
export declare function extractReasoningSignatureDelta(chunk: ChatCompletionChunk): string;
/** Reasoning string from a non-streaming completion message object. */
export declare function extractReasoningMessage(message: {
    reasoning?: string;
    reasoning_content?: string;
    thinking?: string;
} | null | undefined): string;
/**
 * Split accumulated reasoning into discrete "thoughts" on paragraph breaks.
 * Trims segments and drops empty entries.
 */
export declare function splitThinkingSegments(buffer: string): string[];
/**
 * DeepSeek thinking mode (incl. OpenCode Go) requires `reasoning_content` on assistant
 * tool-loop turns — omitting it yields HTTP 400 on the next request.
 */
export declare function modelRequiresReasoningContentReplay(modelId: string): boolean;
/** Kimi / Moonshot APIs reject `reasoning` (and related) fields on chat message objects. */
export declare function modelRejectsMessageReasoningReplay(modelId: string): boolean;
export interface OutboundReasoningReplayOptions {
    /** DeepSeek tool-loop rows must always include `reasoning_content` (may be empty). */
    toolCallTurn?: boolean;
}
/** Outbound assistant fields for replaying reasoning on follow-up completions. */
export declare function outboundReasoningReplayFields(modelId: string, reasoningText: string, thinkingSignature?: string, options?: OutboundReasoningReplayOptions): Pick<ApiAssistantMessage, 'reasoning' | 'reasoning_content' | 'reasoning_signature'>;
