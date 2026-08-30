/**
 * Client-side thinking budget tracker and continuation builders for watchdog nudges.
 *
 * The budget bounds one user turn: the tracker banks each completed thinking phase and
 * checks the limit against the turn total, so a multi-tool turn cannot spend the budget
 * once per loop iteration.
 */
import type { ApiMessage } from '../../src/types.js';
/** First-person nudge appended inside prefilled thinking so the model commits to an answer. */
export declare const THINKING_BUDGET_NUDGE_LINE = "I've spent enough time thinking. I'll commit to an answer now.";
/** Base instruction sent when the budget trips (used inside the continuation payload). */
export declare const THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION = "Stop extended reasoning. Answer directly in your next reply without further internal deliberation.";
/**
 * Extra allowance granted to a continuation so it can write a short wrap-up thought
 * instead of re-tripping on its first reasoning delta.
 */
export declare function thinkingBudgetGraceTokens(baseLimitTokens: number): number;
/**
 * Tracks approximate reasoning tokens across one user turn.
 * Call `endSession()` when prose or tool calls start so the phase is banked and the
 * next thinking block starts a fresh `sessionText` — the turn total keeps accumulating.
 */
export declare class ThinkingBudgetTracker {
    private phaseText;
    private bankedTokens;
    private _exceeded;
    private _nudgeCount;
    private _disarmed;
    private readonly baseLimit;
    private limit;
    constructor(limitTokens: number);
    get exceeded(): boolean;
    /** Configured ceiling, so callers can mirror it into the outbound request body. */
    get limitTokens(): number;
    /** Text of the current contiguous thinking phase — what a continuation carries forward. */
    get sessionText(): string;
    get nudgeCount(): number;
    /** Estimated reasoning tokens spent so far this turn (banked phases + current phase). */
    get spentTokens(): number;
    /** Feed a reasoning delta; marks exceeded when the turn total crosses the limit. */
    feed(delta: string): void;
    /** Bank the current phase and start the next one — the turn total is kept. */
    endSession(): void;
    /**
     * Enter a budget continuation: bank the phase, clear the trip, and raise the ceiling by
     * a small grace so the continuation can wrap up its reasoning before tripping again.
     */
    beginContinuation(graceTokens?: number): void;
    /** Permanently stop tripping for the rest of this turn (escalation already ran). */
    disarm(): void;
    private bankPhase;
}
/** Build outbound-only assistant prefill for inline-thinking continuation. */
export declare function buildThinkingPrefillAssistantMessage(partialThinking: string): ApiMessage;
/**
 * Build the outbound-only continuation payload for a tripped budget.
 *
 * An assistant message carries the work done so far, followed by a user message telling the
 * model to continue from it. Unlike a trailing assistant prefill — which a plain
 * OpenAI-compatible endpoint reads as a *completed* turn — this shape works on every provider.
 */
export declare function buildBudgetContinuationMessages(opts: {
    partialThinking: string;
    partialText: string;
}): ApiMessage[];
/** Strip provider echo of a prefilled thinking block from the first continuation delta. */
export declare function stripPrefillEchoFromDelta(delta: string, partialThinking: string): string;
/**
 * Strip a verbatim repeat of already-rendered prose from the first delta of a continuation.
 * Carried text is seeded into the stream, so an echo would render twice.
 */
export declare function stripCarriedTextEcho(delta: string, carriedText: string): string;
