/**
 * Map V2 journal `board.model.set.reasoning` onto the Orchestrate header fields.
 *
 * Attempts still only honour thinking on/off (`TurnModel.thinking.mode`). Low /
 * medium / high are journaled so the header round-trips the same control V1 uses.
 */

import type { ReasoningEffortOption } from '../types.ts';
import type { ThinkingTriState } from '../agents/thinking-types.ts';

/** Header-control patch (V2 journals this; leftover V1 chat propagation is gone). */
export type BoardReasoningPatch = {
  reasoningEffort?: ReasoningEffortOption;
  thinkingMode?: ThinkingTriState;
  clearReasoningEffort?: boolean;
  clearThinkingMode?: boolean;
};

/** Values POST `/api/boards/:id/model` accepts on `reasoning`. */
export const BOARD_JOURNAL_REASONING = ['on', 'off', 'low', 'medium', 'high'] as const;

export type BoardJournalReasoning = (typeof BOARD_JOURNAL_REASONING)[number];

export interface BoardReasoningFields {
  thinkingMode?: ThinkingTriState;
  reasoningEffort?: ReasoningEffortOption;
}

/** True when the string is a journaled reasoning value attempts can fold. */
export function isBoardJournalReasoning(value: string): value is BoardJournalReasoning {
  return (BOARD_JOURNAL_REASONING as readonly string[]).includes(value);
}

/** Header fields that reproduce the journaled binding. */
export function fieldsFromJournalReasoning(
  reasoning: string | null | undefined,
): BoardReasoningFields {
  if (!reasoning) return {};
  if (reasoning === 'off') return { reasoningEffort: 'off' };
  if (reasoning === 'low' || reasoning === 'medium' || reasoning === 'high') {
    return { reasoningEffort: reasoning };
  }
  if (reasoning === 'on') return { thinkingMode: 'on' };
  return {};
}

/** Journal string from header fields (`''` means omit — inherit / default). */
export function journalReasoningFromFields(fields: BoardReasoningFields): string {
  if (fields.reasoningEffort === 'off' || fields.thinkingMode === 'off') return 'off';
  if (
    fields.reasoningEffort === 'low' ||
    fields.reasoningEffort === 'medium' ||
    fields.reasoningEffort === 'high' ||
    fields.reasoningEffort === 'on'
  ) {
    return fields.reasoningEffort;
  }
  if (fields.thinkingMode === 'on') return 'on';
  return '';
}

/** Apply a header patch onto journal-derived fields. */
export function mergeReasoningPatch(
  current: BoardReasoningFields,
  patch: BoardReasoningPatch,
): BoardReasoningFields {
  const next: BoardReasoningFields = { ...current };
  if (patch.clearReasoningEffort) {
    delete next.reasoningEffort;
  } else if (patch.reasoningEffort !== undefined) {
    next.reasoningEffort = patch.reasoningEffort;
  }
  if (patch.clearThinkingMode) {
    delete next.thinkingMode;
  } else if (patch.thinkingMode !== undefined) {
    next.thinkingMode = patch.thinkingMode;
  }
  return next;
}
