/**
 * Expert Lab — picker, brief composer, and run timeline (MIN-59).
 */

import '../styles/expert-lab-page.css';

import { createExpertFromDescription } from '../chat/experts/create-expert';
import { isUserOwnedExpert } from '../chat/experts/expert-ownership';
import {
  deleteUserExpert,
  loadUserExpertForEdit,
  saveUserExpert,
} from '../chat/experts/expert-user-ops';
import {
  getBuiltinExpertIds,
  getExpert,
  listExperts,
  syncExpertRegistryFromServer,
} from '../chat/experts/registry';
import type { ExpertAccent, ExpertMeta } from '../chat/experts/types';
import { EXPERT_ACCENT_VALUES } from '../chat/experts/types';
import { setExpertLabPageOpen } from '../app-state';
import { bootGenerationResumeForChat } from '../chat/generation-resume';
import { loadExpertsConfig } from '../config/experts-config';
import { runChatTurn } from '../tools/loop';
import {
  activateExpertLabChat,
  ensureExpertLabChat,
  EXPERT_LAB_CHAT_ID,
  isExpertLabChat,
  resetExpertLabChatHistory,
  restoreActiveChatAfterExpertLab,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import {
  cancelAssistantBubbleRenderDebounce,
  scheduleAssistantBubbleRender,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import { renderChatFromHistory, renderStatsForChat } from './messages';
import { closeBenchmark } from './benchmark-page';
import { closeGlobalBugs } from './global-bugs-page';
import { closeSettings } from './settings-page';
import {
  renderSidebar,
  syncModelSelectForActiveChat,
} from './sidebar';
import { syncComposerFromStreamingState } from './composer-send';
import { syncModeSelectorFromActiveChat } from './mode-selector';
import {
  notifyExpertLabFirstToken,
  notifyExpertLabPartialText,
  notifyExpertLabRunEnd,
  notifyExpertLabRunError,
  notifyExpertLabToolRound,
  setExpertLabStreamListener,
} from './expert-lab-stream';

export type ExpertLabStep = 'pick' | 'create' | 'edit' | 'brief' | 'run';

type PhaseId = 'understanding' | 'clarifying' | 'working' | 'output';

type PhaseStatus = 'pending' | 'active' | 'done';

let currentStep: ExpertLabStep = 'pick';
let selectedExpertId: string | null = null;
let briefText = '';
let savedActiveChatId: string | null = null;
let runInFlight = false;
let tokenCount = 0;
let outputStreamStarted = false;
let outputStreamCursor: HTMLDivElement | null = null;
let clarifyingActive = false;
let questionHostHome: { parent: HTMLElement; nextSibling: ChildNode | null } | null =
  null;
let createInFlight = false;
let editExpertId: string | null = null;
let editFullBody = '';
let editLiteBody = '';
let editLiteEdited = false;
let editDirty = false;
let editProfile: 'full' | 'lite' = 'full';

function getRoot(): HTMLElement | null {
  return document.getElementById('expertLabView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function expertIcon(meta: ExpertMeta): string {
  const icon = meta.icon?.trim();
  return icon || meta.label.charAt(0).toUpperCase();
}

function expertAccent(meta: ExpertMeta): ExpertAccent {
  return meta.accent ?? 'sage';
}

function accentClassName(accent: ExpertAccent): string {
  return `expert-accent-${accent}`;
}

function applyAccentToElement(el: HTMLElement, accent: ExpertAccent): void {
  el.classList.remove(
    'expert-accent-sage',
    'expert-accent-amber',
    'expert-accent-cyan',
    'expert-accent-coral',
    'expert-accent-violet',
    'expert-accent-rose',
  );
  el.classList.add(accentClassName(accent));
}

function setStep(step: ExpertLabStep): void {
  currentStep = step;
  const root = getRoot();
  if (root) root.dataset.step = step;
  const openChatBtn = document.getElementById('btnExpertLabOpenChat');
  if (openChatBtn) {
    openChatBtn.hidden = step !== 'run';
  }
}

function setPhaseStatus(phaseId: PhaseId, status: PhaseStatus): void {
  const el = document.querySelector(
    `.expert-lab-phase[data-phase="${phaseId}"]`,
  ) as HTMLElement | null;
  if (!el) return;
  el.classList.remove('is-pending', 'is-active', 'is-done', 'is-collapsed');
  if (status === 'pending') el.classList.add('is-pending');
  if (status === 'active') el.classList.add('is-active');
  if (status === 'done') {
    el.classList.add('is-done', 'is-collapsed');
  }
  const statusEl = el.querySelector('.expert-lab-phase-status');
  if (statusEl) {
    statusEl.textContent =
      status === 'active' ? 'In progress' : status === 'done' ? 'Done' : 'Pending';
  }
}

/** Rough word count for the Working-phase progress label. */
export function estimateExpertLabTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function ensureOutputStreamCursor(): HTMLDivElement {
  if (!outputStreamCursor) {
    outputStreamCursor = document.createElement('div');
    outputStreamCursor.className = 'cursor cursor--prose';
    outputStreamCursor.setAttribute('aria-hidden', 'true');
  }
  return outputStreamCursor;
}

/** Live stream into the Output phase (debounced markdown + token count). */
function updateExpertLabStreamPreview(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  tokenCount = estimateExpertLabTokenCount(text);
  const countEl = document.getElementById('expertLabWorkingCount');
  if (countEl) countEl.textContent = `${tokenCount} tokens`;

  const spinner = document.querySelector(
    '.expert-lab-phase[data-phase="working"] .expert-lab-spinner',
  ) as HTMLElement | null;
  if (spinner) spinner.hidden = true;

  if (!outputStreamStarted) {
    outputStreamStarted = true;
    const outputPhase = document.querySelector(
      '.expert-lab-phase[data-phase="output"]',
    ) as HTMLElement | null;
    if (outputPhase) {
      outputPhase.classList.remove('is-collapsed', 'is-pending');
    }
    setPhaseStatus('output', 'active');
  }

  const bubble = document.getElementById('expertLabOutputBubble');
  if (!bubble) return;
  const cursor = ensureOutputStreamCursor();
  scheduleAssistantBubbleRender(bubble, text, cursor);
}

function resetTimeline(): void {
  tokenCount = 0;
  outputStreamStarted = false;
  outputStreamCursor = null;
  cancelAssistantBubbleRenderDebounce();
  clarifyingActive = false;
  for (const id of ['understanding', 'clarifying', 'working', 'output'] as PhaseId[]) {
    const el = document.querySelector(
      `.expert-lab-phase[data-phase="${id}"]`,
    ) as HTMLElement | null;
    if (el) {
      el.classList.remove('is-active', 'is-done', 'is-collapsed');
      el.hidden = id === 'clarifying';
    }
    setPhaseStatus(id, 'pending');
  }
  const clarifyingBody = document.getElementById('expertLabClarifyingBody');
  if (clarifyingBody) clarifyingBody.replaceChildren();
  const workingCount = document.getElementById('expertLabWorkingCount');
  if (workingCount) workingCount.textContent = '0 tokens';
  const spinner = document.querySelector(
    '.expert-lab-phase[data-phase="working"] .expert-lab-spinner',
  ) as HTMLElement | null;
  if (spinner) spinner.hidden = false;
  const outputBubble = document.getElementById('expertLabOutputBubble');
  if (outputBubble) outputBubble.replaceChildren();
  restoreQuestionHost();
}

function rememberQuestionHostHome(): void {
  const host = document.getElementById('questionHost');
  const parent = host?.parentElement;
  if (!host || !parent || questionHostHome) return;
  questionHostHome = { parent, nextSibling: host.nextSibling };
}

function restoreQuestionHost(): void {
  const host = document.getElementById('questionHost');
  if (!host || !questionHostHome) return;
  const { parent, nextSibling } = questionHostHome;
  if (nextSibling && nextSibling.parentElement === parent) {
    parent.insertBefore(host, nextSibling);
  } else {
    parent.appendChild(host);
  }
  host.hidden = true;
  getRoot()?.classList.remove('expert-lab-page--question-pending');
}

function mountQuestionHostInClarifying(): void {
  const host = document.getElementById('questionHost');
  const slot = document.getElementById('expertLabClarifyingBody');
  const clarifyingPhase = document.querySelector(
    '.expert-lab-phase[data-phase="clarifying"]',
  ) as HTMLElement | null;
  if (!host || !slot) return;
  rememberQuestionHostHome();
  if (clarifyingPhase) clarifyingPhase.hidden = false;
  slot.appendChild(host);
  host.hidden = false;
  getRoot()?.classList.add('expert-lab-page--question-pending');
  clarifyingPhase?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function watchQuestionHostResolve(onResolved: () => void): void {
  const host = document.getElementById('questionHost');
  const mainColumn = document.getElementById('mainColumn');
  if (!host) return;

  const observer = new MutationObserver(() => {
    const pending = mainColumn?.classList.contains('main-column--question-pending');
    if (!pending && host.hidden) {
      observer.disconnect();
      onResolved();
    }
  });
  observer.observe(host, { attributes: true, attributeFilter: ['hidden'] });
  if (mainColumn) {
    observer.observe(mainColumn, { attributes: true, attributeFilter: ['class'] });
  }
}

function setFormError(elementId: string, message: string | null): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function renderMakeExpertTile(grid: HTMLElement): void {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'expert-lab-tile expert-lab-tile--make expert-accent-violet';
  tile.setAttribute('aria-label', 'Make your own expert');

  const iconEl = document.createElement('span');
  iconEl.className = 'expert-lab-tile-icon';
  iconEl.textContent = '+';
  iconEl.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'expert-lab-tile-label';
  label.textContent = 'Make your own expert';

  const desc = document.createElement('p');
  desc.className = 'expert-lab-tile-desc';
  desc.textContent = 'Describe a specialist and Minnow will draft a custom expert for you.';

  tile.appendChild(iconEl);
  tile.appendChild(label);
  tile.appendChild(desc);
  tile.addEventListener('click', () => openCreateExpertStep());
  grid.appendChild(tile);
}

function closeTileMenus(): void {
  document.querySelectorAll('.expert-lab-tile-menu').forEach((menu) => {
    menu.classList.remove('is-open');
  });
}

function renderExpertTileMenu(tile: HTMLElement, expertId: string, label: string): void {
  const menuWrap = document.createElement('div');
  menuWrap.className = 'expert-lab-tile-menu-wrap';

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'expert-lab-tile-menu-btn';
  menuBtn.setAttribute('aria-label', `Actions for ${label}`);
  menuBtn.textContent = '⋯';

  const menu = document.createElement('div');
  menu.className = 'expert-lab-tile-menu';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTileMenus();
    void openEditExpertStep(expertId);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTileMenus();
    void deleteExpertFromLab(expertId, label);
  });

  menu.appendChild(editBtn);
  menu.appendChild(deleteBtn);
  menuWrap.appendChild(menuBtn);
  menuWrap.appendChild(menu);

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = menu.classList.contains('is-open');
    closeTileMenus();
    if (!wasOpen) {
      menu.classList.add('is-open');
    }
  });

  tile.appendChild(menuWrap);
}

function renderExpertGrid(): void {
  const grid = document.getElementById('expertLabGrid');
  if (!grid) return;
  grid.replaceChildren();

  renderMakeExpertTile(grid);

  const builtinIds = getBuiltinExpertIds();
  for (const expert of listExperts()) {
    const accent = expertAccent(expert.meta);
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `expert-lab-tile ${accentClassName(accent)}`;
    tile.dataset.expertId = expert.meta.id;

    const iconEl = document.createElement('span');
    iconEl.className = 'expert-lab-tile-icon';
    iconEl.textContent = expertIcon(expert.meta);
    iconEl.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'expert-lab-tile-label';
    label.textContent = expert.meta.label;

    const desc = document.createElement('p');
    desc.className = 'expert-lab-tile-desc';
    desc.textContent = expert.meta.description ?? '';

    tile.appendChild(iconEl);
    tile.appendChild(label);
    tile.appendChild(desc);

    if (isUserOwnedExpert(expert, builtinIds)) {
      renderExpertTileMenu(tile, expert.meta.id, expert.meta.label);
    }

    tile.addEventListener('click', () => selectExpert(expert.meta.id));
    grid.appendChild(tile);
  }
}

function openCreateExpertStep(): void {
  setFormError('expertLabCreateError', null);
  const input = document.getElementById('expertLabCreateInput') as HTMLTextAreaElement | null;
  if (input) {
    input.value = '';
    input.disabled = false;
  }
  setStep('create');
  input?.focus();
}

async function submitCreateExpert(): Promise<void> {
  if (createInFlight) return;
  const input = document.getElementById('expertLabCreateInput') as HTMLTextAreaElement | null;
  const description = input?.value.trim() ?? '';
  if (!description) {
    setFormError('expertLabCreateError', 'Describe the expert you want to create.');
    return;
  }

  createInFlight = true;
  setFormError('expertLabCreateError', null);
  const createBtn = document.getElementById('btnExpertLabCreate');
  if (createBtn instanceof HTMLButtonElement) createBtn.disabled = true;
  if (input) input.disabled = true;

  try {
    const result = await createExpertFromDescription({ description });
    renderExpertGrid();
    selectExpert(result.expertId);
    setStep('brief');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setFormError('expertLabCreateError', message);
  } finally {
    createInFlight = false;
    if (createBtn instanceof HTMLButtonElement) createBtn.disabled = false;
    if (input) input.disabled = false;
  }
}

function syncEditBodyField(): void {
  const bodyInput = document.getElementById('expertLabEditBody') as HTMLTextAreaElement | null;
  if (!bodyInput) return;
  bodyInput.value = editProfile === 'full' ? editFullBody : editLiteBody;
}

function markEditDirty(): void {
  editDirty = true;
}

async function openEditExpertStep(expertId: string): Promise<void> {
  const loaded = await loadUserExpertForEdit(expertId);
  if (!loaded) {
    setFormError('expertLabEditError', 'Could not load this expert.');
    return;
  }

  editExpertId = expertId;
  editFullBody = loaded.fullBody;
  editLiteBody = loaded.liteBody;
  editLiteEdited = false;
  editDirty = false;
  editProfile = 'full';

  const labelInput = document.getElementById('expertLabEditLabel') as HTMLInputElement | null;
  const descInput = document.getElementById('expertLabEditDescription') as HTMLInputElement | null;
  const iconInput = document.getElementById('expertLabEditIcon') as HTMLInputElement | null;
  const accentSelect = document.getElementById('expertLabEditAccent') as HTMLSelectElement | null;

  if (labelInput) labelInput.value = loaded.meta.label;
  if (descInput) descInput.value = loaded.meta.description ?? '';
  if (iconInput) iconInput.value = loaded.meta.icon ?? '';
  if (accentSelect) {
    accentSelect.replaceChildren();
    for (const accent of EXPERT_ACCENT_VALUES) {
      const opt = document.createElement('option');
      opt.value = accent;
      opt.textContent = accent.charAt(0).toUpperCase() + accent.slice(1);
      if (accent === (loaded.meta.accent ?? 'sage')) opt.selected = true;
      accentSelect.appendChild(opt);
    }
  }

  document.querySelectorAll('.expert-lab-profile-tab').forEach((tab) => {
    const el = tab as HTMLElement;
    const isFull = el.dataset.profile === 'full';
    el.classList.toggle('is-active', isFull);
    el.setAttribute('aria-selected', isFull ? 'true' : 'false');
  });

  setFormError('expertLabEditError', null);
  syncEditBodyField();
  setStep('edit');
  labelInput?.focus();
}

async function submitEditExpert(event?: Event): Promise<void> {
  event?.preventDefault();
  if (!editExpertId) return;

  const labelInput = document.getElementById('expertLabEditLabel') as HTMLInputElement | null;
  const descInput = document.getElementById('expertLabEditDescription') as HTMLInputElement | null;
  const iconInput = document.getElementById('expertLabEditIcon') as HTMLInputElement | null;
  const accentSelect = document.getElementById('expertLabEditAccent') as HTMLSelectElement | null;
  const bodyInput = document.getElementById('expertLabEditBody') as HTMLTextAreaElement | null;

  if (editProfile === 'full') {
    editFullBody = bodyInput?.value ?? editFullBody;
  } else {
    editLiteBody = bodyInput?.value ?? editLiteBody;
  }

  const saveBtn = document.getElementById('btnExpertLabEditSave');
  if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true;
  setFormError('expertLabEditError', null);

  try {
    await saveUserExpert({
      id: editExpertId,
      label: labelInput?.value.trim() || editExpertId,
      description: descInput?.value.trim(),
      icon: iconInput?.value.trim(),
      accent: (accentSelect?.value as ExpertAccent) || 'sage',
      fullBody: editFullBody,
      liteBody: editLiteBody,
      liteEdited: editLiteEdited,
    });
    editExpertId = null;
    editDirty = false;
    renderExpertGrid();
    setStep('pick');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setFormError('expertLabEditError', message);
  } finally {
    if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = false;
  }
}

function cancelEditExpert(): void {
  if (editDirty && !confirm('Discard unsaved changes?')) return;
  editExpertId = null;
  editDirty = false;
  setFormError('expertLabEditError', null);
  setStep('pick');
}

async function deleteExpertFromLab(expertId: string, label: string): Promise<void> {
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
  try {
    await deleteUserExpert(expertId);
    if (selectedExpertId === expertId) selectedExpertId = null;
    renderExpertGrid();
    setStep('pick');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    alert(message);
  }
}

function selectExpert(expertId: string): void {
  selectedExpertId = expertId;
  const expert = getExpert(expertId);
  if (!expert) return;

  const chip = document.getElementById('expertLabBriefChip');
  if (chip) {
    chip.replaceChildren();
    applyAccentToElement(chip, expertAccent(expert.meta));
    const icon = document.createElement('span');
    icon.className = 'expert-lab-chip-icon';
    icon.textContent = expertIcon(expert.meta);
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = expert.meta.label;
    chip.appendChild(icon);
    chip.appendChild(label);
  }

  const runChip = document.getElementById('expertLabRunChip');
  if (runChip) {
    runChip.replaceChildren();
    applyAccentToElement(runChip, expertAccent(expert.meta));
    const icon = document.createElement('span');
    icon.className = 'expert-lab-chip-icon';
    icon.textContent = expertIcon(expert.meta);
    const label = document.createElement('span');
    label.textContent = expert.meta.label;
    runChip.appendChild(icon);
    runChip.appendChild(label);
  }

  const timeline = document.getElementById('expertLabTimeline');
  if (timeline) {
    applyAccentToElement(timeline, expertAccent(expert.meta));
  }

  const input = document.getElementById('expertLabBriefInput') as HTMLTextAreaElement | null;
  if (input) input.focus();
  setStep('brief');
}

function syncBriefFromInput(): void {
  const input = document.getElementById('expertLabBriefInput') as HTMLTextAreaElement | null;
  briefText = input?.value.trim() ?? '';
}

function renderRunUnderstanding(): void {
  const preview = document.getElementById('expertLabRequestPreview');
  if (!preview) return;
  preview.textContent = briefText;
}

async function startExpertLabRun(): Promise<void> {
  if (runInFlight) return;
  syncBriefFromInput();
  if (!briefText || !selectedExpertId) return;

  const expert = getExpert(selectedExpertId);
  if (!expert?.fullBody?.trim()) return;

  runInFlight = true;
  setStep('run');
  resetTimeline();
  renderRunUnderstanding();
  setPhaseStatus('understanding', 'active');

  const runBtn = document.getElementById('btnExpertLabRun');
  if (runBtn instanceof HTMLButtonElement) runBtn.disabled = true;

  resetExpertLabChatHistory();
  const labChat = ensureExpertLabChat();
  labChat.expertSelection = { mode: 'manual', expertId: selectedExpertId };
  labChat.lastResolvedExpertId = selectedExpertId;
  touchChat(labChat);
  scheduleSaveSessions();

  try {
    await runChatTurn({
      chat: labChat,
      pushUser: true,
      rawText: briefText,
      userText: briefText,
      skillId: null,
      displayText: briefText,
      historyContent: briefText,
      validAttachments: [],
      shouldScheduleTitle: false,
      composedSystemPromptOverride: expert.fullBody.trim(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notifyExpertLabRunError(labChat.id, message);
  } finally {
    runInFlight = false;
    if (runBtn instanceof HTMLButtonElement) runBtn.disabled = false;
  }
}

function bindStreamListener(): void {
  setExpertLabStreamListener({
    onRunStart: (chatId) => {
      if (!isExpertLabChat(ensureExpertLabChat()) || chatId !== EXPERT_LAB_CHAT_ID) return;
    },
    onFirstToken: (chatId) => {
      if (chatId !== EXPERT_LAB_CHAT_ID) return;
      setPhaseStatus('understanding', 'done');
      if (!clarifyingActive) {
        setPhaseStatus('working', 'active');
      }
    },
    onPartialText: (chatId, text) => {
      if (chatId !== EXPERT_LAB_CHAT_ID) return;
      updateExpertLabStreamPreview(text);
    },
    onToolRound: (chatId, toolName) => {
      if (chatId !== EXPERT_LAB_CHAT_ID || toolName !== 'ask_question') return;
      clarifyingActive = true;
      const clarifyingPhase = document.querySelector(
        '.expert-lab-phase[data-phase="clarifying"]',
      ) as HTMLElement | null;
      if (clarifyingPhase) clarifyingPhase.hidden = false;
      setPhaseStatus('clarifying', 'active');
      mountQuestionHostInClarifying();
      watchQuestionHostResolve(() => {
        clarifyingActive = false;
        setPhaseStatus('clarifying', 'done');
        restoreQuestionHost();
        setPhaseStatus('working', 'active');
      });
    },
    onRunEnd: (chatId, finalText) => {
      if (chatId !== EXPERT_LAB_CHAT_ID) return;
      setPhaseStatus('understanding', 'done');
      if (clarifyingActive) {
        setPhaseStatus('clarifying', 'done');
        restoreQuestionHost();
      } else {
        const clarifyingPhase = document.querySelector(
          '.expert-lab-phase[data-phase="clarifying"]',
        ) as HTMLElement | null;
        if (clarifyingPhase) clarifyingPhase.hidden = true;
      }
      setPhaseStatus('working', 'done');
      setPhaseStatus('output', 'active');
      cancelAssistantBubbleRenderDebounce();
      const bubble = document.getElementById('expertLabOutputBubble');
      if (bubble) {
        setAssistantBubbleContent(bubble, finalText, { streaming: false });
      }
      outputStreamCursor = null;
      setPhaseStatus('output', 'done');
    },
    onRunError: () => {
      setPhaseStatus('working', 'done');
    },
  });
}

/** Refresh empty vs grid when experts.enabled toggles. */
export async function refreshExpertLabEnabledState(): Promise<void> {
  const config = await loadExpertsConfig();
  const empty = document.getElementById('expertLabDisabled');
  const pickStep = document.querySelector('.expert-lab-step--pick');
  if (!empty || !pickStep) return;
  if (config.enabled) {
    empty.classList.add('hidden');
    pickStep.classList.remove('hidden-by-disabled');
    await syncExpertRegistryFromServer();
    renderExpertGrid();
  } else {
    empty.classList.remove('hidden');
    pickStep.classList.add('hidden-by-disabled');
  }
}

export function isExpertLabPageOpen(): boolean {
  return getRoot()?.classList.contains('is-open') ?? false;
}

/** Show the Expert Lab session in the main chat shell (run may continue in background). */
export function openExpertLabInChatView(): void {
  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  activateExpertLabChat();
  const chat = ensureExpertLabChat();
  setExpertLabPageOpen(false);
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  document.querySelector('header.topbar')?.classList.remove('hidden');

  syncModelSelectForActiveChat();
  renderChatFromHistory(chat);
  void bootGenerationResumeForChat(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncComposerFromStreamingState();
  renderSidebar();
  void import('../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(chat.id));
}

/** Close Expert Lab and return to the chat shell. */
export function closeExpertLab(): void {
  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  setExpertLabPageOpen(false);
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  document.querySelector('header.topbar')?.classList.remove('hidden');
  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
  setExpertLabStreamListener(null);
  restoreQuestionHost();

  if (savedActiveChatId) {
    restoreActiveChatAfterExpertLab(savedActiveChatId);
    savedActiveChatId = null;
  }

  setStep('pick');
  selectedExpertId = null;
  briefText = '';
  editExpertId = null;
  editDirty = false;
  closeTileMenus();

  if (window.location.hash.startsWith('#/experts')) {
    window.location.hash = '#/';
  }
}

/** Open Expert Lab (`#/experts`). */
export function openExpertLab(): void {
  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  closeSettings();
  closeGlobalBugs();
  closeBenchmark();
  void import('./welcome-page').then((m) => {
    if (m.isWelcomePageOpen()) m.closeWelcome({ skipHash: true });
  });

  if (!savedActiveChatId) {
    savedActiveChatId = activateExpertLabChat();
  } else {
    activateExpertLabChat();
  }

  setExpertLabPageOpen(true);
  root.classList.add('is-open');
  shell.classList.add('hidden');
  document.querySelector('header.topbar')?.classList.add('hidden');
  document.getElementById('drawer')?.setAttribute('aria-hidden', 'true');
  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );

  setStep('pick');
  void refreshExpertLabEnabledState();

  const nextHash = '#/experts';
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

export function openExpertLabFromTopbar(): void {
  openExpertLab();
}

let staticBindingsDone = false;

function bindStaticControls(): void {
  if (staticBindingsDone) return;
  staticBindingsDone = true;

  document.getElementById('btnExpertLabPageBack')?.addEventListener('click', () => {
    if (currentStep === 'run') {
      setStep('brief');
      return;
    }
    if (currentStep === 'brief') {
      setStep('pick');
      return;
    }
    if (currentStep === 'create') {
      setStep('pick');
      return;
    }
    if (currentStep === 'edit') {
      cancelEditExpert();
      return;
    }
    closeExpertLab();
  });

  document.getElementById('btnExpertLabCreateCancel')?.addEventListener('click', () => {
    setStep('pick');
  });

  document.getElementById('btnExpertLabCreate')?.addEventListener('click', () => {
    void submitCreateExpert();
  });

  document.getElementById('btnExpertLabEditCancel')?.addEventListener('click', () => {
    cancelEditExpert();
  });

  document.getElementById('expertLabEditForm')?.addEventListener('submit', (e) => {
    void submitEditExpert(e);
  });

  document.getElementById('expertLabEditLabel')?.addEventListener('input', markEditDirty);
  document.getElementById('expertLabEditDescription')?.addEventListener('input', markEditDirty);
  document.getElementById('expertLabEditIcon')?.addEventListener('input', markEditDirty);
  document.getElementById('expertLabEditAccent')?.addEventListener('change', markEditDirty);

  const editBody = document.getElementById('expertLabEditBody');
  editBody?.addEventListener('input', () => {
    markEditDirty();
    if (editProfile === 'lite') editLiteEdited = true;
    const ta = editBody as HTMLTextAreaElement;
    if (editProfile === 'full') editFullBody = ta.value;
    else editLiteBody = ta.value;
  });

  document.querySelectorAll('.expert-lab-profile-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const el = tab as HTMLElement;
      const profile = el.dataset.profile === 'lite' ? 'lite' : 'full';
      const bodyInput = document.getElementById('expertLabEditBody') as HTMLTextAreaElement | null;
      if (bodyInput) {
        if (editProfile === 'full') editFullBody = bodyInput.value;
        else editLiteBody = bodyInput.value;
      }
      editProfile = profile;
      document.querySelectorAll('.expert-lab-profile-tab').forEach((t) => {
        const node = t as HTMLElement;
        const active = node.dataset.profile === profile;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      syncEditBodyField();
    });
  });

  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.expert-lab-tile-menu-wrap')) {
      closeTileMenus();
    }
  });

  document.getElementById('btnExpertLabBriefBack')?.addEventListener('click', () => {
    setStep('pick');
  });

  document.getElementById('btnExpertLabRun')?.addEventListener('click', () => {
    void startExpertLabRun();
  });

  document.getElementById('btnExpertLabOpenChat')?.addEventListener('click', () => {
    openExpertLabInChatView();
  });

  document.getElementById('expertLabTimeline')?.addEventListener('click', (e) => {
    const phase = (e.target as HTMLElement).closest(
      '.expert-lab-phase.is-done.is-collapsed',
    );
    if (!phase) return;
    const head = (e.target as HTMLElement).closest('.expert-lab-phase-head');
    if (!head || !phase.contains(head)) return;
    phase.classList.toggle('is-collapsed');
  });

  bindStreamListener();
  rememberQuestionHostHome();
}

function onHashChange(): void {
  if (window.location.hash.startsWith('#/experts')) {
    openExpertLab();
    return;
  }
  if (isExpertLabPageOpen()) {
    closeExpertLab();
  }
}

/** Wire topbar button, steps, hash routing, and stream listener. */
export function initExpertLabPage(): void {
  bindStaticControls();
  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash.startsWith('#/experts')) {
    openExpertLab();
  }
}

if (typeof window !== 'undefined') {
  window.openExpertLab = openExpertLab;
  window.openExpertLabFromTopbar = openExpertLabFromTopbar;
}
