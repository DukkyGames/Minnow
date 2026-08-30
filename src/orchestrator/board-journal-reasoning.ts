/**
 * Map V2 journal `board.model.set.reasoning` onto the Orchestrate header fields.
 *
 * Attempts still only honour thinking on/off (`TurnModel.thinking.mode`). Low /
 * medium / high are journaled so the header round-trips the same control V1 uses.
 */

import type { OrchestrateBoardState, ReasoningEffortOption } from '../types.ts';
import type { ThinkingTriState } from '../agents/thinking-types.ts';
import {
  applyBoardReasoningPatch,
  type BoardReasoningPatch,
} from '../chat/orchestrate/board-reasoning-binding.ts';

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
  const board = { ...current } as OrchestrateBoardState;
  applyBoardReasoningPatch(board, patch);
  const next: BoardReasoningFields = {};
  if (board.thinkingMode !== undefined) next.thinkingMode = board.thinkingMode;
  if (board.reasoningEffort !== undefined) next.reasoningEffort = board.reasoningEffort;
  return next;
}
