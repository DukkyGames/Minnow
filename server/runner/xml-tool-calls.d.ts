/**
 * Parse and stream-route XML-tagged tool calls embedded in assistant `content`.
 *
 * Qwen-family chat templates (and the mlx-lm / llama.cpp / MTPLX servers that serve them)
 * emit `<tool_call>{"name":…,"arguments":{…}}</tool_call>` or the native
 * `<function=name><parameter=key>value</parameter></function>` envelope as plain text
 * instead of OpenAI `delta.tool_calls`. Without this the block is rendered as prose
 * (or swallowed as reasoning), no tool ever runs, and the model retries until the
 * generation buffer overflows.
 */
import type { ToolCall } from '../../src/types.js';
/** True when the text carries at least one XML-tagged tool call opener. */
export declare function hasXmlToolCallMarkup(text: string): boolean;
/**
 * Parse every `<tool_call>…</tool_call>` block in assistant text.
 * An unterminated trailing block is still parsed so a stream cut at the close tag works.
 */
export declare function tryParseXmlToolCallsFromText(text: string): ToolCall[];
/** Drop `<tool_call>` blocks from prose that was captured before routing existed. */
export declare function stripXmlToolCallBlocks(text: string): string;
/**
 * Stateful splitter that keeps `<tool_call>` payloads out of the visible reply
 * or Thoughts panel. Feed it content *or* native reasoning deltas; the captured
 * blocks are exposed via {@link getToolCallParseText} for post-stream parsing.
 */
export declare class ContentToolCallRouter {
    private buffer;
    private capturing;
    private captured;
    /** Literal opener that started the current block, for verbatim replay. */
    private capturedOpenTag;
    private parseText;
    /** Visible prose for `text`, with tool-call markup withheld. */
    feed(text: string): string;
    /** Release held bytes; an unterminated block still counts as a call when it parses. */
    flush(): string;
    /** Captured `<tool_call>` blocks, re-wrapped canonically for parsing. */
    getToolCallParseText(): string;
    /** True once a block on this stream parsed as a tool call. */
    hasCapturedToolCalls(): boolean;
    /**
     * Name of a captured or still-open tool-call envelope, for live "Calling {tool}…"
     * chrome when the call arrived on the reasoning channel instead of `delta.tool_calls`.
     */
    peekStreamingToolName(): string;
    /**
     * End the current block. Returns text to put back into prose when the payload
     * is not a tool call — a model explaining the format keeps its markup visible.
     */
    private closeBlock;
    private drain;
}
