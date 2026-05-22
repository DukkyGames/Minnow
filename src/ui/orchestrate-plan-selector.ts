/**
 * Orchestrate mode: plan dropdown inline in composer controls (per-chat persisted path).
 */

import { isActiveChatStreaming } from '../chat/streaming-state';
import {
  normalizeOrchestratePlanPath,
  isExecutableOrchestratePlan,
} from '../chat/orchestrate/plan-path';
import { normalizeModeId } from '../chat/modes/types';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { isComposerRecoveryBlocked } from './composer-send';
import { syncViewModeToggleFromActiveChat } from './view-mode-toggle';
import {
  populateOrchestratePlanSelect,
  persistOrchestratePlanPathFromSelectValue,
  shouldHideComposerPlanStripForOrchestrateBoardOnboarding,
} from './orchestrate-plan-picker';

let planStripEl: HTMLElement | null = null;
let planSelectEl: HTMLSelectElement | null = null;
let planHintEl: HTMLElement | null = null;

function getPlanStrip(): HTMLElement | null {
  if (!planStripEl) {
    planStripEl = document.getElementById('orchestratePlanStrip');
  }
  return planStripEl;
}

function getPlanSelect(): HTMLSelectElement | null {
  if (!planSelectEl) {
    planSelectEl = document.getElementById(
      'orchestratePlanSelect',
    ) as HTMLSelectElement | null;
  }
  return planSelectEl;
}

function getPlanHint(): HTMLElement | null {
  if (!planHintEl) {
    planHintEl = document.getElementById('orchestratePlanHint');
  }
  return planHintEl;
}

/** Disables plan select while streaming or recovery (mirrors expert select). */
export function refreshOrchestratePlanSelectorDisabled(): void {
  const strip = getPlanStrip();
  const sel = getPlanSelect();
  const refreshBtn = document.getElementById(
    'orchestratePlanRefresh',
  ) as HTMLButtonElement | null;
  if (!strip || strip.classList.contains('hidden')) {
    if (refreshBtn) refreshBtn.disabled = true;
    return;
  }
  const disabled = isActiveChatStreaming() || isComposerRecoveryBlocked();
  if (sel && !strip.classList.contains('hidden')) {
    sel.disabled = disabled;
  }
  if (refreshBtn) {
    refreshBtn.disabled = disabled;
  }
}

/**
 * Shows or hides the strip, loads plan options, restores selection, and sets hints.
 */
export async function syncOrchestratePlanStripFromActiveChat(): Promise<void> {
  const strip = getPlanStrip();
  const sel = getPlanSelect();
  const hint = getPlanHint();
  if (!strip || !sel || !hint) return;

  const chat = getActiveChat();
  const mode = normalizeModeId(chat.modeId);

  if (mode !== 'orchestrate') {
    strip.classList.add('hidden');
    sel.disabled = true;
    hint.classList.add('hidden');
    hint.textContent = '';
    return;
  }

  if (shouldHideComposerPlanStripForOrchestrateBoardOnboarding(chat)) {
    strip.classList.add('hidden');
    sel.disabled = true;
    hint.classList.add('hidden');
    hint.textContent = '';
    refreshOrchestratePlanSelectorDisabled();
    return;
  }

  strip.classList.remove('hidden');

  await populateOrchestratePlanSelect(sel, hint, chat, {
    autoSelectSingle: false,
  });

  refreshOrchestratePlanSelectorDisabled();
}

function onPlanSelectChange(): void {
  if (isActiveChatStreaming()) return;
  const sel = getPlanSelect();
  const chat = getActiveChat();
  if (!sel) return;
  persistOrchestratePlanPathFromSelectValue(chat, sel.value);
  syncViewModeToggleFromActiveChat();
}

/**
 * When the user drops an executable plan from the file tree, persist it and refresh the strip.
 * @returns true when the path was applied (Orchestrate mode + valid executable plan).
 */
export function applyOrchestratePlanFromWorkspacePath(workspacePath: string): boolean {
  const norm = normalizeOrchestratePlanPath(workspacePath);
  if (!norm || !isExecutableOrchestratePlan(norm)) return false;
  const chat = getActiveChat();
  if (normalizeModeId(chat.modeId) !== 'orchestrate') return false;
  chat.orchestratePlanPath = norm;
  touchChat(chat);
  scheduleSaveSessions();
  void syncOrchestratePlanStripFromActiveChat();
  syncViewModeToggleFromActiveChat();
  return true;
}

/** Wires refresh button, change handler, and first sync (idempotent). */
export function initOrchestratePlanSelector(): void {
  const strip = getPlanStrip();
  const sel = getPlanSelect();
  if (!strip || !sel || strip.dataset.initialized === 'true') return;
  strip.dataset.initialized = 'true';

  const refreshBtn = document.getElementById('orchestratePlanRefresh');
  refreshBtn?.addEventListener('click', () => {
    void syncOrchestratePlanStripFromActiveChat();
  });

  sel.addEventListener('change', onPlanSelectChange);
  void syncOrchestratePlanStripFromActiveChat();
}
