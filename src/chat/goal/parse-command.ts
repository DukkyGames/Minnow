/**
 * Tokenize /goal slash input (stateful command — not a SKILL.md skill).
 */

export const MAX_GOAL_CONDITION_CHARS = 4000;

const GOAL_CLEAR_ALIASES = new Set([
  'clear',
  'stop',
  'off',
  'reset',
  'none',
  'cancel',
]);

export type ParsedGoalSlash =
  | { kind: 'status' }
  | { kind: 'clear' }
  | { kind: 'set'; conditionText: string };

/** True when composer text is a /goal command (case-insensitive token). */
export function isGoalSlashCommand(text: string): boolean {
  return /(?:^|\s)\/goal\b/i.test(text.trim());
}

/**
 * Parse `/goal`, `/goal clear`, or `/goal <condition>`.
 * Returns null when the text is not a goal command.
 */
export function parseGoalSlashInput(text: string): ParsedGoalSlash | null {
  const trimmed = text.trim();
  const match = trimmed.match(/(?:^|\s)\/goal\b/i);
  if (!match || match.index == null) return null;

  const leadingWs = match[0].startsWith(' ') ? 1 : 0;
  const removeStart = match.index + leadingWs;
  const removeEnd = removeStart + match[0].length - leadingWs;
  const rest = `${trimmed.slice(0, removeStart)}${trimmed.slice(removeEnd)}`.trim();

  if (!rest) return { kind: 'status' };

  const firstToken = rest.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (GOAL_CLEAR_ALIASES.has(firstToken)) {
    return { kind: 'clear' };
  }

  return {
    kind: 'set',
    conditionText: rest.slice(0, MAX_GOAL_CONDITION_CHARS).trim(),
  };
}
