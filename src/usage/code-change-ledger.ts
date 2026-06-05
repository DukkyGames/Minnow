/**
 * Per-chat and per-workspace cumulative line add/delete from agent mutations.
 */

import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { Chat, ChatCodeChangeTotals, CodeChangeStats, SessionState } from '../types';

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
  chat.codeChangeBackfillAt = undefined;
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
  chat.codeChangeBackfillAt = Date.now();
}

/** Add stats into workspace rollup map on session state. */
export function recordWorkspaceCodeChange(
  state: SessionState,
  workspacePath: string | undefined,
  stats: CodeChangeStats,
): void {
  if (stats.additions === 0 && stats.deletions === 0) return;
  const key = normalizeWorkspacePath(workspacePath ?? '');
  if (!state.codeChangeTotalsByWorkspace) {
    state.codeChangeTotalsByWorkspace = {};
  }
  const bucket = state.codeChangeTotalsByWorkspace[key] ?? {
    ...EMPTY_CODE_CHANGE_TOTALS,
  };
  bucket.additions += stats.additions;
  bucket.deletions += stats.deletions;
  state.codeChangeTotalsByWorkspace[key] = bucket;
}

/** Sum chat totals for one workspace (used after backfill). */
export function sumChatCodeChangeTotalsForWorkspace(
  state: SessionState,
  workspacePath: string,
): ChatCodeChangeTotals {
  const key = normalizeWorkspacePath(workspacePath);
  let additions = 0;
  let deletions = 0;
  for (const chat of state.chats) {
    if (normalizeWorkspacePath(chat.workspacePath) !== key) continue;
    const t = chat.codeChangeTotals;
    if (!t) continue;
    additions += t.additions;
    deletions += t.deletions;
  }
  return { additions, deletions };
}

/** Rebuild workspace rollup from all chats bound to the workspace. */
export function recomputeWorkspaceCodeChangeTotals(
  state: SessionState,
  workspacePath: string | undefined,
): void {
  const key = normalizeWorkspacePath(workspacePath ?? '');
  if (!state.codeChangeTotalsByWorkspace) {
    state.codeChangeTotalsByWorkspace = {};
  }
  state.codeChangeTotalsByWorkspace[key] = sumChatCodeChangeTotalsForWorkspace(
    state,
    key,
  );
}

/** Workspace rollup for the active workspace path string. */
export function getWorkspaceCodeChangeTotals(
  state: SessionState | null,
  workspacePath: string,
): ChatCodeChangeTotals {
  if (!state?.codeChangeTotalsByWorkspace) return { ...EMPTY_CODE_CHANGE_TOTALS };
  const key = normalizeWorkspacePath(workspacePath);
  const row = state.codeChangeTotalsByWorkspace[key];
  if (!row) return { ...EMPTY_CODE_CHANGE_TOTALS };
  return {
    additions: Number.isFinite(row.additions) ? row.additions : 0,
    deletions: Number.isFinite(row.deletions) ? row.deletions : 0,
  };
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
