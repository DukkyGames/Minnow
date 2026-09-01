/**
 * Opening transcript for a turn (P6-C / MIN-725).
 *
 * Isolated (default): `[system, user(seed)]` — board callers that pass only
 * `seed` keep this. Continue: `[system, ...prior]` plus `user(seed)` unless
 * prior already ends with that user row. A leading system on `prior` is
 * dropped so this turn's systemPrompt wins.
 *
 * The result is passed through `foldLeadingAssistantPreamble` — the tail half
 * of what `buildApiMessages` used to do on the renderer send path. Expert
 * chats seed `chat.history` with an authored assistant greeting
 * (`createExpertChatFromSeed` in `src/state/sessions.ts`), so continue turns
 * on those chats would otherwise open the conversation on an assistant row:
 * the "already greeted in the UI" instruction is lost and providers that
 * require a user-first transcript reject the body. The runner's other half of
 * that pair, `repairUnpairedToolCalls`, runs inside the loop; fold comes first
 * here (same order as `buildApiMessages`) so a folded assistant row cannot
 * strand its tool results.
 *
 * Lives in its own module so `run-turn.js` and `sub-agent-runner.js` can
 * share it without a circular import.
 */

import { foldLeadingAssistantPreamble } from './provider-message-normalize.js';

/**
 * The opening plus the index that separates rows the store already holds from
 * rows this turn introduced.
 *
 * Continue turns persist a suffix, so they need that boundary and cannot infer
 * it from `store.load().messages.length`: the fold *removes* prior rows from
 * the opening, and the seed row is *added* to it. Counting here — where both
 * edits happen — is the only way the two stay in step.
 *
 * `persistFrom` is `1` (the runner's system row, which product transcripts do
 * not store) plus the number of `prior` rows that survived into the opening.
 * Everything from that index on is new: the appended seed row, then whatever
 * the turn produces.
 *
 * @param {string} systemPrompt
 * @param {string} seed
 * @param {unknown[] | undefined} prior
 * @returns {{ messages: unknown[], persistFrom: number }}
 */
export function buildOpeningTranscript(systemPrompt, seed, prior) {
  const system = { role: 'system', content: systemPrompt };
  if (!Array.isArray(prior)) {
    return { messages: [system, { role: 'user', content: seed }], persistFrom: 0 };
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
  const priorRows = rest.length;
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
  const opened = [system, ...rest];
  const messages = foldLeadingAssistantPreamble(
    /** @type {import('./provider-message-normalize').ApiMessage[]} */ (opened),
  );
  // Fold only collapses a leading assistant run, which is always prior-derived
  // (the seed row is a user row at the tail), so every dropped row is a prior row.
  const foldedAway = opened.length - messages.length;
  return { messages, persistFrom: 1 + priorRows - foldedAway };
}

/**
 * @param {string} systemPrompt
 * @param {string} seed
 * @param {unknown[] | undefined} prior
 * @returns {unknown[]}
 */
export function buildOpeningMessages(systemPrompt, seed, prior) {
  return buildOpeningTranscript(systemPrompt, seed, prior).messages;
}
