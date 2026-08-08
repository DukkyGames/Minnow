/**
 * Board onboarding loader hero, status copy, git prompt shell, and cancel handler.
 */

import { isActiveChatStreaming } from '../chat/streaming-state';
import { notifyAskQuestionDisplayContextChanged } from '../chat/ask-question-display';
import { stopGeneration } from '../chat/stop-generation';
import { describeToolInvocation } from '../tools/describe-invocation';
import type { Chat } from '../types';
import { getActiveChat } from '../state/sessions';
import { formatBoardOnboardingPlanDisplay } from './orchestrate-board-plan-display';
import { BOARD_ONBOARDING_QUESTIONS_ID } from './orchestrate-board-onboarding-questions';
import { isAskQuestionModalOpenForChat } from './question-cards-modal';
import {
  getBoardGitSetupPromptKind,
  isBoardGitSetupPromptActive,
  isBoardKickoffInProgress,
  isBoardOnboardingAwaitingInit,
  isBoardOnboardingGitSetupActive,
  resetBoardOnboardingTransientState,
  resolveBoardGitSetupPrompt,
  subscribeBoardOnboardingState,
  type BoardGitPromptKind,
} from './orchestrate-board-onboarding-state';

/** Kanban board icon rects (matches #btnViewModeToggleBoard). */
const BOARD_ICON_RECTS = [
  { x: 3, y: 3, w: 7, h: 18, delay: '0ms' },
  { x: 14, y: 3, w: 7, h: 8, delay: '180ms' },
  { x: 14, y: 13, w: 7, h: 8, delay: '360ms' },
] as const;

export type BoardOnboardingBusyPhase =
  | 'idle'
  | 'plans'
  | 'git-prompt'
  | 'git-setup'
  | 'init';

const PHASE_HEADLINE: Record<Exclude<BoardOnboardingBusyPhase, 'idle'>, string> = {
  plans: 'Preparing your board',
  'git-prompt': 'Repository setup',
  'git-setup': 'Preparing your board',
  init: 'Preparing your board',
};

/** Rotating fallback lines when no tool activity is visible yet. */
const GIT_PROMPT_COPY: Record<
  BoardGitPromptKind,
  { title: string; desc: string; yes: string; no: string; status: string }
> = {
  init: {
    title: 'Git repository',
    desc:
      'Orchestrate uses git for task isolation and merges. Initialize git in this workspace before building the board?',
    yes: 'Yes, initialize git',
    no: 'Continue without git',
    status: 'This workspace is not a git repository. Initialize git before building the board?',
  },
  remote: {
    title: 'GitHub remote',
    desc:
      'Connect a GitHub remote so you can push changes and open pull requests when the plan completes.',
    yes: 'Yes, connect remote',
    no: 'Continue without remote',
    status: 'No GitHub remote is configured. Connect a remote before building the board?',
  },
};

const PHASE_STATUS_POOL: Record<Exclude<BoardOnboardingBusyPhase, 'idle' | 'git-prompt'>, string[]> = {
  plans: [
    'Discovering plan files in your workspace…',
    'Scanning documentation/plans…',
    'Loading available orchestration plans…',
  ],
  'git-setup': [
    'Initializing git in this workspace…',
    'Configuring repository and remote…',
    'Running git setup skill…',
  ],
  init: [
    'Reading your plan file…',
    'Parsing waves and tasks…',
    'Building Kanban columns…',
    'Calling board_init…',
  ],
};

let statusRotateTimer: ReturnType<typeof setInterval> | null = null;
let statusRotateIndex = 0;
let statusRotatePhase: BoardOnboardingBusyPhase = 'idle';
let onboardingStateUnsubscribe: (() => void) | null = null;

function clearStatusRotateTimer(): void {
  if (statusRotateTimer) {
    clearInterval(statusRotateTimer);
    statusRotateTimer = null;
  }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Derive a human status line from the planner chat history during board_init. */
export function deriveBoardInitStatusMessage(chat: Chat): string | null {
  for (let i = chat.history.length - 1; i >= 0; i -= 1) {
    const msg = chat.history[i];
    if (msg.role === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content.includes('board_init')) {
        return 'Creating board tasks and waves…';
      }
      continue;
    }
    if (msg.role !== 'assistant') continue;
    if ('tool_calls' in msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const tc = msg.tool_calls[msg.tool_calls.length - 1];
      const name = tc.function?.name?.trim() ?? '';
      if (!name) continue;
      const args = parseToolArgs(tc.function.arguments ?? '{}');
      const label = describeToolInvocation(name, args).title;
      if (name === 'read_file') return 'Reading your plan file…';
      if (name === 'board_init') return 'Building Kanban from parsed tasks…';
      return `${label}…`;
    }
  }
  return null;
}

function poolForPhase(phase: BoardOnboardingBusyPhase): string[] {
  if (phase === 'idle' || phase === 'git-prompt') return [];
  return PHASE_STATUS_POOL[phase];
}

function currentRotatingMessage(phase: BoardOnboardingBusyPhase): string {
  if (phase === 'idle') return '';
  if (phase === 'git-prompt') {
    return GIT_PROMPT_COPY[getBoardGitSetupPromptKind()].status;
  }
  const pool = poolForPhase(phase);
  if (!pool.length) return '';
  const idx = statusRotateIndex % pool.length;
  return pool[idx] ?? pool[0] ?? '';
}

/** Resolve which loading affordance the onboarding shell should show. */
export function resolveBoardOnboardingBusyPhase(
  plansLoading: boolean,
  boundPlanReady = false,
): BoardOnboardingBusyPhase {
  if (plansLoading && !boundPlanReady) return 'plans';
  if (isBoardGitSetupPromptActive()) return 'git-prompt';
  if (isBoardOnboardingGitSetupActive()) return 'git-setup';
  if (isBoardKickoffInProgress()) return 'init';
  if (isBoardOnboardingAwaitingInit()) return 'init';
  if (isActiveChatStreaming()) return 'init';
  if (plansLoading && boundPlanReady) return 'init';
  if (boundPlanReady) return 'init';
  return 'idle';
}

/** Build animated board icon with concentric progress rings. */
export function createBoardOnboardingHeroIcon(): HTMLElement {
  const hero = document.createElement('div');
  hero.className = 'board-onboarding__hero';
  hero.setAttribute('aria-hidden', 'true');

  const ringOuter = document.createElement('span');
  ringOuter.className = 'board-onboarding__icon-ring board-onboarding__icon-ring--outer';

  const ringProgress = document.createElement('span');
  ringProgress.className = 'board-onboarding__icon-ring board-onboarding__icon-ring--progress';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'board-onboarding__icon-mark';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'board-onboarding__icon-svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  for (const rect of BOARD_ICON_RECTS) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    el.setAttribute('x', String(rect.x));
    el.setAttribute('y', String(rect.y));
    el.setAttribute('width', String(rect.w));
    el.setAttribute('height', String(rect.h));
    el.setAttribute('rx', '1');
    el.classList.add('board-onboarding__icon-col');
    el.style.animationDelay = rect.delay;
    svg.appendChild(el);
  }

  iconWrap.appendChild(svg);
  hero.appendChild(ringOuter);
  hero.appendChild(ringProgress);
  hero.appendChild(iconWrap);
  return hero;
}

/** Inline git setup question (replaces ask_question during board kickoff). */
export function createBoardGitSetupPrompt(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'board-onboarding__git-prompt';
  panel.dataset.boardOnboardingGitPrompt = '';
  panel.hidden = true;

  const title = document.createElement('h3');
  title.className = 'board-onboarding__git-prompt-title';
  title.dataset.boardOnboardingGitPromptTitle = '';

  const desc = document.createElement('p');
  desc.className = 'board-onboarding__git-prompt-desc';
  desc.dataset.boardOnboardingGitPromptDesc = '';

  const actions = document.createElement('div');
  actions.className = 'board-onboarding__git-prompt-actions';

  const yesBtn = document.createElement('button');
  yesBtn.type = 'button';
  yesBtn.className = 'board-btn board-btn--primary board-onboarding__git-prompt-yes';
  yesBtn.dataset.boardOnboardingGitYes = '';

  const noBtn = document.createElement('button');
  noBtn.type = 'button';
  noBtn.className = 'board-btn board-onboarding__git-prompt-no';
  noBtn.dataset.boardOnboardingGitNo = '';

  actions.appendChild(yesBtn);
  actions.appendChild(noBtn);
  panel.appendChild(title);
  panel.appendChild(desc);
  panel.appendChild(actions);
  return panel;
}

/** Sync git prompt title, body, and button labels for init vs remote questions. */
export function syncBoardGitPromptCopy(panel: HTMLElement, kind: BoardGitPromptKind): void {
  const copy = GIT_PROMPT_COPY[kind];
  const title = panel.querySelector('.board-onboarding__git-prompt-title');
  const desc = panel.querySelector('.board-onboarding__git-prompt-desc');
  const yesBtn = panel.querySelector('.board-onboarding__git-prompt-yes');
  const noBtn = panel.querySelector('.board-onboarding__git-prompt-no');
  if (title instanceof HTMLElement) title.textContent = copy.title;
  if (desc instanceof HTMLElement) desc.textContent = copy.desc;
  if (yesBtn instanceof HTMLElement) yesBtn.textContent = copy.yes;
  if (noBtn instanceof HTMLElement) noBtn.textContent = copy.no;
}

function wireGitPromptButtons(wrap: HTMLElement): void {
  const yesBtn = wrap.querySelector('.board-onboarding__git-prompt-yes');
  const noBtn = wrap.querySelector('.board-onboarding__git-prompt-no');
  yesBtn?.addEventListener('click', () => resolveBoardGitSetupPrompt(true));
  noBtn?.addEventListener('click', () => resolveBoardGitSetupPrompt(false));
}

function updateStatusMessageEl(
  messageEl: HTMLElement,
  phase: BoardOnboardingBusyPhase,
  chat: Chat,
): void {
  if (phase === 'idle') {
    messageEl.textContent = '';
    return;
  }
  if (phase === 'git-prompt') {
    messageEl.textContent = currentRotatingMessage(phase);
    return;
  }
  const derived = phase === 'init' ? deriveBoardInitStatusMessage(chat) : null;
  messageEl.textContent = derived ?? currentRotatingMessage(phase);
}

function startStatusRotation(
  wrap: HTMLElement,
  phase: BoardOnboardingBusyPhase,
  chat: Chat,
): void {
  const messageEl = wrap.querySelector(
    '[data-board-onboarding-status-message]',
  ) as HTMLElement | null;
  if (!messageEl) return;

  if (phase === statusRotatePhase && statusRotateTimer) {
    updateStatusMessageEl(messageEl, phase, chat);
    return;
  }

  clearStatusRotateTimer();
  statusRotatePhase = phase;
  statusRotateIndex = 0;
  updateStatusMessageEl(messageEl, phase, chat);

  if (phase === 'idle' || phase === 'git-prompt') return;

  statusRotateTimer = setInterval(() => {
    statusRotateIndex += 1;
    updateStatusMessageEl(messageEl, phase, chat);
  }, 2800);
}

/** Sync hero loader, headline, status copy, git prompt, and footer actions. */
export function syncBoardOnboardingBusyUI(
  wrap: HTMLElement,
  phase: BoardOnboardingBusyPhase,
  chat: Chat,
): void {
  const panel = wrap.querySelector('.board-onboarding__panel');
  const setup = wrap.querySelector('[data-board-onboarding-setup]');
  const loader = wrap.querySelector('[data-board-onboarding-loader]');
  const gitPrompt = wrap.querySelector('[data-board-onboarding-git-prompt]');
  const headline = wrap.querySelector('[data-board-onboarding-headline]') as HTMLElement | null;
  const planName = wrap.querySelector('[data-board-onboarding-plan-name]') as HTMLElement | null;
  const footer = wrap.querySelector('[data-board-onboarding-footer]');
  const cancelBtn = wrap.querySelector('[data-board-onboarding-cancel]') as HTMLButtonElement | null;
  const planSelect = wrap.querySelector('#boardOnboardingPlanSelect') as HTMLSelectElement | null;

  const busy = phase !== 'idle';
  const questionsActive =
    isAskQuestionModalOpenForChat(chat.id) &&
    Boolean(wrap.querySelector(`#${BOARD_ONBOARDING_QUESTIONS_ID} .question-cards-panel`));
  let showLoader =
    !questionsActive &&
    (phase === 'plans' || phase === 'git-setup' || phase === 'init');
  const showGitPrompt = !questionsActive && phase === 'git-prompt';

  wrap.dataset.boardOnboardingBusy = phase === 'idle' ? '' : phase;
  panel?.classList.toggle('board-onboarding__panel--busy', busy);
  panel?.classList.toggle('board-onboarding__panel--centered', busy || showGitPrompt);

  if (setup instanceof HTMLElement) {
    setup.classList.toggle('hidden', busy || showGitPrompt);
    setup.hidden = busy || showGitPrompt;
  }
  if (loader instanceof HTMLElement) {
    loader.classList.toggle('hidden', !showLoader);
    loader.hidden = !showLoader;
  }
  if (gitPrompt instanceof HTMLElement) {
    gitPrompt.classList.toggle('hidden', !showGitPrompt);
    gitPrompt.hidden = !showGitPrompt;
    if (showGitPrompt) {
      syncBoardGitPromptCopy(gitPrompt, getBoardGitSetupPromptKind());
    }
  }
  if (footer instanceof HTMLElement) {
    footer.classList.toggle('hidden', !busy && !showGitPrompt);
    footer.hidden = !busy && !showGitPrompt;
  }
  if (cancelBtn) {
    const cancellable = phase === 'plans' || phase === 'git-prompt' || phase === 'git-setup' || phase === 'init';
    cancelBtn.disabled = !cancellable;
    cancelBtn.hidden = !cancellable;
    cancelBtn.classList.toggle('hidden', !cancellable);
  }

  if (headline && phase !== 'idle') {
    headline.textContent = PHASE_HEADLINE[phase];
  }

  if (planName && planSelect) {
    const path =
      planSelect.value.trim() || wrap.dataset.boardOnboardingPlanPath?.trim() || '';
    planName.textContent = formatBoardOnboardingPlanDisplay(path);
    planName.title = path;
    planName.classList.toggle('hidden', !showLoader || !path);
  }

  startStatusRotation(wrap, phase, chat);
}

/** Stop kickoff / board_init and return onboarding to the plan picker. */
export function cancelBoardOnboardingSetup(chatId?: string): void {
  const id = chatId?.trim() || getActiveChat().id;
  resolveBoardGitSetupPrompt(false);
  resetBoardOnboardingTransientState();
  stopGeneration(id);
  const sel = document.getElementById('boardOnboardingPlanSelect');
  const wrap = sel?.closest('.board-onboarding') as HTMLElement | null;
  if (wrap) {
    delete wrap.dataset.boardOnboardingBoundPlan;
    delete wrap.dataset.boardOnboardingPlanPath;
  }
  void import('./orchestrate-board').then((m) => m.refreshBoardOnboardingIfMounted());
}

/** Wire git prompt buttons, cancel, and jump-to-chat once per mounted panel. */
export function wireBoardOnboardingInteractions(
  wrap: HTMLElement,
  onJumpToChat: () => void,
): void {
  onboardingStateUnsubscribe?.();
  wireGitPromptButtons(wrap);

  const cancelBtn = wrap.querySelector('[data-board-onboarding-cancel]');
  cancelBtn?.addEventListener('click', () => cancelBoardOnboardingSetup());

  const chatBtn = wrap.querySelector('[data-board-onboarding-jump-chat]');
  chatBtn?.addEventListener('click', onJumpToChat);

  onboardingStateUnsubscribe = subscribeBoardOnboardingState(() => {
    void import('./orchestrate-board').then((m) => m.refreshBoardOnboardingIfMounted());
    void import('./orchestrate-board-setup-banner').then((m) =>
      m.syncBoardSetupReturnBanner(),
    );
    notifyAskQuestionDisplayContextChanged();
  });
}

/** Tear down rotation timer and state subscription when onboarding unmounts. */
export function disposeBoardOnboardingUiTimers(): void {
  clearStatusRotateTimer();
  statusRotatePhase = 'idle';
  statusRotateIndex = 0;
  onboardingStateUnsubscribe?.();
  onboardingStateUnsubscribe = null;
}
