/**
 * Orchestrate planning screen — full #chatArea overlay for Plan-mode authoring.
 * Suppresses chat stream DOM while mounted; supports suspend/resume via sidebar.
 */

import { findLastPlanSavePath } from '../chat/orchestrate/plan-from-history';
import { mountPlanPreviewContent } from '../chat/orchestrate/plan-preview';
import {
  isExecutableOrchestratePlan,
  normalizeOrchestratePlanPath,
} from '../chat/orchestrate/plan-path';
import { normalizeModeId } from '../chat/modes/types';
import { isFirstUserMessagePending } from '../chat/titles/schedule';
import {
  getMainTurnActivity,
  subscribeMainTurnActivity,
} from '../chat/main-turn-activity';
import { isChatStreaming, subscribeChatStreamEnd } from '../chat/streaming-state';
import { stopGeneration } from '../chat/stop-generation';
import { getOrCreateBoardGroup } from '../state/chat-groups';
import {
  findChatById,
  getActiveChat,
  scheduleSaveSessions,
  sessionState,
} from '../state/sessions';
import type { Chat } from '../types';
import {
  buildHistoryUserContent,
  runChatTurn,
} from '../tools/loop';
import { detectLocalServer, executeTool } from '../tools/client';
import { setChatMode } from './mode-selector';
import { teardownHub } from './hub';
import {
  closeOrchestrateHub,
  isOrchestrateHubMounted,
  renderOrchestrateHub,
  teardownOrchestrateHub,
} from './orchestrate-hub';
import {
  persistOrchestratePlanPathFromSelectValue,
  shortPlanLabel,
} from './orchestrate-plan-picker';
import { createChatWithMode, switchChat } from './sidebar';
import { renderChatFromHistory } from './messages';
import { setOrchestrateViewMode } from './view-mode-toggle';

export const ORCHESTRATE_PLAN_SCREEN_ROOT_ID = 'orchestratePlanScreen';
export const ORCHESTRATE_PLAN_SCREEN_PROMPT_ID = 'orchestratePlanScreenPrompt';
export const ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID = 'orchestratePlanScreenQuestions';
export const ORCHESTRATE_PLAN_BANNER_ID = 'orchestratePlanBanner';

/** Rotating status lines during the working phase. */
export const ORCHESTRATE_PLAN_SCREEN_STATUS_LINES = [
  'Scanning the workspace…',
  'Mapping dependencies…',
  'Drafting waves in documentation/plans/…',
  'Scoping tasks and acceptance criteria…',
  'Checking constraints against the repo…',
  'Surfacing edge cases…',
] as const;

/** @deprecated Use {@link ORCHESTRATE_PLAN_SCREEN_STATUS_LINES}. */
export const ORCHESTRATE_PLAN_SCREEN_FISH_STATUS = ORCHESTRATE_PLAN_SCREEN_STATUS_LINES;

const STATUS_ROTATE_MS = 3500;
const CHAT_AREA_PLAN_SCREEN_CLASS = 'chat-area--plan-screen';
const MAIN_COLUMN_PLAN_SCREEN_CLASS = 'main-column--plan-screen';

export type OrchestratePlanScreenPhase =
  | 'prompt'
  | 'working'
  | 'questions'
  | 'preview'
  | 'error';

export interface OrchestratePlanScreenSession {
  chatId: string;
  phase: OrchestratePlanScreenPhase;
  planPath?: string;
  savedPrompt?: string;
  planScreenSuspended?: boolean;
  errorMessage?: string;
}

export interface RenderOrchestratePlanScreenOptions {
  phase: OrchestratePlanScreenPhase;
  chatId: string;
  planPath?: string;
  savedPrompt?: string;
  errorMessage?: string;
  /** Plan markdown body for preview phase. */
  previewMarkdown?: string;
}

let planSession: OrchestratePlanScreenSession | null = null;
let statusRotateTimer: ReturnType<typeof setInterval> | null = null;
let streamEndUnsubscribe: (() => void) | null = null;
let activityUnsubscribe: (() => void) | null = null;

function ensureStreamEndListener(): void {
  if (streamEndUnsubscribe) return;
  streamEndUnsubscribe = subscribeChatStreamEnd((chatId) => {
    void onPlanSessionStreamEnd(chatId);
  });
}

/** True when plan screen root is in #chatArea. */
export function isOrchestratePlanScreenMounted(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID));
}

/** User switched away while a plan session exists (DOM torn down, session kept). */
export function isOrchestratePlanScreenSuspended(): boolean {
  return Boolean(planSession?.planScreenSuspended);
}

/**
 * Chat stream/tool bubbles should not mount for this chat while the plan screen owns the view.
 */
export function isOrchestratePlanScreenSuppressingChatDom(chatId?: string): boolean {
  if (!isOrchestratePlanScreenMounted()) return false;
  if (isOrchestratePlanScreenSuspended()) return false;
  const session = planSession;
  if (!session?.chatId) return false;
  if (chatId && session.chatId !== chatId) return false;
  return true;
}

/** Active or suspended plan-screen session (banner / stream-end wiring). */
export function getOrchestratePlanScreenSession(): OrchestratePlanScreenSession | null {
  return planSession ? { ...planSession } : null;
}

/** @deprecated Prefer {@link getOrchestratePlanScreenSession}. */
export function getOrchestratePlanScreenOwnerChatId(): string | null {
  return planSession?.chatId ?? null;
}

export function isOrchestratePlanScreenSessionActive(chat: Chat): boolean {
  return Boolean(planSession && planSession.chatId === chat.id);
}

export function isOrchestratePlanScreenSuspendedForChat(chat: Chat): boolean {
  return Boolean(
    planSession &&
      planSession.chatId === chat.id &&
      planSession.planScreenSuspended &&
      !isOrchestratePlanScreenMounted(),
  );
}

/** Suspend overlay when leaving the plan chat via sidebar (keeps session). */
export function suspendOrchestratePlanScreenOnLeave(leavingChatId: string): void {
  if (!planSession || planSession.chatId !== leavingChatId) return;
  if (!isOrchestratePlanScreenMounted()) return;
  planSession.planScreenSuspended = true;
  teardownOrchestratePlanScreenDom();
}

/** Remove overlay nodes only; session state is preserved. */
export function teardownOrchestratePlanScreenDom(): void {
  if (typeof document === 'undefined') return;
  stopStatusRotation();
  activityUnsubscribe?.();
  activityUnsubscribe = null;
  document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID)?.remove();
  document.getElementById('chatArea')?.classList.remove(CHAT_AREA_PLAN_SCREEN_CLASS);
  document
    .getElementById('mainColumn')
    ?.classList.remove(MAIN_COLUMN_PLAN_SCREEN_CLASS);
}

/** Remove overlay and clear plan-screen session. */
export function teardownOrchestratePlanScreen(): void {
  teardownOrchestratePlanScreenDom();
  planSession = null;
}

export function resetOrchestratePlanScreenForTests(): void {
  planSession = null;
  if (streamEndUnsubscribe) {
    streamEndUnsubscribe();
    streamEndUnsubscribe = null;
  }
  teardownOrchestratePlanScreenDom();
}

/**
 * True when the plan screen owns an in-flight turn for this chat (mounted, not suspended).
 */
export function isOrchestratePlanScreenOwningChat(chatId: string): boolean {
  const session = planSession;
  if (!session || session.chatId !== chatId || session.planScreenSuspended) {
    return false;
  }
  if (!isOrchestratePlanScreenMounted()) return false;
  return session.phase === 'working' || session.phase === 'questions';
}

/**
 * Embedded ask_question host while planning; moves session to `questions` during working.
 */
export function resolveOrchestratePlanScreenQuestionHost(
  forChatId?: string,
): HTMLElement | null {
  const session = planSession;
  if (!session?.chatId) return null;
  const targetChatId = forChatId?.trim() || getActiveChat().id;
  if (session.chatId !== targetChatId) return null;
  if (!isOrchestratePlanScreenMounted() || isOrchestratePlanScreenSuspended()) {
    return null;
  }
  if (session.phase !== 'working' && session.phase !== 'questions') {
    return null;
  }
  if (session.phase === 'working') {
    session.phase = 'questions';
    syncPlanStatusFromSession();
  }
  let host = document.getElementById(ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID);
  if (!host) {
    renderOrchestratePlanScreen({
      phase: 'questions',
      chatId: session.chatId,
      savedPrompt: session.savedPrompt,
      planPath: session.planPath,
      errorMessage: session.errorMessage,
    });
    host = document.getElementById(ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID);
  }
  if (host) host.hidden = false;
  return host;
}

function stopStatusRotation(): void {
  if (statusRotateTimer != null) {
    clearInterval(statusRotateTimer);
    statusRotateTimer = null;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function startStatusRotation(statusEl: HTMLElement): void {
  stopStatusRotation();
  let index = 0;
  statusEl.textContent = ORCHESTRATE_PLAN_SCREEN_STATUS_LINES[0]!;
  if (prefersReducedMotion()) return;
  statusRotateTimer = setInterval(() => {
    index = (index + 1) % ORCHESTRATE_PLAN_SCREEN_STATUS_LINES.length;
    statusEl.textContent = ORCHESTRATE_PLAN_SCREEN_STATUS_LINES[index]!;
  }, STATUS_ROTATE_MS);
}

function syncPlanStatusFromSession(): void {
  const statusEl = document.querySelector(
    '.orchestrate-plan-screen__status-text',
  ) as HTMLElement | null;
  if (!statusEl || !planSession) return;
  if (planSession.phase === 'questions') {
    stopStatusRotation();
    statusEl.textContent = 'Waiting for your answers…';
    return;
  }
  if (planSession.phase === 'working') {
    startStatusRotation(statusEl);
  }
}

function formatMainTurnActivitySubline(chatId: string): string {
  const activity = getMainTurnActivity(chatId);
  if (!activity) return '';
  if (activity.phase === 'tools' && activity.currentTool) {
    return `Running ${activity.currentTool}…`;
  }
  if (activity.phase === 'thinking') return 'Thinking…';
  if (activity.phase === 'generating') return 'Generating…';
  return '';
}

function syncPlanScreenActivityLine(el: HTMLElement, chatId: string): void {
  const line = formatMainTurnActivitySubline(chatId);
  if (line) {
    el.textContent = line;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function wirePlanScreenActivityListener(chatId: string): void {
  activityUnsubscribe?.();
  activityUnsubscribe = subscribeMainTurnActivity(() => {
    if (!isOrchestratePlanScreenMounted() || !planSession) return;
    if (planSession.chatId !== chatId) return;
    const el = document.querySelector(
      '.orchestrate-plan-screen__activity',
    ) as HTMLElement | null;
    if (el) syncPlanScreenActivityLine(el, chatId);
  });
}

function findReusableEmptyPlanChat(): Chat | null {
  if (!sessionState) return null;
  const hit = sessionState.chats.find(
    (c) => normalizeModeId(c.modeId) === 'plan' && c.history.length === 0,
  );
  return hit ?? null;
}

function resolveOrCreatePlanChat(): Chat {
  const reusable = findReusableEmptyPlanChat();
  if (reusable) {
    if (sessionState && sessionState.activeId !== reusable.id) {
      switchChat(reusable.id);
    }
    setChatMode('plan');
    return getActiveChat();
  }
  const created = createChatWithMode({ modeId: 'plan' });
  if (created.ok && created.chatId && sessionState) {
    if (sessionState.activeId !== created.chatId) {
      switchChat(created.chatId);
    }
    return sessionState.chats.find((c) => c.id === created.chatId) ?? getActiveChat();
  }
  return getActiveChat();
}

async function onPlanSessionStreamEnd(chatId: string): Promise<void> {
  const session = planSession;
  if (!session || session.chatId !== chatId) return;
  if (session.phase !== 'working' && session.phase !== 'questions') return;

  const chat = findChatById(chatId);
  if (!chat) return;

  const planPath = findLastPlanSavePath(chat.history);
  if (planPath) {
    let previewMarkdown = '';
    try {
      const result = await executeTool('read_file', { path: planPath });
      previewMarkdown = result.content;
    } catch {
      previewMarkdown = '';
    }
    if (planSession) {
      planSession.planPath = planPath;
      planSession.phase = 'preview';
    }
    if (planSession?.planScreenSuspended && getActiveChat().id === chatId) {
      renderChatFromHistory(chat);
      return;
    }
    renderOrchestratePlanScreen({
      phase: 'preview',
      chatId,
      planPath,
      savedPrompt: session.savedPrompt,
      previewMarkdown,
    });
    return;
  }

  if (!isChatStreaming(chatId)) {
    renderOrchestratePlanScreen({
      phase: 'error',
      chatId,
      savedPrompt: session.savedPrompt,
      errorMessage:
        'Planning finished without a saved plan file. Try again or open the chat to review.',
    });
  }
}

async function startPlanningFromPrompt(promptText: string): Promise<void> {
  teardownOrchestrateHub();
  const chat = resolveOrCreatePlanChat();
  ensureStreamEndListener();

  planSession = {
    chatId: chat.id,
    phase: 'working',
    savedPrompt: promptText,
    planScreenSuspended: false,
  };

  renderOrchestratePlanScreen({
    phase: 'working',
    chatId: chat.id,
    savedPrompt: promptText,
  });

  const rawText = promptText;
  const userText = rawText;
  const skillId = null;
  const displayText = userText;
  const historyContent = buildHistoryUserContent(displayText, []);

  await detectLocalServer();
  await runChatTurn({
    chat,
    pushUser: true,
    rawText,
    userText,
    skillId,
    displayText,
    historyContent,
    validAttachments: [],
    titleSeed: userText,
    shouldScheduleTitle: isFirstUserMessagePending(chat),
    skillBody: null,
  });
}

function openBoardWithPlan(planPath: string): void {
  teardownOrchestratePlanScreen();
  teardownOrchestrateHub();
  const active = getActiveChat();
  const canReuse =
    !active.history.length && normalizeModeId(active.modeId) === 'orchestrate';
  let chat = active;
  if (!canReuse) {
    const created = createChatWithMode({ modeId: 'orchestrate' });
    if (created.ok && created.chatId && sessionState) {
      chat =
        sessionState.chats.find((c) => c.id === created.chatId) ?? getActiveChat();
      if (sessionState.activeId !== chat.id) switchChat(chat.id);
    }
  }
  persistOrchestratePlanPathFromSelectValue(chat, planPath);
  if (normalizeModeId(chat.modeId) !== 'orchestrate') {
    setChatMode('orchestrate');
  }
  const group = getOrCreateBoardGroup(chat);
  const norm = normalizeOrchestratePlanPath(planPath);
  if (norm) {
    group.orchestratePlanPath = norm;
    scheduleSaveSessions();
  }
  const needsKickoff = !group.orchestrateBoard;
  setOrchestrateViewMode('board');
  if (needsKickoff) {
    void import('./orchestrate-board').then((m) => m.kickoffOrchestrateBoardBuild());
  }
}

function suspendToViewChat(chat: Chat): void {
  if (!planSession) return;
  planSession.planScreenSuspended = true;
  teardownOrchestratePlanScreenDom();
  if (sessionState && sessionState.activeId !== chat.id) {
    switchChat(chat.id);
  } else {
    renderChatFromHistory(chat);
  }
}

function appendPlanScreenHeader(
  parent: HTMLElement,
  eyebrow: string,
  title: string,
  lede?: string,
): void {
  const header = document.createElement('header');
  header.className = 'orchestrate-plan-screen__header';

  const eyebrowEl = document.createElement('p');
  eyebrowEl.className = 'orchestrate-plan-screen__eyebrow';
  eyebrowEl.textContent = eyebrow;

  const titleEl = document.createElement('h1');
  titleEl.className = 'orchestrate-plan-screen__title';
  titleEl.textContent = title;

  header.append(eyebrowEl, titleEl);
  if (lede?.trim()) {
    const ledeEl = document.createElement('p');
    ledeEl.className = 'orchestrate-plan-screen__lede';
    ledeEl.textContent = lede.trim();
    header.appendChild(ledeEl);
  }
  parent.appendChild(header);
}

function buildPlanScreenDom(opts: RenderOrchestratePlanScreenOptions): HTMLElement {
  const root = document.createElement('div');
  root.id = ORCHESTRATE_PLAN_SCREEN_ROOT_ID;
  root.className = 'orchestrate-plan-screen';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Orchestrate plan authoring');

  const inner = document.createElement('div');
  inner.className = 'orchestrate-plan-screen__inner';

  if (opts.phase === 'prompt') {
    appendPlanScreenHeader(
      inner,
      'Orchestrate',
      'Make a plan',
      'Plan mode writes a markdown plan under documentation/plans/. When it is ready, open the board to run waves.',
    );

    const form = document.createElement('section');
    form.className = 'orchestrate-plan-screen__form';

    const promptLabel = document.createElement('label');
    promptLabel.className = 'orchestrate-plan-screen__prompt-label';
    promptLabel.htmlFor = ORCHESTRATE_PLAN_SCREEN_PROMPT_ID;
    promptLabel.textContent = 'What should this plan cover?';

    const prompt = document.createElement('textarea');
    prompt.id = ORCHESTRATE_PLAN_SCREEN_PROMPT_ID;
    prompt.className = 'orchestrate-plan-screen__prompt';
    prompt.rows = 8;
    prompt.placeholder =
      'Goals, constraints, tech stack, and how you want work grouped into waves…';
    if (opts.savedPrompt) prompt.value = opts.savedPrompt;

    const hint = document.createElement('p');
    hint.className = 'orchestrate-plan-screen__hint';
    hint.textContent =
      'The planner may ask follow-up questions before saving the plan file.';

    form.append(promptLabel, prompt, hint);

    const actions = document.createElement('div');
    actions.className =
      'orchestrate-plan-screen__actions orchestrate-plan-screen__actions--spread';

    const actionsStart = document.createElement('div');
    actionsStart.className = 'orchestrate-plan-screen__actions-start';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--ghost';
    backBtn.textContent = 'Back to hub';
    backBtn.addEventListener('click', () => {
      teardownOrchestratePlanScreen();
      if (isOrchestrateHubMounted()) {
        closeOrchestrateHub();
      } else {
        renderOrchestrateHub();
      }
    });

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--primary';
    startBtn.textContent = 'Start planning';
    startBtn.addEventListener('click', () => {
      const text = prompt.value.trim();
      if (!text) {
        prompt.focus();
        return;
      }
      void startPlanningFromPrompt(text);
    });

    actionsStart.appendChild(backBtn);
    actions.append(actionsStart, startBtn);
    inner.append(form, actions);
  } else if (opts.phase === 'working' || opts.phase === 'questions') {
    appendPlanScreenHeader(
      inner,
      'Orchestrate',
      'Planning in progress',
      'Status updates here. Answer any questions below, or open the chat to inspect tool calls.',
    );

    const statusBlock = document.createElement('div');
    statusBlock.className = 'orchestrate-plan-screen__status-block';

    const statusRow = document.createElement('div');
    statusRow.className = 'orchestrate-plan-screen__status-row';

    const dot = document.createElement('span');
    dot.className = 'orchestrate-plan-screen__status-dot pulse';
    dot.setAttribute('aria-hidden', 'true');

    const statusCopy = document.createElement('div');
    statusCopy.className = 'orchestrate-plan-screen__status-copy';

    const status = document.createElement('p');
    status.className = 'orchestrate-plan-screen__status-text';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = ORCHESTRATE_PLAN_SCREEN_STATUS_LINES[0]!;

    const activity = document.createElement('p');
    activity.className = 'orchestrate-plan-screen__activity';
    activity.hidden = true;

    statusCopy.append(status, activity);
    statusRow.append(dot, statusCopy);
    statusBlock.appendChild(statusRow);

    const questionsHost = document.createElement('div');
    questionsHost.id = ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID;
    questionsHost.className = 'orchestrate-plan-screen__questions';
    questionsHost.hidden = opts.phase !== 'questions';

    const actions = document.createElement('div');
    actions.className =
      'orchestrate-plan-screen__actions orchestrate-plan-screen__actions--spread';

    const actionsStart = document.createElement('div');
    actionsStart.className = 'orchestrate-plan-screen__actions-start';

    const viewChatBtn = document.createElement('button');
    viewChatBtn.type = 'button';
    viewChatBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--ghost';
    viewChatBtn.textContent = 'View chat';
    viewChatBtn.addEventListener('click', () => {
      const chat = findChatById(opts.chatId);
      if (chat) suspendToViewChat(chat);
    });

    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--danger';
    stopBtn.textContent = 'Stop';
    stopBtn.addEventListener('click', () => {
      stopGeneration(opts.chatId);
    });

    actionsStart.appendChild(viewChatBtn);
    actions.append(actionsStart, stopBtn);
    inner.append(statusBlock, questionsHost, actions);

    const afterPaint =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: () => void) => {
            fn();
            return 0;
          };
    afterPaint(() => {
      syncPlanStatusFromSession();
      syncPlanScreenActivityLine(activity, opts.chatId);
    });
  } else if (opts.phase === 'preview') {
    const planPath = opts.planPath?.trim() ?? '';
    appendPlanScreenHeader(
      inner,
      'Orchestrate',
      'Plan ready',
      'Review the draft below, then open the board to initialize waves from this plan.',
    );

    if (planPath) {
      const pathChip = document.createElement('p');
      pathChip.className = 'orchestrate-plan-screen__path';
      pathChip.textContent = shortPlanLabel(planPath);
      pathChip.title = planPath;
      inner.appendChild(pathChip);
    }

    const previewWrap = document.createElement('div');
    previewWrap.className = 'orchestrate-plan-screen__preview-wrap';

    const previewMount = document.createElement('div');
    previewMount.className = 'orchestrate-plan-screen__preview';
    mountPlanPreviewContent(previewMount, opts.previewMarkdown ?? '', { modeId: 'plan' });
    previewWrap.appendChild(previewMount);

    const actions = document.createElement('div');
    actions.className =
      'orchestrate-plan-screen__actions orchestrate-plan-screen__actions--spread';

    const actionsStart = document.createElement('div');
    actionsStart.className = 'orchestrate-plan-screen__actions-start';

    const viewChatBtn = document.createElement('button');
    viewChatBtn.type = 'button';
    viewChatBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--ghost';
    viewChatBtn.textContent = 'View chat';
    viewChatBtn.addEventListener('click', () => {
      const chat = findChatById(opts.chatId);
      if (chat) suspendToViewChat(chat);
    });

    const hubBtn = document.createElement('button');
    hubBtn.type = 'button';
    hubBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--ghost';
    hubBtn.textContent = 'Back to hub';
    hubBtn.addEventListener('click', () => {
      teardownOrchestratePlanScreen();
      renderOrchestrateHub();
    });

    const openBoardBtn = document.createElement('button');
    openBoardBtn.type = 'button';
    openBoardBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--primary';
    openBoardBtn.textContent = 'Open board';
    openBoardBtn.disabled = !planPath || !isExecutableOrchestratePlan(planPath);
    openBoardBtn.addEventListener('click', () => {
      if (planPath) openBoardWithPlan(planPath);
    });

    actionsStart.append(viewChatBtn, hubBtn);
    actions.append(actionsStart, openBoardBtn);
    inner.append(previewWrap, actions);
  } else if (opts.phase === 'error') {
    appendPlanScreenHeader(
      inner,
      'Orchestrate',
      'Planning stopped',
      'The run ended without a saved plan file. Retry or open the chat to see what happened.',
    );

    const err = document.createElement('p');
    err.className = 'orchestrate-plan-screen__error';
    err.setAttribute('role', 'alert');
    err.textContent =
      opts.errorMessage?.trim() ||
      'Something went wrong while planning. Try again or view the chat.';

    const actions = document.createElement('div');
    actions.className =
      'orchestrate-plan-screen__actions orchestrate-plan-screen__actions--spread';

    const actionsStart = document.createElement('div');
    actionsStart.className = 'orchestrate-plan-screen__actions-start';

    const viewChatBtn = document.createElement('button');
    viewChatBtn.type = 'button';
    viewChatBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--ghost';
    viewChatBtn.textContent = 'View chat';
    viewChatBtn.addEventListener('click', () => {
      const chat = findChatById(opts.chatId);
      if (chat) suspendToViewChat(chat);
    });

    const hubBtn = document.createElement('button');
    hubBtn.type = 'button';
    hubBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--ghost';
    hubBtn.textContent = 'Back to hub';
    hubBtn.addEventListener('click', () => {
      teardownOrchestratePlanScreen();
      renderOrchestrateHub();
    });

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--primary';
    retryBtn.textContent = 'Try again';
    retryBtn.addEventListener('click', () => {
      const saved = opts.savedPrompt?.trim() ?? planSession?.savedPrompt?.trim();
      if (saved) {
        void startPlanningFromPrompt(saved);
        return;
      }
      renderOrchestratePlanScreen({
        phase: 'prompt',
        chatId: opts.chatId,
        savedPrompt: opts.savedPrompt,
      });
    });

    actionsStart.append(viewChatBtn, hubBtn);
    actions.append(actionsStart, retryBtn);
    inner.append(err, actions);
  }

  root.appendChild(inner);
  return root;
}

/** Paint plan screen into #chatArea for the given phase. */
export function renderOrchestratePlanScreen(
  opts: RenderOrchestratePlanScreenOptions,
): void {
  teardownHub();
  planSession = {
    chatId: opts.chatId,
    phase: opts.phase,
    planPath: opts.planPath,
    savedPrompt: opts.savedPrompt,
    planScreenSuspended: false,
    errorMessage: opts.errorMessage,
  };

  const area = document.getElementById('chatArea');
  if (!area) return;
  area.replaceChildren();
  area.appendChild(buildPlanScreenDom(opts));
  area.classList.add(CHAT_AREA_PLAN_SCREEN_CLASS);
  document.getElementById('mainColumn')?.classList.add(MAIN_COLUMN_PLAN_SCREEN_CLASS);
  document.getElementById('mainColumn')?.classList.remove('main-column--board-view');
  if (opts.phase === 'working' || opts.phase === 'questions') {
    wirePlanScreenActivityListener(opts.chatId);
  }
}

/** Open plan screen at prompt phase (entry from Orchestrate hub). */
export async function openOrchestratePlanScreen(): Promise<void> {
  teardownOrchestrateHub();
  const savedPrompt = planSession?.savedPrompt;
  const chatId = planSession?.chatId ?? getActiveChat().id;
  renderOrchestratePlanScreen({
    phase: 'prompt',
    chatId,
    savedPrompt,
  });
}

/** Paint suspended-session banner into #chatArea (caller clears area first). */
export function showOrchestratePlanScreenSuspendedBanner(
  area: HTMLElement,
  chat: Chat,
): void {
  const banner = document.createElement('div');
  banner.id = ORCHESTRATE_PLAN_BANNER_ID;
  banner.className = 'orchestrate-plan-screen-banner';
  banner.setAttribute('role', 'status');

  const session = getOrchestratePlanScreenSession();
  const text = document.createElement('p');
  text.className = 'orchestrate-plan-screen-banner__text';
  if (session?.phase === 'preview') {
    text.textContent = 'Your plan is ready. Return to the planning screen to review it.';
  } else if (session?.phase === 'error') {
    text.textContent =
      'Planning ended without a saved plan. Return to the planning screen or review the chat.';
  } else {
    text.textContent =
      'Planning in progress. Return to the planning screen to watch status and answer questions.';
  }

  const actions = document.createElement('div');
  actions.className = 'orchestrate-plan-screen-banner__actions';

  const resumeBtn = document.createElement('button');
  resumeBtn.type = 'button';
  resumeBtn.className = 'orchestrate-plan-screen-banner__resume';
  resumeBtn.textContent = 'Return to planning screen';
  resumeBtn.addEventListener('click', () => {
    if (!planSession || planSession.chatId !== chat.id) return;
    planSession.planScreenSuspended = false;
    const session = planSession;
    renderOrchestratePlanScreen({
      phase: session.phase,
      chatId: session.chatId,
      planPath: session.planPath,
      savedPrompt: session.savedPrompt,
      errorMessage: session.errorMessage,
    });
    if (session.phase === 'preview' && session.planPath) {
      void (async () => {
        try {
          const result = await executeTool('read_file', { path: session.planPath! });
          const pre = document.querySelector('.orchestrate-plan-screen__preview');
          if (!(pre instanceof HTMLElement)) return;
          mountPlanPreviewContent(pre, result.content, { modeId: 'plan' });
        } catch {
          /* keep placeholder */
        }
      })();
    }
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'orchestrate-plan-screen-banner__dismiss';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => {
    teardownOrchestratePlanScreen();
    renderChatFromHistory(chat);
  });

  actions.append(resumeBtn, dismissBtn);
  banner.append(text, actions);
  area.appendChild(banner);
}
