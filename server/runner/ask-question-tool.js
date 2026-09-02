export const ASK_QUESTION_TOOL_NAME = 'ask_question';

export const DEFAULT_ASK_TIMEOUT_MS = 60 * 60 * 1000;

export const ASK_QUESTION_UNAVAILABLE_ERROR =
  'Error: tool "ask_question" is not available. Proceed without user input.';

export const ASK_QUESTION_TIMEOUT_ERROR =
  'Error: ask_question timed out waiting for an answer.';

const ASK_QUESTION_TOOL_DESCRIPTION = [
  'questions[{id,prompt,options[{id,label}],allow_multiple?}];not question/choices/__other__.',
  'allow_multiple:true for click-all-that-apply.',
  'Ex:{"questions":[{"id":"q","prompt":"Pick one","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}]}',
].join('');

/**
 * @param {unknown} ask
 * @returns {ask is { ask: Function }}
 */
export function isAskCapability(ask) {
  return Boolean(ask) && typeof ask === 'object' && typeof ask.ask === 'function';
}

/**
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
