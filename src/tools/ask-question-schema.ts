/**
 * JSON schema fragments and model-facing guidance for the `ask_question` tool.
 * Keeps the OpenAI function definition and prompts aligned with runtime validation.
 */

/** Canonical example passed to the model in the tool description. */
export const ASK_QUESTION_EXAMPLE_JSON = `{
  "title": "Scope",
  "questions": [
    {
      "id": "priority",
      "prompt": "What should we prioritize first?",
      "options": [
        { "id": "mvp", "label": "MVP only", "description": "Smallest shippable slice" },
        { "id": "full", "label": "Full feature set" }
      ]
    }
  ]
}`;

/**
 * Tool description: required shape, field names, and common mistakes.
 * Appended to the short summary in definitions.ts.
 */
export const ASK_QUESTION_TOOL_DESCRIPTION = [
  'Ask the user structured multiple-choice questions and wait for answers.',
  'Required top-level field: questions (array, 1–10 items). Optional: title (string).',
  'Each question object MUST use exactly these keys:',
  '- id (string, stable id returned in answers)',
  '- prompt (string, question text shown to the user — NOT "question" or "text")',
  '- options (array of at least 2 objects — NOT "choices", NOT plain strings)',
  'Each option object MUST use: id (string), label (string). Optional: description (string).',
  'Do NOT add an "Other" option — the UI adds it. Never use option id "__other__".',
  'Optional per question: allow_multiple (boolean, default false).',
  `Example arguments: ${ASK_QUESTION_EXAMPLE_JSON}`,
].join(' ');

/** JSON Schema for one preset option. */
export const askQuestionOptionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      description: 'Stable option id returned in answers (e.g. "mvp", "yes"). Not "__other__".',
    },
    label: {
      type: 'string',
      description: 'Short choice title shown on the card. Required. Not "text" or "name".',
    },
    description: {
      type: 'string',
      description: 'Optional one-line subtitle under the label.',
    },
  },
  required: ['id', 'label'],
} as const;

/** JSON Schema for one question card. */
export const askQuestionItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      description: 'Stable question id (e.g. "priority", "save_reef_module").',
    },
    prompt: {
      type: 'string',
      description: 'Question text shown to the user. Required field name is "prompt".',
    },
    allow_multiple: {
      type: 'boolean',
      description: 'If true, user may select several preset options (not combined with Other).',
    },
    options: {
      type: 'array',
      description:
        'At least two preset choices as {id, label} objects. The client adds "Other" automatically.',
      minItems: 2,
      items: askQuestionOptionSchema,
    },
  },
  required: ['id', 'prompt', 'options'],
} as const;
