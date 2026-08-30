/**
 * V2 Boards header instruments — the Orchestrate model chip + reasoning strip.
 *
 * The live pane `replaceChildren`s on every journal event. These controls are
 * detached before that wipe and re-homed onto the new header so the picker menu
 * is not torn down mid-open, and so we never re-fetch a model catalog (the chip
 * reads the canonical `#modelSelect`).
 */

import type { BoardState } from '../../server/orchestrator/core/types';
import { decodeModelSelectKey } from '../lib/model-select-key.ts';
import type { BoardReasoningPatch } from '../chat/orchestrate/board-reasoning-binding.ts';
import {
  fieldsFromJournalReasoning,
  isBoardJournalReasoning,
  journalReasoningFromFields,
  mergeReasoningPatch,
} from './board-journal-reasoning.ts';
import {
  adoptBoardModelChipTrigger,
  setBoardModelTriggerContext,
  syncBoardModelChipTrigger,
  unmountBoardModelChipTrigger,
} from '../ui/composer-model-trigger.ts';
import {
  wireBoardHeaderReasoningSource,
  detachBoardHeaderReasoning,
  teardownBoardHeaderReasoning,
} from '../ui/orchestrate-board-reasoning.ts';

export interface V2BoardHeaderCommands {
  /** Journal `board.model.set`. Empty reasoning omits the field (inherit). */
  setModel: (providerId: string, id: string, reasoning: string) => Promise<void>;
  /** Shown when reasoning is changed before any model can be resolved. */
  onNeedModel: () => void;
}

/** Latest fold, so persist closures do not capture a stale paint. */
let liveState: BoardState | null = null;
let liveCommands: V2BoardHeaderCommands | null = null;

/** Binding shown in the chip: journal override, else the menubar `#modelSelect`. */
export function resolveV2BoardModelBinding(state: BoardState | null): {
  providerId: string;
  modelId: string;
} {
  const bound = state?.model;
  if (bound?.providerId && bound.id) {
    return { providerId: bound.providerId, modelId: bound.id };
  }
  if (typeof document === 'undefined') return { providerId: '', modelId: '' };
  const raw =
    (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value?.trim() ?? '';
  const decoded = decodeModelSelectKey(raw);
  if (decoded) return decoded;
  return { providerId: '', modelId: raw };
}

/** Pull the chip and reasoning strip out of the header so a pane wipe cannot destroy them. */
export function detachV2BoardHeaderInstruments(): void {
  const slot = document.querySelector(
    '#orchestratorBoardsRoot .board-header__model-slot',
  ) as HTMLElement | null;
  const chip = slot?.querySelector('.composer-model-trigger-wrap--board') as HTMLElement | null;
  chip?.remove();
  detachBoardHeaderReasoning();
}

/** Mount or re-home the Orchestrate instruments onto this paint's header. */
export function attachV2BoardHeaderInstruments(
  controls: HTMLElement,
  state: BoardState,
  commands: V2BoardHeaderCommands,
): void {
  liveState = state;
  liveCommands = commands;

  const slot =
    (controls.querySelector('.board-header__model-slot') as HTMLElement | null) ??
    (() => {
      const created = document.createElement('div');
      created.className = 'board-header__model-slot mn-os-mb-model-slot';
      controls.insertBefore(created, controls.firstChild);
      return created;
    })();

  adoptBoardModelChipTrigger(slot);
  setBoardModelTriggerContext({
    resolveBinding: () => resolveV2BoardModelBinding(liveState),
    persist: (providerId, modelId) => {
      const reasoning = liveState?.model?.reasoning ?? '';
      if (liveState) {
        liveState = {
          ...liveState,
          model: {
            providerId,
            id: modelId,
            reasoning: reasoning || null,
          },
        };
      }
      void liveCommands?.setModel(providerId, modelId, reasoning);
    },
    onChanged: () => {
      // The stream paints when the journal lands; do not rewrite the fold here.
    },
  });
  syncBoardModelChipTrigger();

  wireBoardHeaderReasoningSource(controls, {
    resolveBinding: () => resolveV2BoardModelBinding(liveState),
    getBoard: () => fieldsFromJournalReasoning(liveState?.model?.reasoning),
    isRunning: () => liveState?.status === 'running',
    persist: (patch: BoardReasoningPatch) => {
      const current = fieldsFromJournalReasoning(liveState?.model?.reasoning);
      const next = mergeReasoningPatch(current, patch);
      const journal = journalReasoningFromFields(next);
      const binding = resolveV2BoardModelBinding(liveState);
      if (!binding.providerId || !binding.modelId) {
        liveCommands?.onNeedModel();
        return;
      }
      void liveCommands?.setModel(
        binding.providerId,
        binding.modelId,
        isBoardJournalReasoning(journal) ? journal : '',
      );
      if (liveState) {
        liveState = {
          ...liveState,
          model: {
            providerId: binding.providerId,
            id: binding.modelId,
            reasoning: journal || null,
          },
        };
      }
    },
    onChanged: () => {
      // Stream-driven, same as the model chip.
    },
  });
}

/** Leave Boards — drop the singleton chip so Orchestrate can own it again. */
export function teardownV2BoardHeaderInstruments(): void {
  liveState = null;
  liveCommands = null;
  unmountBoardModelChipTrigger();
  teardownBoardHeaderReasoning();
}
