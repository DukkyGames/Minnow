/**
 * Opening transcript for a turn (P6-C / MIN-725).
 *
 * Isolated (default, `prior` omitted): `[system, user(seed)]`.
 * Continue (`prior` is an array): `[system, ...prior]` plus `user(seed)`
 * unless prior already ends with that user row.
 */
export function buildOpeningMessages(
  systemPrompt: string,
  seed: string,
  prior?: unknown[],
): unknown[];
