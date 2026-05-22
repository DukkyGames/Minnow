/**
 * Types and validation for the browser-native `ask_question` tool.
 * Preset options only; "Other" is added in the UI and returned as selectedIds: ["__other__"].
 */

/** Reserved id when the user selects the synthetic "Other" row. */
export const ASK_QUESTION_OTHER_ID = '__other__';

const MAX_QUESTIONS = 10;
const MIN_OPTIONS = 2;

export interface AskQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface AskQuestionItem {
  id: string;
  prompt: string;
  options: AskQuestionOption[];
  allow_multiple?: boolean;
}

export interface AskQuestionArgs {
  title?: string;
  questions: AskQuestionItem[];
}

/** One answered question in the tool result JSON. */
export interface AskQuestionAnswerEntry {
  questionId: string;
  selectedIds: string[];
  otherText: string | null;
}

export type AskQuestionToolResult =
  | { status: 'answered'; answers: AskQuestionAnswerEntry[] }
  | { status: 'cancelled'; answers: [] }
  | { status: 'error'; message: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isAskQuestionOption(raw: unknown): raw is AskQuestionOption {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return isNonEmptyString(o.id) && isNonEmptyString(o.label);
}

function isAskQuestionItem(raw: unknown): raw is AskQuestionItem {
  return diagnoseAskQuestionItem(raw) === null;
}

/**
 * Returns a specific validation hint for one question object, or null if valid.
 */
export function diagnoseAskQuestionItem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') {
    return 'must be an object with id, prompt, and options';
  }
  const o = raw as Record<string, unknown>;

  if (!isNonEmptyString(o.id)) {
    if (isNonEmptyString(o.questionId)) {
      return 'use "id" (not "questionId") for the question id';
    }
    return 'missing non-empty "id"';
  }
  if (!isNonEmptyString(o.prompt)) {
    if (isNonEmptyString(o.question)) {
      return 'use "prompt" (not "question") for the question text';
    }
    if (isNonEmptyString(o.text)) {
      return 'use "prompt" (not "text") for the question text';
    }
    return 'missing non-empty "prompt" (the question text shown to the user)';
  }
  if (!Array.isArray(o.options)) {
    if (Array.isArray(o.choices)) {
      return 'use "options" (not "choices") for the preset answers array';
    }
    return 'missing "options" array (at least 2 {id, label} objects)';
  }
  if (o.options.length < MIN_OPTIONS) {
    return `options must have at least ${MIN_OPTIONS} entries (got ${o.options.length})`;
  }
  for (let j = 0; j < o.options.length; j++) {
    const opt = o.options[j];
    if (typeof opt === 'string') {
      return `options[${j}] must be {"id":"...","label":"..."} objects, not plain strings`;
    }
    if (!opt || typeof opt !== 'object') {
      return `options[${j}] must be an object with id and label`;
    }
    const oo = opt as Record<string, unknown>;
    if (!isNonEmptyString(oo.id)) {
      if (isNonEmptyString(oo.value)) {
        return `options[${j}]: use "id" (not "value") for the option id`;
      }
      return `options[${j}] missing non-empty "id"`;
    }
    if (!isNonEmptyString(oo.label)) {
      if (isNonEmptyString(oo.text)) {
        return `options[${j}]: use "label" (not "text") for the option title`;
      }
      if (isNonEmptyString(oo.name)) {
        return `options[${j}]: use "label" (not "name") for the option title`;
      }
      return `options[${j}] missing non-empty "label"`;
    }
  }
  if (typeof o.allow_multiple !== 'undefined' && typeof o.allow_multiple !== 'boolean') {
    return 'allow_multiple must be a boolean when provided';
  }
  return null;
}

/**
 * Validates model-provided arguments. Returns normalized args or an error message.
 */
export function validateAskQuestionArgs(
  raw: unknown,
): { ok: true; args: AskQuestionArgs } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'arguments must be an object' };
  }
  const o = raw as Record<string, unknown>;
  let title: string | undefined;
  if (o.title !== undefined) {
    if (!isNonEmptyString(o.title)) {
      return { ok: false, error: 'title must be a non-empty string when provided' };
    }
    title = o.title.trim();
  }
  if (!Array.isArray(o.questions) || o.questions.length === 0) {
    return { ok: false, error: 'questions must be a non-empty array' };
  }
  if (o.questions.length > MAX_QUESTIONS) {
    return { ok: false, error: `at most ${MAX_QUESTIONS} questions allowed` };
  }
  const questionIds = new Set<string>();
  for (let i = 0; i < o.questions.length; i++) {
    const q = o.questions[i];
    const itemError = diagnoseAskQuestionItem(q);
    if (itemError) {
      return {
        ok: false,
        error: `questions[${i}]: ${itemError}. Required shape: { "id": "...", "prompt": "...", "options": [{ "id": "...", "label": "..." }, ...] }`,
      };
    }
    if (questionIds.has(q.id)) {
      return { ok: false, error: `duplicate question id: ${q.id}` };
    }
    questionIds.add(q.id);
    const optionIds = new Set<string>();
    for (const opt of q.options) {
      if (opt.id === ASK_QUESTION_OTHER_ID) {
        return {
          ok: false,
          error: `option id "${ASK_QUESTION_OTHER_ID}" is reserved for the UI Other row`,
        };
      }
      if (optionIds.has(opt.id)) {
        return { ok: false, error: `duplicate option id "${opt.id}" in question "${q.id}"` };
      }
      optionIds.add(opt.id);
    }
  }
  return { ok: true, args: { title, questions: o.questions as AskQuestionItem[] } };
}

/** Serializes a structured tool result for the model (always JSON string in history). */
export function stringifyAskQuestionResult(result: AskQuestionToolResult): string {
  return JSON.stringify(result);
}
