/**
 * Structured JSON completions for email agent pipelines (triage, reply variants).
 * Strips reasoning prose and retries once when the model returns invalid JSON.
 */

import { llmCall } from '../research/llm.js';

/** User repair nudge after a failed JSON parse. */
export const EMAIL_JSON_REPAIR_PROMPT =
  'Your previous message was not valid JSON for the required schema. Reply with ONLY valid JSON. No prose, no markdown outside a json code fence.';

/**
 * Call the LLM and parse structured JSON, with one repair attempt on failure.
 * @param {import('../research/llm.js').LlmCallOptions & {
 *   parse: (raw: string) => unknown | null,
 *   repairPrompt?: string,
 * }} options
 * @returns {Promise<unknown>}
 */
export async function completeStructuredJson({
  parse,
  repairPrompt = EMAIL_JSON_REPAIR_PROMPT,
  ...llmOptions
}) {
  if (typeof parse !== 'function') {
    throw new Error('parse callback is required');
  }

  let completion = await llmCall({ ...llmOptions, stripProse: true });
  let parsed = parse(completion);
  if (parsed != null) {
    return parsed;
  }

  completion = await llmCall({
    ...llmOptions,
    stripProse: true,
    messages: [
      ...llmOptions.messages,
      { role: 'assistant', content: completion },
      { role: 'user', content: repairPrompt },
    ],
  });
  parsed = parse(completion);
  if (parsed == null) {
    throw new Error('LLM returned invalid JSON after repair attempt');
  }
  return parsed;
}
