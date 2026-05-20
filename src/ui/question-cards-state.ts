/**
 * Pure helpers for ask-question card validation and answer serialization (unit-tested).
 */

import {
  ASK_QUESTION_OTHER_ID,
  type AskQuestionAnswerEntry,
  type AskQuestionItem,
} from '../tools/ask-question-types';

/** In-memory selection for one question while the user navigates the carousel. */
export interface AskQuestionAnswerDraft {
  selectedIds: string[];
  otherText: string;
}

function presetIdsForQuestion(q: AskQuestionItem): Set<string> {
  return new Set(q.options.map((o) => o.id));
}

/**
 * Returns true when the draft satisfies selection rules for this question.
 */
export function isDraftValidForQuestion(
  q: AskQuestionItem,
  draft: AskQuestionAnswerDraft | undefined,
): boolean {
  if (!draft) return false;
  const ids = draft.selectedIds;
  const trimmedOther = draft.otherText.trim();
  const hasOther = ids.includes(ASK_QUESTION_OTHER_ID);

  if (q.allow_multiple === true) {
    if (ids.length === 0) return false;
    if (hasOther) {
      if (ids.length !== 1 || ids[0] !== ASK_QUESTION_OTHER_ID) return false;
      return trimmedOther.length > 0;
    }
    const allowed = presetIdsForQuestion(q);
    return ids.every((id) => allowed.has(id));
  }

  if (ids.length !== 1) return false;
  const only = ids[0];
  if (only === ASK_QUESTION_OTHER_ID) return trimmedOther.length > 0;
  return presetIdsForQuestion(q).has(only);
}

/**
 * True when every question has a valid draft.
 */
export function areAllDraftsValid(
  questions: AskQuestionItem[],
  drafts: Map<string, AskQuestionAnswerDraft>,
): boolean {
  return questions.every((q) => isDraftValidForQuestion(q, drafts.get(q.id)));
}

/**
 * Builds API answer entries in question order (call only when {@link areAllDraftsValid} is true).
 */
export function buildAnswerEntries(
  questions: AskQuestionItem[],
  drafts: Map<string, AskQuestionAnswerDraft>,
): AskQuestionAnswerEntry[] {
  return questions.map((q) => {
    const d = drafts.get(q.id)!;
    const trimmed = d.otherText.trim();
    return {
      questionId: q.id,
      selectedIds: [...d.selectedIds],
      otherText: d.selectedIds.includes(ASK_QUESTION_OTHER_ID) ? trimmed : null,
    };
  });
}
