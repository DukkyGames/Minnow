/**
 * Orchestrate board header model chip (menubar-style picker, per-board binding).
 */

import { resolveBoardModelBinding } from '../chat/orchestrate/board-model-binding.ts';
import { setBoardModel } from '../state/orchestrate-board-actions.ts';
import {
  adoptBoardModelChipTrigger,
  setBoardModelTriggerContext,
  syncBoardModelChipTrigger,
  unmountBoardModelChipTrigger,
  type BoardModelChipContext,
} from './composer-model-trigger.ts';
import type { Chat, ChatGroup } from '../types.ts';

type BoardState = NonNullable<ChatGroup['orchestrateBoard']>;

let boardModelOnChanged: (() => void) | null = null;

function v1ChipContext(
  group: ChatGroup,
  board: BoardState,
  plannerChat: Chat,
  onChanged: () => void,
): BoardModelChipContext {
  return {
    resolveBinding: () => resolveBoardModelBinding(plannerChat, board),
    persist: (providerId, modelId) => {
      setBoardModel(group, providerId, modelId, plannerChat);
    },
    onChanged,
  };
}

/** Mount the shared menubar model chip UI on the board header. */
export function wireBoardHeaderModelSelect(
  controls: HTMLElement,
  group: ChatGroup,
  board: BoardState,
  plannerChat: Chat,
  onChanged: () => void,
): void {
  boardModelOnChanged = onChanged;

  let anchor = controls.querySelector('.board-header__model-slot') as HTMLElement | null;
  if (!anchor) {
    anchor = document.createElement('div');
    anchor.className = 'board-header__model-slot mn-os-mb-model-slot';
    controls.insertBefore(anchor, controls.firstChild);
  }

  adoptBoardModelChipTrigger(anchor);
  setBoardModelTriggerContext(v1ChipContext(group, board, plannerChat, onChanged));
}

/** Keep the board model chip aligned after in-place header refresh. */
export function syncBoardHeaderModelSelect(
  _root: HTMLElement,
  group: ChatGroup,
  board: BoardState,
  plannerChat: Chat,
): void {
  if (!boardModelOnChanged) return;
  setBoardModelTriggerContext(v1ChipContext(group, board, plannerChat, boardModelOnChanged));
  syncBoardModelChipTrigger();
}

/** Tear down board model chip when leaving board view (optional cleanup). */
export function teardownBoardHeaderModelSelect(): void {
  unmountBoardModelChipTrigger();
  boardModelOnChanged = null;
}
