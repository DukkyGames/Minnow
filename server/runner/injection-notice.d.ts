/**
 * Persisted transcript rows for Brain / code-map prompt injection (UI-only).
 */
import type { Chat, ContextNoticeMessage, InjectionNoticeMessage, Message, PromptInjectionKind } from '../../src/types.js';
export interface PromptInjectionBlocks {
    brainNotes: string | null;
    codeMap: string | null;
    contextDocuments: string | null;
}
export declare function injectionNoticeLabel(kind: PromptInjectionKind): string;
/** Primary label for the injection transcript row (tool-call action column). */
export declare function injectionNoticeAction(kind: PromptInjectionKind): string;
/** Bench-style outcome text for the injection transcript row. */
export declare function injectionNoticeOutcome(body?: string): string;
export declare function isUiOnlyTranscriptRole(role: Message['role']): boolean;
export declare function isUiOnlyTranscriptMessage(msg: Message): msg is ContextNoticeMessage | InjectionNoticeMessage;
export declare function isInjectionNoticeMessage(msg: Message): msg is InjectionNoticeMessage;
/**
 * Append 0–3 injection notice rows after the user message for this send.
 * Also stamps `chat.injectedContext` so later turns can replay if history drops the rows.
 */
export declare function appendInjectionNoticesForTurn(chat: Chat, blocks: PromptInjectionBlocks): InjectionNoticeMessage[];
