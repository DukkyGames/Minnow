import { foldLeadingAssistantPreamble } from './provider-message-normalize.js';

/**
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
      rest.push({ role: 'user', content: seed });
    }
  }
  const opened = [system, ...rest];
  const messages = foldLeadingAssistantPreamble(
    /** @type {import('./provider-message-normalize').ApiMessage[]} */ (opened),
  );
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
