/**
 * Expert dropdown (Auto + manual) in the composer control strip.
 */

import { streaming } from '../app-state';
import { listExperts } from '../chat/experts/registry';
/** Hint payload after auto-routing on send. */
export interface ExpertHintContext {
  expertId: string | null;
  expertLabel: string | null;
}
import { loadExpertsConfig, saveExpertsConfig } from '../config/experts-config';
import {
  defaultExpertSelection,
  getActiveChat,
  getExpertSelection,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type { ExpertSelection } from '../types';

const AUTO_VALUE = 'auto';

let expertSelectEl: HTMLSelectElement | null = null;
let composerControlsEl: HTMLElement | null = null;
let expertAutoHintEl: HTMLElement | null = null;

function getExpertSelect(): HTMLSelectElement | null {
  if (!expertSelectEl) expertSelectEl = document.getElementById('expertSelect') as HTMLSelectElement;
  return expertSelectEl;
}

function getComposerControls(): HTMLElement | null {
  if (!composerControlsEl) {
    composerControlsEl = document.getElementById('composerControls');
  }
  return composerControlsEl;
}

function getExpertAutoHint(): HTMLElement | null {
  if (!expertAutoHintEl) {
    expertAutoHintEl = document.getElementById('expertAutoHint');
  }
  return expertAutoHintEl;
}

/** Populate expert dropdown from registry. */
export function fillExpertSelect(): void {
  const sel = getExpertSelect();
  if (!sel) return;

  const experts = listExperts();
  sel.replaceChildren();

  const autoOpt = document.createElement('option');
  autoOpt.value = AUTO_VALUE;
  autoOpt.textContent = 'Auto';
  sel.appendChild(autoOpt);

  const sep = document.createElement('option');
  sep.disabled = true;
  sep.textContent = '──────────';
  sel.appendChild(sep);

  for (const expert of experts) {
    const opt = document.createElement('option');
    opt.value = expert.meta.id;
    opt.textContent = expert.meta.label;
    sel.appendChild(opt);
  }
}

/** Sync dropdown to active chat persisted selection. */
export function syncExpertSelectForActiveChat(): void {
  const sel = getExpertSelect();
  if (!sel) return;

  const selection = getExpertSelection(getActiveChat());
  if (selection.mode === 'manual' && selection.expertId) {
    const hasOption = Array.from(sel.options).some((o) => o.value === selection.expertId);
    sel.value = hasOption ? selection.expertId : AUTO_VALUE;
  } else {
    sel.value = AUTO_VALUE;
  }

  updateExpertSelectLabel();
  refreshExpertAutoHintFromChat();
}

function updateExpertSelectLabel(): void {
  const sel = getExpertSelect();
  if (!sel) return;
  const selected = sel.options[sel.selectedIndex];
  const label = selected?.textContent ?? 'Auto';
  sel.setAttribute('aria-label', `Expert: ${label}`);
}

/** Show resolved expert hint when mode is Auto. */
export function updateExpertAutoHint(ctx: ExpertHintContext): void {
  const hint = getExpertAutoHint();
  const sel = getExpertSelect();
  if (!hint || !sel) return;

  const selection = getExpertSelection(getActiveChat());
  if (selection.mode !== 'auto' || !ctx.expertId) {
    hint.textContent = '';
    hint.classList.add('hidden');
    return;
  }

  const label = ctx.expertLabel ?? ctx.expertId;
  hint.textContent = `→ ${label}`;
  hint.classList.remove('hidden');
}

function refreshExpertAutoHintFromChat(): void {
  const chat = getActiveChat();
  const selection = getExpertSelection(chat);
  const hint = getExpertAutoHint();
  if (!hint) return;

  if (selection.mode !== 'auto' || !chat.lastResolvedExpertId) {
    hint.textContent = '';
    hint.classList.add('hidden');
    return;
  }

  const expert = listExperts().find((e) => e.meta.id === chat.lastResolvedExpertId);
  hint.textContent = expert ? `→ ${expert.meta.label}` : '';
  if (expert) hint.classList.remove('hidden');
  else hint.classList.add('hidden');
}

function applySelectionFromSelect(): void {
  const sel = getExpertSelect();
  if (!sel) return;

  const chat = getActiveChat();
  const value = sel.value;
  let selection: ExpertSelection;

  if (value === AUTO_VALUE) {
    selection = defaultExpertSelection();
  } else {
    selection = { mode: 'manual', expertId: value };
    const hint = getExpertAutoHint();
    if (hint) {
      hint.textContent = '';
      hint.classList.add('hidden');
    }
  }

  chat.expertSelection = selection;
  touchChat(chat);
  scheduleSaveSessions();
  updateExpertSelectLabel();
}

/** Toggle composer strip visibility from experts.enabled. */
export async function refreshExpertControlsVisibility(): Promise<void> {
  const config = await loadExpertsConfig();
  const strip = getComposerControls();
  const sel = getExpertSelect();
  if (!strip) return;

  if (!config.enabled) {
    strip.classList.add('hidden');
    if (sel) sel.disabled = true;
    return;
  }

  strip.classList.remove('hidden');
  if (sel) sel.disabled = streaming;
}

export function refreshExpertSelectDisabled(): void {
  const sel = getExpertSelect();
  if (!sel) return;
  void loadExpertsConfig().then((config) => {
    sel.disabled = streaming || !config.enabled;
  });
}

export function onExpertSelectChange(): void {
  if (streaming) return;
  applySelectionFromSelect();
}

export function registerExpertHandlers(): void {
  const sel = getExpertSelect();
  if (!sel || sel.dataset.bound === '1') return;
  sel.dataset.bound = '1';
  sel.addEventListener('change', () => onExpertSelectChange());
}

/** Bootstrap expert UI (call from initApp). */
export async function initExpertSelect(): Promise<void> {
  fillExpertSelect();
  syncExpertSelectForActiveChat();
  registerExpertHandlers();
  await refreshExpertControlsVisibility();
}

/** Read-only expert id list for settings drawer. */
export function renderExpertsReadOnlyList(container: HTMLElement): void {
  container.replaceChildren();
  const ul = document.createElement('ul');
  ul.className = 'experts-id-list';
  for (const expert of listExperts()) {
    const li = document.createElement('li');
    li.textContent = expert.meta.id;
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

/** Bind experts enabled checkbox in settings. */
export async function bindExpertsSettingsCheckbox(): Promise<void> {
  const checkbox = document.getElementById('expertsEnabled') as HTMLInputElement | null;
  const listHost = document.getElementById('expertsBuiltinList');
  if (!checkbox) return;

  const config = await loadExpertsConfig();
  checkbox.checked = config.enabled;

  if (listHost) renderExpertsReadOnlyList(listHost);

  if (checkbox.dataset.bound === '1') return;
  checkbox.dataset.bound = '1';

  checkbox.addEventListener('change', () => {
    void saveExpertsConfig({ enabled: checkbox.checked }).then(() => {
      void refreshExpertControlsVisibility();
    });
  });
}
