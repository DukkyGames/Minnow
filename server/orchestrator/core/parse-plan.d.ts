import type { ParseError, TaskGraph } from './types';

/**
 * Board intake with no model call.
 */
export function parsePlan(markdown: string): TaskGraph | ParseError[];

/** Narrowing helper for the union `parsePlan` returns. */
export function isParseErrors(result: TaskGraph | ParseError[]): result is ParseError[];

/** Render errors for a human — the `save_file` guard and the REST 400 body. */
export function formatParseErrors(errors: ParseError[]): string;
