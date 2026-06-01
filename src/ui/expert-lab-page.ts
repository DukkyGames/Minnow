/**
 * Expert Lab — picker, brief composer, and run timeline (MIN-59).
 */

import '../styles/expert-lab-page.css';

import { getExpert, listExperts } from '../chat/experts/registry';
import type { ExpertAccent, ExpertMeta } from '../chat/experts/types';
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

export type ExpertLabStep = 'pick' | 'brief' | 'run';

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

function renderExpertGrid(): void {
  const grid = document.getElementById('expertLabGrid');
  if (!grid) return;
  grid.replaceChildren();

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
    tile.addEventListener('click', () => selectExpert(expert.meta.id));
    grid.appendChild(tile);
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
    if (currentStep === 'brief' || currentStep === 'run') {
      setStep(currentStep === 'run' ? 'brief' : 'pick');
      return;
    }
    closeExpertLab();
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
