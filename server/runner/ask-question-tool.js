/**
 * Shared `ask_question` catalog fragment for `runTurn()` (P6-B / MIN-724).
 *
 * Lives here — not in a board module, not in `src/tools/` — so the runner
 * package can inject the schema when an `AskCapability` is present without
 * importing the renderer catalog. Keep the parameters in sync with
 * `src/tools/ask-question-schema.ts` + the `ask_question` entry in
 * `src/tools/definitions.ts`.
 *
 * No imports: this file is on the isomorphic barrel's runtime closure.
 */

/** Tool name the model calls. Injection, not a product branch, decides presence. */
export const ASK_QUESTION_TOOL_NAME = 'ask_question';

/**
 * Default wait for an interactive answer. Matches Settings → Watchdog
 * `chat.generationIdleTimeoutMs` (60 minutes). `0` in settings means
 * "no generation idle limit"; this timeout must still exist so a chat turn
 * cannot hang forever. Override per call with `askTimeoutMs`.
 */
export const DEFAULT_ASK_TIMEOUT_MS = 60 * 60 * 1000;

/** Immediate tool result when the capability is null / omitted. */
export const ASK_QUESTION_UNAVAILABLE_ERROR =
  'Error: tool "ask_question" is not available. Proceed without user input.';

/** Tool result when the interactive wait hits `askTimeoutMs`. */
export const ASK_QUESTION_TIMEOUT_ERROR =
  'Error: ask_question timed out waiting for an answer.';

/** Compact description aligned with `ASK_QUESTION_TOOL_DESCRIPTION` in the catalog. */
const ASK_QUESTION_TOOL_DESCRIPTION = [
  'questions[{id,prompt,options[{id,label}],allow_multiple?}];not question/choices/__other__.',
  'allow_multiple:true for click-all-that-apply.',
  'Ex:{"questions":[{"id":"q","prompt":"Pick one","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}]}',
].join('');

/**
 * True when the caller supplied a usable handler. `null`, `undefined`, and
 * `{ ask: undefined }` are all "absent".
 *
 * @param {unknown} ask
 * @returns {ask is { ask: Function }}
 */
export function isAskCapability(ask) {
  return Boolean(ask) && typeof ask === 'object' && typeof ask.ask === 'function';
}

/**
 * Positive finite ms, or the documented default. Never `0` — that would
 * reintroduce a hang.
 *
 * @param {unknown} raw
 * @returns {number}
 */
export function resolveAskTimeoutMs(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  return DEFAULT_ASK_TIMEOUT_MS;
}

/**
 * Catalog-shaped OpenAI function tool. Used when the capability is present
 * and the caller did not already pass a schema under the same name.
 *
 * @returns {import('./run-turn').TurnToolDefinition}
 */
export function defaultAskQuestionTool() {
  return {
    type: 'function',
    function: {
      name: ASK_QUESTION_TOOL_NAME,
      description: ASK_QUESTION_TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                prompt: { type: 'string' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' },
                    },
                    required: ['id', 'label'],
                  },
                },
                allow_multiple: { type: 'boolean' },
              },
              required: ['id', 'prompt', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  };
}

/**
 * Capability decides the resolved list. A caller that accidentally includes
 * `ask_question` without a handler still has it stripped. A handler without
 * a schema still gets the catalog stub.
 *
 * @param {import('./run-turn').TurnToolDefinition[] | undefined} tools
 * @param {unknown} ask
 * @returns {import('./run-turn').TurnToolDefinition[]}
 */
export function withAskQuestionTool(tools, ask) {
  const list = Array.isArray(tools) ? tools.slice() : [];
  if (!isAskCapability(ask)) {
    return list.filter((tool) => tool?.function?.name !== ASK_QUESTION_TOOL_NAME);
  }
  if (list.some((tool) => tool?.function?.name === ASK_QUESTION_TOOL_NAME)) {
    return list;
  }
  list.push(defaultAskQuestionTool());
  return list;
}

/**
 * Model args arrive as a JSON string on the wire, or already-parsed objects
 * from a fake execute path.
 *
 * @param {unknown} raw
 * @returns {unknown}
 */
export function parseAskQuestionArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Normalize whatever the capability returned into the string the inner loop
 * stores as a tool result.
 *
 * @param {unknown} answer
 * @returns {string}
 */
export function stringifyAskAnswer(answer) {
  if (typeof answer === 'string') return answer;
  if (answer && typeof answer === 'object' && typeof answer.content === 'string') {
    return answer.content;
  }
  if (answer == null) {
    return JSON.stringify({ status: 'cancelled', answers: [] });
  }
  try {
    return JSON.stringify(answer);
  } catch {
    return String(answer);
  }
}
