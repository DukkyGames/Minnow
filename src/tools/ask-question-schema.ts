/**
 * JSON schema fragments and model-facing guidance for the `ask_question` tool.
 * Keeps the OpenAI function definition and prompts aligned with runtime validation.
 */

/** Canonical example passed to the model in the tool description. */
export const ASK_QUESTION_EXAMPLE_JSON =
  '{"questions":[{"id":"q","prompt":"Pick one","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}]}';

/**
 * Tool description: required shape, field names, and common mistakes.
 * Appended to the short summary in definitions.ts.
 */
export const ASK_QUESTION_TOOL_DESCRIPTION = [
  'questions[{id,prompt,options[{id,label}]}];not question/choices/__other__.',
  `Ex:${ASK_QUESTION_EXAMPLE_JSON}`,
].join('');

/** JSON Schema for one preset option. */
export const askQuestionOptionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
  },
  required: ['id', 'label'],
} as const;

/** JSON Schema for one question card. */
export const askQuestionItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    prompt: { type: 'string' },
    options: {
      type: 'array',
      items: askQuestionOptionSchema,
    },
  },
  required: ['id', 'prompt', 'options'],
} as const;
