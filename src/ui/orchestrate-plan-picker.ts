/**
 * Shared Orchestrate plan list: populate a <select>, map server errors to hints, optional auto-select.
 */

import {
  discoverOrchestratePlans,
  type DiscoverOrchestratePlansResult,
} from '../chat/orchestrate/list-plans';
import { normalizeOrchestratePlanPath, resolveEffectiveOrchestratePlanPath } from '../chat/orchestrate/plan-path';
import { syncOrchestratorPlannerChatTitle } from '../chat/orchestrate/planner-chat-title';
import { normalizeModeId } from '../chat/modes/types';
import { getActiveBoardGroup, getBoardGroupForChat } from '../state/chat-groups';
import { scheduleSaveSessions, touchChat } from '../state/sessions';
import type { Chat } from '../types';
import { isBoardViewActive } from './view-mode-toggle';

/** UI copy for stable discoverOrchestratePlans error codes. */
export const PLAN_LIST_HINTS: Record<string, string> = {
  server_off: 'Open Minnow to list plans.',
  no_plans_dir: 'No documentation/plans folder in this workspace.',
};

/** Strip documentation/plans/ prefix for dropdown labels. */
export function shortPlanLabel(fullPath: string): string {
  return fullPath.replace(/^documentation\/plans\//, '');
}

export interface PopulateOrchestratePlanSelectOptions {
  /**
   * When true and exactly one plan is returned (no list error), persist that path on the chat
   * if the user had no saved path yet.
   */
  autoSelectSingle?: boolean;
  /** Test override: supply a fake plan list instead of discoverOrchestratePlans. */
  discoverPlans?: () => Promise<DiscoverOrchestratePlansResult>;
}

export interface PopulateOrchestratePlanSelectResult {
  plans: string[];
  error?: string;
}

/**
 * Fills a plan <select> from discoverOrchestratePlans, restores saved path, and updates hint text.
 * Does not touch chat except when autoSelectSingle applies a single-plan default.
 */
export async function populateOrchestratePlanSelect(
  sel: HTMLSelectElement,
  hintEl: HTMLElement | null,
  chat: Chat,
  options: PopulateOrchestratePlanSelectOptions = {},
): Promise<PopulateOrchestratePlanSelectResult> {
  const discoverFn = options.discoverPlans ?? discoverOrchestratePlans;
  const { plans, error } = await discoverFn();

  sel.replaceChildren();
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = 'Select plan…';
  sel.appendChild(emptyOpt);

  for (const p of plans) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = shortPlanLabel(p);
    sel.appendChild(opt);
  }

  const savedRaw =
    resolveEffectiveOrchestratePlanPath(chat, getBoardGroupForChat(chat)) ??
    chat.orchestratePlanPath?.trim();
  const saved = savedRaw ? normalizeOrchestratePlanPath(savedRaw) : undefined;
  if (saved && !plans.includes(saved)) {
    const opt = document.createElement('option');
    opt.value = saved;
    opt.textContent = shortPlanLabel(saved);
    sel.appendChild(opt);
  }

  if (options.autoSelectSingle && plans.length === 1 && !error && !savedRaw) {
    const only = plans[0]!;
    const norm = normalizeOrchestratePlanPath(only);
    if (norm) {
      chat.orchestratePlanPath = norm;
      sel.value = norm;
      touchChat(chat);
      scheduleSaveSessions();
    } else {
      sel.value = '';
    }
  } else if (saved) {
    sel.value = saved;
  } else {
    sel.value = '';
  }

  if (hintEl) {
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
    if (error) {
      hintEl.textContent = PLAN_LIST_HINTS[error] ?? 'Could not load plans.';
      hintEl.classList.remove('hidden');
    } else if (plans.length === 0) {
      hintEl.textContent =
        'No plans yet. Use Plan mode or add documentation/plans/.';
      hintEl.classList.remove('hidden');
    }
  }

  return { plans, error };
}

/** Write the current <select> value to chat.orchestratePlanPath and persist session. */
export function persistOrchestratePlanPathFromSelectValue(
  chat: Chat,
  rawValue: string,
): void {
  const v = rawValue.trim();
  if (!v) {
    delete chat.orchestratePlanPath;
  } else {
    const norm = normalizeOrchestratePlanPath(v);
    if (norm) {
      chat.orchestratePlanPath = norm;
    } else {
      delete chat.orchestratePlanPath;
    }
  }
  syncOrchestratorPlannerChatTitle(chat, chat.orchestratePlanPath);
  const group = getBoardGroupForChat(chat);
  if (group && chat.orchestratePlanPath) {
    group.orchestratePlanPath = chat.orchestratePlanPath;
  }
  touchChat(chat);
  scheduleSaveSessions();
}

/**
 * True when the composer plan strip should stay hidden: board onboarding is the plan entry point.
 */
export function shouldHideComposerPlanStripForOrchestrateBoardOnboarding(
  chat: Chat,
): boolean {
  if (normalizeModeId(chat.modeId) !== 'orchestrate') return false;
  const boardViewActive = isBoardViewActive() || chat.viewMode === 'board';
  if (!boardViewActive) return false;
  const group = getActiveBoardGroup() ?? getBoardGroupForChat(chat);
  return !(group?.orchestrateBoard ?? chat.orchestrateBoard);
}
