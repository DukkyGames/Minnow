import {
  ASK_QUESTION_OTHER_ID,
  type AskQuestionAnswerEntry,
  type AskQuestionArgs,
  type AskQuestionItem,
  type AskQuestionToolResult,
} from '../tools/ask-question-types';

function parseToolResultJson(text: string): AskQuestionToolResult | null {
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (o.status === 'answered' && Array.isArray(o.answers)) {
      return { status: 'answered', answers: o.answers as AskQuestionAnswerEntry[] };
    }
    if (o.status === 'cancelled') {
      return { status: 'cancelled', answers: [] };
    }
    if (o.status === 'error' && typeof o.message === 'string') {
      return { status: 'error', message: o.message };
    }
    return null;
  } catch {
    return null;
  }
}

function parseArgsJson(args: Record<string, unknown> | unknown): AskQuestionArgs | null {
  try {
    if (!args || typeof args !== 'object') return null;
    const o = args as Record<string, unknown>;
    if (!Array.isArray(o.questions)) return null;
    return {
      title: typeof o.title === 'string' ? o.title : undefined,
      questions: o.questions as AskQuestionItem[],
    };
  } catch {
    return null;
  }
}

function labelForOption(q: AskQuestionItem, optionId: string): string | null {
  if (optionId === ASK_QUESTION_OTHER_ID) return null;
  const opt = q.options.find((x) => x.id === optionId);
  return opt ? opt.label : optionId;
}

/**
 * Builds display lines: "1. prompt — answer summary" for succeeded ask_question results.
 */
export function formatAskQuestionResultForDisplay(
  resultText: string,
  toolArgs: Record<string, unknown> | unknown,
): string {
  const parsed = parseToolResultJson(resultText);
  if (!parsed) return resultText;

  if (parsed.status === 'cancelled') {
    return 'User cancelled questions.';
  }
  if (parsed.status === 'error') {
    return parsed.message;
  }

  const args = parseArgsJson(toolArgs);
  const questions = args?.questions ?? [];
  const byId = new Map(questions.map((q) => [q.id, q]));

  const lines: string[] = [];
  let n = 1;
  for (const ans of parsed.answers) {
    const q = byId.get(ans.questionId);
    const prompt = q?.prompt ?? ans.questionId;
    const parts: string[] = [];
    if (ans.selectedIds.includes(ASK_QUESTION_OTHER_ID)) {
      const text = (ans.otherText ?? '').trim() || '(empty)';
      parts.push(`Other: ${text}`);
    } else {
      for (const id of ans.selectedIds) {
        const lab = q ? labelForOption(q, id) : id;
        if (lab) parts.push(lab);
      }
    }
    const summary = parts.length > 0 ? parts.join(', ') : '(no selection)';
    lines.push(`${n}. ${prompt} — ${summary}`);
    n += 1;
  }
  return lines.join('\n');
}

/**
 * Returns list items for an accessible <ol> when args are available; otherwise a single fallback line.
 */
export function formatAskQuestionResultAsListItems(
  resultText: string,
  toolArgs: Record<string, unknown> | unknown,
): string[] {
  const block = formatAskQuestionResultForDisplay(resultText, toolArgs);
  return block.split('\n').filter((line) => line.length > 0);
}
