/**
 * Normalize OpenAI-style message `content` (string or multimodal parts) to plain text.
 */
import type { ApiMessageContent, ContentPart } from '../../src/types.js';
/** Join text parts; non-text parts become short placeholders for estimates / logs. */
export declare function contentPartsToText(parts: ContentPart[]): string;
/** User/assistant API `content` field → display or token-estimate string. */
export declare function apiMessageContentToText(content: ApiMessageContent): string;
/**
 * Streaming `delta.content` may be a string or structured parts (provider-specific).
 * Always returns a string fragment to append to the completion buffer.
 */
export declare function streamDeltaContentToText(raw: unknown): string;
type StreamChoiceSlice = {
    delta?: {
        content?: unknown;
    };
    message?: {
        content?: unknown;
    };
};
/**
 * Merge streaming assistant `content` (string fragments or indexed part arrays).
 * Handles providers that send cumulative text on the same part index.
 */
export declare class StreamingContentAccumulator {
    private readonly parts;
    /** Apply one SSE choice's delta or message content. */
    ingestChoice(choice: StreamChoiceSlice | undefined): void;
    /** Join merged parts in index order. */
    getText(): string;
    private ingestContent;
    private ingestPartItem;
    private appendToPart;
}
export {};
