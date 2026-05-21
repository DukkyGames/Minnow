/**
 * Orchestrate mode: plan dropdown inline in composer controls (per-chat persisted path).
 */

const PLAN_LIST_HINTS: Record<string, string> = {
  server_off: 'Start npm start to list plans.',
  no_plans_dir: 'No documentation/plans folder in this workspace.',
};

import { isActiveChatStreaming } from '../chat/streaming-state';
import { discoverOrchestratePlans } from '../chat/orchestrate/list-plans';
import {
  isExecutableOrchestratePlan,
  normalizeOrchestratePlanPath,
} from '../chat/orchestrate/plan-path';
import { normalizeModeId } from '../chat/modes/types';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { isComposerRecoveryBlocked } from './composer-send';
import { syncViewModeToggleFromActiveChat } from './view-mode-toggle';

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

function shortPlanLabel(fullPath: string): string {
  return fullPath.replace(/^documentation\/plans\//, '');
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

  strip.classList.remove('hidden');

  const { plans, error } = await discoverOrchestratePlans();

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

  const savedRaw = chat.orchestratePlanPath?.trim();
  const saved = savedRaw ? normalizeOrchestratePlanPath(savedRaw) : undefined;
  if (saved && !plans.includes(saved)) {
    const opt = document.createElement('option');
    opt.value = saved;
    opt.textContent = shortPlanLabel(saved);
    sel.appendChild(opt);
  }

  if (saved) {
    sel.value = saved;
  } else {
    sel.value = '';
  }

  hint.textContent = '';
  hint.classList.add('hidden');
  if (error) {
    hint.textContent =
      PLAN_LIST_HINTS[error] ?? 'Could not load plans.';
    hint.classList.remove('hidden');
  } else if (plans.length === 0) {
    hint.textContent = 'No plans yet. Use Plan mode or add documentation/plans/.';
    hint.classList.remove('hidden');
  }

  refreshOrchestratePlanSelectorDisabled();
}

function onPlanSelectChange(): void {
  if (isActiveChatStreaming()) return;
  const sel = getPlanSelect();
  const chat = getActiveChat();
  if (!sel) return;
  const v = sel.value.trim();
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
  touchChat(chat);
  scheduleSaveSessions();
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
