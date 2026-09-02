/**
 * Detect assistant prose that announced a next tool action but never called one.
 * Heuristics score the last sentence so a completed answer is not retried.
 */
/**
 * True when the closing sentence looks like “Let me inspect / I'll write…”
 * rather than a closer, a wait-for-user line, or a question.
 */
export declare function looksLikeIntentToAct(text: string): boolean;
