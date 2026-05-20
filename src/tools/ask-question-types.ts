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
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  if (!isNonEmptyString(o.id) || !isNonEmptyString(o.prompt)) return false;
  if (!Array.isArray(o.options)) return false;
  if (o.options.length < MIN_OPTIONS) return false;
  if (!o.options.every(isAskQuestionOption)) return false;
  if (typeof o.allow_multiple !== 'undefined' && typeof o.allow_multiple !== 'boolean') {
    return false;
  }
  return true;
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
    if (!isAskQuestionItem(q)) {
      return {
        ok: false,
        error: `questions[${i}] must have id, prompt, and at least ${MIN_OPTIONS} options with id and label`,
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
