/**
 * Per-chat cumulative line add/delete from file-mutation tools.
 */

import type { Chat, ChatCodeChangeTotals, CodeChangeStats } from '../types';

export const EMPTY_CODE_CHANGE_TOTALS: ChatCodeChangeTotals = {
  additions: 0,
  deletions: 0,
};

/** Ensure chat has a totals object after session load. */
export function ensureCodeChangeTotals(chat: Chat): ChatCodeChangeTotals {
  if (!chat.codeChangeTotals || typeof chat.codeChangeTotals !== 'object') {
    chat.codeChangeTotals = { ...EMPTY_CODE_CHANGE_TOTALS };
  }
  const totals = chat.codeChangeTotals;
  if (!Number.isFinite(totals.additions)) totals.additions = 0;
  if (!Number.isFinite(totals.deletions)) totals.deletions = 0;
  return totals;
}

/** Reset totals when chat history is cleared. */
export function resetCodeChangeTotals(chat: Chat): void {
  chat.codeChangeTotals = { ...EMPTY_CODE_CHANGE_TOTALS };
}

/**
 * Roll one tool's line stats into the chat total.
 * Skips when both counts are zero.
 */
export function recordCodeChange(chat: Chat, stats: CodeChangeStats): void {
  if (stats.additions === 0 && stats.deletions === 0) return;
  const totals = ensureCodeChangeTotals(chat);
  totals.additions += stats.additions;
  totals.deletions += stats.deletions;
}

/** Plain-text +/− for the composer strip (no HTML). */
export function formatCodeChangeTotalsText(totals: ChatCodeChangeTotals): string {
  return `+${totals.additions} −${totals.deletions}`;
}

/** True when the strip should be visible. */
export function hasCodeChangeTotals(totals: ChatCodeChangeTotals | undefined): boolean {
  if (!totals) return false;
  return totals.additions > 0 || totals.deletions > 0;
}
