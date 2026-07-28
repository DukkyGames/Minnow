/**
 * Orchestrate board header model chip (menubar-style picker, per-board binding).
 */

import {
  mountBoardModelChipTrigger,
  setBoardModelTriggerContext,
  syncBoardModelChipTrigger,
  unmountBoardModelChipTrigger,
} from './composer-model-trigger.ts';
import type { Chat, ChatGroup } from '../types.ts';

type BoardState = NonNullable<ChatGroup['orchestrateBoard']>;

let boardModelOnChanged: (() => void) | null = null;

/** Mount the shared menubar model chip UI on the board header. */
export function wireBoardHeaderModelSelect(
  controls: HTMLElement,
  group: ChatGroup,
  board: BoardState,
  plannerChat: Chat,
  onChanged: () => void,
): void {
  boardModelOnChanged = onChanged;
  unmountBoardModelChipTrigger();

  const anchor = document.createElement('div');
  anchor.className = 'board-header__model-slot mn-os-mb-model-slot';
  controls.insertBefore(anchor, controls.firstChild);

  mountBoardModelChipTrigger(anchor);
  setBoardModelTriggerContext({ group, board, plannerChat, onChanged });
}

/** Keep the board model chip aligned after in-place header refresh. */
export function syncBoardHeaderModelSelect(
  _root: HTMLElement,
  group: ChatGroup,
  board: BoardState,
  plannerChat: Chat,
): void {
  if (!boardModelOnChanged) return;
  setBoardModelTriggerContext({
    group,
    board,
    plannerChat,
    onChanged: boardModelOnChanged,
  });
  syncBoardModelChipTrigger();
}

/** Tear down board model chip when leaving board view (optional cleanup). */
export function teardownBoardHeaderModelSelect(): void {
  unmountBoardModelChipTrigger();
  boardModelOnChanged = null;
}
