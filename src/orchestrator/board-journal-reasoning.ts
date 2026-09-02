import type { ReasoningEffortOption } from '../types.ts';
import type { ThinkingTriState } from '../agents/thinking-types.ts';

export type BoardReasoningPatch = {
  reasoningEffort?: ReasoningEffortOption;
  thinkingMode?: ThinkingTriState;
  clearReasoningEffort?: boolean;
  clearThinkingMode?: boolean;
};

export const BOARD_JOURNAL_REASONING = ['on', 'off', 'low', 'medium', 'high'] as const;

export type BoardJournalReasoning = (typeof BOARD_JOURNAL_REASONING)[number];

export interface BoardReasoningFields {
  thinkingMode?: ThinkingTriState;
  reasoningEffort?: ReasoningEffortOption;
}

export function isBoardJournalReasoning(value: string): value is BoardJournalReasoning {
  return (BOARD_JOURNAL_REASONING as readonly string[]).includes(value);
}

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
