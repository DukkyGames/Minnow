/**
 * Detect assistant prose that should have used the `ask_question` tool instead.
 * Heuristics are conservative to avoid retrying normal numbered instructions.
 */
/**
 * True when plain-language assistant text likely presents multiple-choice options
 * that belong in the `ask_question` card UI.
 */
export declare function looksLikeProseStructuredQuestion(text: string): boolean;
