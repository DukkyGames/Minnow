/**
 * Opening transcript for a turn (P6-C / MIN-725).
 *
 * Isolated (default): `[system, user(seed)]` — board callers that pass only
 * `seed` keep this. Continue: `[system, ...prior]` plus `user(seed)` unless
 * prior already ends with that user row. A leading system on `prior` is
 * dropped so this turn's systemPrompt wins.
 *
 * Lives in its own module so `run-turn.js` and `sub-agent-runner.js` can
 * share it without a circular import.
 */

/**
 * @param {string} systemPrompt
 * @param {string} seed
 * @param {unknown[] | undefined} prior
 * @returns {unknown[]}
 */
export function buildOpeningMessages(systemPrompt, seed, prior) {
  const system = { role: 'system', content: systemPrompt };
  if (!Array.isArray(prior)) {
    return [system, { role: 'user', content: seed }];
  }
  /** @type {unknown[]} */
  const rest = [];
  for (const msg of prior) {
    if (!msg || typeof msg !== 'object') continue;
    // This turn's systemPrompt is authoritative — drop a stored leading system.
    if (rest.length === 0 && /** @type {{ role?: string }} */ (msg).role === 'system') {
      continue;
    }
    rest.push(msg);
  }
  const last = rest[rest.length - 1];
  const lastRole =
    last && typeof last === 'object' ? /** @type {{ role?: string }} */ (last).role : '';
  const lastContent =
    last && typeof last === 'object'
      ? /** @type {{ content?: unknown }} */ (last).content
      : undefined;
  if (seed) {
    if (lastRole !== 'user') {
      rest.push({ role: 'user', content: seed });
    } else if (typeof lastContent === 'string' && lastContent !== seed) {
      // Prior ended on a different user row — this is a new turn.
      rest.push({ role: 'user', content: seed });
    }
    // Matching string, or a caller-built multimodal user row: keep as-is.
  }
  return [system, ...rest];
}
