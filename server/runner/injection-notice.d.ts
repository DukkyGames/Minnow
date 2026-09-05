/**
 * Persisted transcript rows for Brain / code-map prompt injection (UI-only).
 */
import type { Chat, ContextNoticeMessage, InjectionNoticeMessage, Message, PromptInjectionKind } from '../../src/types.js';
/** Suffix appended by {@link appendInjectionNoticesForTurn} when a body is cut for the transcript. */
export declare const INJECTION_TRUNCATION_MARKER: string;
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
/** True when a stored transcript body was cut at the storage cap (replay must not use it). */
export declare function isTruncatedInjectionBody(body?: string | null): boolean;
/**
 * Append 0–3 injection notice rows after the user message for this send.
 * The transcript row keeps a bounded body; `chat.injectedContext` keeps the full
 * block so later turns replay exactly what the first turn sent.
 */
export declare function appendInjectionNoticesForTurn(chat: Chat, blocks: PromptInjectionBlocks): InjectionNoticeMessage[];
