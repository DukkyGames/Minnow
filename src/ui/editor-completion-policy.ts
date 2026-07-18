/**
 * Pure LSP/AI completion arbitration — shared by ghost text, debounce, and Tab keymaps.
 */

import { completionStatus, pickedCompletion } from '@codemirror/autocomplete';
import type { EditorState, Transaction } from '@codemirror/state';

/** Default pause after accepting an LSP/snippet item before AI may schedule. */
export const COMPLETION_ACCEPT_COOLDOWN_MS = 300;

/** View-update slice passed into {@link shouldScheduleAi}. */
export interface ShouldScheduleAiUpdate {
  docChanged: boolean;
  selectionSet: boolean;
  readOnly: boolean;
  state: EditorState;
  transactions?: readonly Transaction[];
  /** LSP menu closed in this update without accepting an item. */
  lspClosedWithoutAccept?: boolean;
}

/** Runtime inputs for {@link shouldScheduleAi}. */
export interface ShouldScheduleAiOptions {
  now?: number;
  /** Epoch ms when an LSP completion was last accepted (0 = never). */
  completionAcceptedAt?: number;
  completionAcceptCooldownMs?: number;
  /** IME composition in progress on the editor view. */
  isComposing?: boolean;
}

/** True while CodeMirror is waiting on or showing an LSP completion menu. */
export function isLspBusy(state: EditorState): boolean {
  const status = completionStatus(state);
  return status === 'pending' || status === 'active';
}

/** AI Tab binding should yield so LSP (or indent) can handle the key. */
export function shouldAiTabYieldToLsp(state: EditorState): boolean {
  return isLspBusy(state);
}

/** LSP Tab binding should take precedence over indent (pending or active). */
export function shouldLspTabTakePrecedence(state: EditorState): boolean {
  return isLspBusy(state);
}

/** Concatenate text inserted by the given transactions. */
export function collectInsertedText(transactions: readonly Transaction[] | undefined): string {
  if (!transactions?.length) return '';
  let text = '';
  for (const tr of transactions) {
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      text += inserted.toString();
    });
  }
  return text;
}

/** True when any transaction accepted a completion item. */
export function hasCompletionAccept(transactions: readonly Transaction[] | undefined): boolean {
  return transactions?.some((tr) => tr.annotation(pickedCompletion) != null) ?? false;
}

/** True when inserted text is worth an idle AI request (Phase 6 gating subset). */
export function isMeaningfulEditText(text: string): boolean {
  if (!text) return false;
  if (text.includes('\n')) return true;
  if (/[\w$]/.test(text)) return true;
  if (/^\s+$/.test(text)) return false;
  if (/^[.,;:!?'"`()[\]{}\\/-]+$/.test(text)) return false;
  return true;
}

function hasCollapsedSingleCursor(state: EditorState): boolean {
  if (state.selection.ranges.length !== 1) return false;
  return state.selection.main.empty;
}

function isWithinCompletionAcceptCooldown(
  now: number,
  completionAcceptedAt: number,
  cooldownMs: number,
): boolean {
  return completionAcceptedAt > 0 && now - completionAcceptedAt < cooldownMs;
}

/**
 * Whether the AI completion plugin may start (or restart) its debounce timer.
 * LSP-busy updates are handled upstream; callers should bail before scheduling when busy.
 */
export function shouldScheduleAi(
  update: ShouldScheduleAiUpdate,
  options: ShouldScheduleAiOptions = {},
): boolean {
  if (update.readOnly) return false;
  if (isLspBusy(update.state)) return false;
  if (options.isComposing) return false;
  if (!hasCollapsedSingleCursor(update.state)) return false;

  const now = options.now ?? Date.now();
  const cooldownMs = options.completionAcceptCooldownMs ?? COMPLETION_ACCEPT_COOLDOWN_MS;
  const acceptedAt = options.completionAcceptedAt ?? 0;
  if (isWithinCompletionAcceptCooldown(now, acceptedAt, cooldownMs)) return false;

  if (hasCompletionAccept(update.transactions)) return false;

  if (update.lspClosedWithoutAccept) {
    return true;
  }

  if (!update.docChanged) return false;
  if (update.selectionSet && !update.docChanged) return false;

  const inserted = collectInsertedText(update.transactions);
  const deletionOnly = inserted.length === 0 && update.transactions?.some((tr) => !tr.changes.empty);
  if (deletionOnly) return false;
  if (!isMeaningfulEditText(inserted)) return false;

  return true;
}

/** Detect LSP menu closing without accepting an item in this view update. */
export function didLspCloseWithoutAccept(
  startState: EditorState,
  endState: EditorState,
  transactions: readonly Transaction[],
): boolean {
  return (
    isLspBusy(startState) &&
    !isLspBusy(endState) &&
    !hasCompletionAccept(transactions)
  );
}
