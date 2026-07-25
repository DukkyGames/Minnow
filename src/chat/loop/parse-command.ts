/**
 * Tokenize /loop slash input (session-scoped repeating prompts — not a SKILL.md skill).
 */

/** Max stored loop prompt length (same cap as /goal conditions). */
export const MAX_LOOP_PROMPT_CHARS = 4000;

/** Floor for interval and auto delays (1 minute). */
export const MIN_LOOP_INTERVAL_MS = 60_000;

/** Ceiling for self-paced auto delay (60 minutes). */
export const MAX_LOOP_AUTO_DELAY_MS = 3_600_000;

/** Initial self-paced delay before the first pacing adjustment. */
export const INITIAL_LOOP_AUTO_DELAY_MS = 120_000;

/** Loops expire this long after creation. */
export const LOOP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LOOP_RESERVED_SUBCOMMANDS = new Set([
  'stop',
  'clear',
  'off',
  'cancel',
  'list',
  'status',
]);

/** Interval token like `5m`, `30s`, `2h`, `1d`. */
const INTERVAL_TOKEN_RE = /^(\d+)(s|m|h|d)$/i;

export type ParsedLoopSlash =
  | { kind: 'invalid'; message: string }
  | {
      kind: 'arm';
      loopKind: 'interval' | 'auto';
      intervalMs?: number;
      promptText: string;
    };

/** True when composer text is a /loop command (case-insensitive token). */
export function isLoopSlashCommand(text: string): boolean {
  return /(?:^|\s)\/loop\b/i.test(text.trim());
}

/**
 * Parse interval token into ms. Sub-minute values round up to {@link MIN_LOOP_INTERVAL_MS}.
 * Returns null when the token is not a valid interval.
 */
export function parseLoopIntervalToken(token: string): number | null {
  const match = INTERVAL_TOKEN_RE.exec(token.trim());
  if (!match) return null;

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const ms = amount * (multipliers[unit] ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(MIN_LOOP_INTERVAL_MS, ms);
}

/** Reject prompts that themselves start with /loop or /goal (no nesting). */
export function isNestedLoopOrGoalPrompt(promptText: string): boolean {
  const trimmed = promptText.trim();
  if (!trimmed) return false;
  return /^\/(?:loop|goal)\b/i.test(trimmed);
}

/**
 * Parse `/loop`, `/loop 5m <prompt>`, etc.
 * List/stop are handled in the chat loop panel, not slash subcommands.
 * Returns null when the text is not a loop command.
 */
export function parseLoopSlashInput(text: string): ParsedLoopSlash | null {
  const trimmed = text.trim();
  const match = trimmed.match(/(?:^|\s)\/loop\b/i);
  if (!match || match.index == null) return null;

  const leadingWs = match[0].startsWith(' ') ? 1 : 0;
  const removeStart = match.index + leadingWs;
  const removeEnd = removeStart + match[0].length - leadingWs;
  const rest = `${trimmed.slice(0, removeStart)}${trimmed.slice(removeEnd)}`.trim();

  // Bare /loop → maintenance auto-loop
  if (!rest) {
    return { kind: 'arm', loopKind: 'auto', promptText: '' };
  }

  const tokens = rest.split(/\s+/);
  const first = (tokens[0] ?? '').toLowerCase();

  if (LOOP_RESERVED_SUBCOMMANDS.has(first)) {
    return {
      kind: 'invalid',
      message: 'Use the loop panel in chat to list, stop, or edit timers',
    };
  }

  const intervalMs = parseLoopIntervalToken(tokens[0] ?? '');
  if (intervalMs != null) {
    const promptText = rest.slice((tokens[0] ?? '').length).trim().slice(0, MAX_LOOP_PROMPT_CHARS);
    return {
      kind: 'arm',
      loopKind: 'interval',
      intervalMs,
      promptText,
    };
  }

  return {
    kind: 'arm',
    loopKind: 'auto',
    promptText: rest.slice(0, MAX_LOOP_PROMPT_CHARS).trim(),
  };
}
