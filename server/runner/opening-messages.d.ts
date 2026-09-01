/**
 * Opening transcript for a turn (P6-C / MIN-725).
 *
 * Isolated (default, `prior` omitted): `[system, user(seed)]`.
 * Continue (`prior` is an array): `[system, ...prior]` plus `user(seed)`
 * unless prior already ends with that user row.
 *
 * The result is folded with `foldLeadingAssistantPreamble`, so a continue
 * opening is **not** always `1 + prior.length` — an expert chat's leading
 * assistant greeting collapses into the system row.
 */
export function buildOpeningMessages(
  systemPrompt: string,
  seed: string,
  prior?: unknown[],
): unknown[];

/**
 * The same opening plus `persistFrom`: the index of the first row the store
 * does not already hold (the appended seed row, then the turn's own output).
 * Continue-mode suffix persist must use this rather than
 * `store.load().messages.length + 1`, which the fold and the appended seed row
 * both invalidate.
 */
export function buildOpeningTranscript(
  systemPrompt: string,
  seed: string,
  prior?: unknown[],
): { messages: unknown[]; persistFrom: number };
