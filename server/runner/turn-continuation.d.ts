/**
 * Pure helpers for tool-loop turn outcomes: empty post-tool retry, final content,
 * orphan tool-tail detection, and optional dev turn logging.
 */
import type { AssistantMessage, Message } from '../../src/types.js';
/** localStorage key: set to `1` to log per-round tool-loop decisions in the console. */
export declare const TURN_DEBUG_STORAGE_KEY = "minnowDebugTurns";
/** Max extra model rounds after an empty completion when history ends with tool rows. */
export declare const MAX_EMPTY_POST_TOOL_RETRIES = 1;
/** Ephemeral API-only user line (not stored in session history). */
export declare const EMPTY_POST_TOOL_CONTINUE_INSTRUCTION = "You have tool results above. Reply to the user in plain language; do not call more tools unless necessary.";
/** Ephemeral API-only line after max_tokens truncation (not stored in session history). */
export declare const CONTINUE_AFTER_TRUNCATION_INSTRUCTION = "Your previous reply was cut off because of the output token limit. Continue exactly where you left off without repeating what you already wrote.";
/**
 * Ephemeral API-only line after a failed turn (MIN-666).
 * Not stored in history - Continue keeps the visible transcript and nudges the model
 * to pick up from it instead of restarting from the last user message.
 */
export declare const CONTINUE_AFTER_FAILURE_INSTRUCTION = "The previous reply failed before it finished. Continue from the work above — keep its conclusions and pick up exactly where it stopped. Do not repeat it and do not start over.";
/**
 * Continue after a failure only needs an extra user line when the transcript
 * already ends on assistant/tool output. An unanswered user prompt is retried as-is.
 */
export declare function resolveFailedTurnContinueInstruction(history: Message[]): string | undefined;
/** Max extra model rounds when prose looks like multiple-choice but `ask_question` was not called. */
export declare const MAX_PROSE_QUESTION_RETRIES = 1;
/** Ephemeral API-only correction when the model asked for choices in prose. */
export declare const PROSE_QUESTION_RETRY_INSTRUCTION = "Your previous reply is already in the chat. You presented multiple-choice options in plain text. Do not repeat that list in prose. Call the ask_question tool now with a questions array (each item: id, prompt, options as {id, label} objects). Wait for the user to answer before continuing.";
/**
 * Injected when the sub-agent has tools enabled but the first model reply did not call any
 * tool (prose-only). Forces another tool round before structured JSON finalization.
 */
export declare const SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION = "You must use the available tools to complete the task. Do not answer with prose only \u2014 call the appropriate tool(s) now, then summarize after you have tool results.";
/** Extra user row when a board turn finished without calling the report tool. */
export declare function buildReportToolNudgeInstruction(toolName: string): string;
export type TurnContinuation = 'continueTools' | 'finalize' | 'retryEmpty';
/** True when dev turn logging is enabled (`localStorage.minnowDebugTurns === '1'`). */
export declare function isTurnDebugEnabled(): boolean;
/** Log a structured turn-debug object when {@link isTurnDebugEnabled}. */
export declare function logTurnDebug(payload: Record<string, unknown>): void;
/** History ends with tool result(s) or assistant tool_calls without a final prose reply. */
export declare function hasPostToolTail(history: Message[]): boolean;
/**
 * Decide the next step after one streamed completion round.
 * `retryEmpty` applies only when the model returned no prose after tool results.
 */
export declare function resolveTurnContinuation(input: {
    finishReason: string | undefined;
    toolCallsCount: number;
    fullTextLength: number;
    hasPostToolTail: boolean;
    emptyPostToolRetries: number;
    maxEmptyPostToolRetries?: number;
}): TurnContinuation;
/**
 * User-visible assistant content after stream + optional non-streaming fallback.
 * Prefers trimmed prose, then joined thinking segments, then a placeholder.
 */
export declare function resolveFinalAssistantContent(fullText: string, thinkingSegments: string[]): {
    content: string;
    usedThinkingAsContent: boolean;
};
export interface FailedTurnPartialInput {
    /** Prose streamed before the turn threw. */
    partialText: string;
    /** Reasoning segments captured for the same round. */
    thinking: string[];
}
/**
 * The assistant row a failed turn should leave behind, or null when there is
 * nothing worth keeping.
 *
 * A user-stopped turn already persists what it streamed; a failed one used to
 * discard it, because nothing had been appended and the rollback slices back to
 * the user message. Tool-call markup the router never closed is dropped — replaying
 * half a `<tool_call>` as prose is worse than losing it.
 */
export declare function resolveFailedTurnPartialRow(input: FailedTurnPartialInput): AssistantMessage | null;
