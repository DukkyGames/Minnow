/**
 * Orchestrate planning screen — full #chatArea overlay for Plan-mode authoring.
 * Suppresses chat stream DOM while mounted; supports suspend/resume via sidebar.
 */

import { findLastPlanSavePath } from '../chat/orchestrate/plan-from-history';
import { mountPlanPreviewContent } from '../chat/orchestrate/plan-preview';
import {
  isExecutableOrchestratePlan,
} from '../chat/orchestrate/plan-path';
import { normalizeModeId } from '../chat/modes/types';
import {
  getSuperPlanCheckpointKind,
  resumeSuperPlanAfterUser,
  startSuperPlan,
  subscribeSuperPlanController,
} from '../chat/super-plan/controller';
import { isFirstUserMessagePending } from '../chat/titles/schedule';
import {
  getMainTurnActivity,
  subscribeMainTurnActivity,
} from '../chat/main-turn-activity';
import { isChatStreaming, subscribeChatStreamEnd } from '../chat/streaming-state';
import { stopGeneration } from '../chat/stop-generation';
import {
  findChatById,
  getActiveChat,
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
import { shortPlanLabel } from './orchestrate-plan-picker';
import { launchBoardFromPlan } from './orchestrate-launch';
import { createChatWithMode, switchChat } from './sidebar';
import { renderChatFromHistory } from './messages';
import {
  forceCloseAskQuestionModalForChat,
  isAskQuestionModalOnPlanScreenHost,
  isAskQuestionModalOpenForChat,
  migrateActiveQuestionModalToHost,
} from './question-cards-modal';
import {
  PLAN_PROGRESS_MOUNT_ID,
  PlanProgressPanel,
  buildPlanPreviewPopoutDom,
  prefersReducedMotion,
  regularPlanWorkingStepFromChat,
} from './plan-progress-screen';

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

const CHAT_AREA_PLAN_SCREEN_CLASS = 'chat-area--plan-screen';
const MAIN_COLUMN_PLAN_SCREEN_CLASS = 'main-column--plan-screen';

export type OrchestratePlanScreenPhase =
  | 'prompt'
  | 'working'
  | 'super-plan-working'
  | 'questions'
  | 'spec_confirm'
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
  /** Plan or build-spec markdown for preview / spec_confirm phases. */
  previewMarkdown?: string;
  /** When true, keep the overlay torn down and only update session (banner resume sets false). */
  planScreenSuspended?: boolean;
}

let planSession: OrchestratePlanScreenSession | null = null;
let streamEndUnsubscribe: (() => void) | null = null;
let activityUnsubscribe: (() => void) | null = null;
let superPlanUnsubscribe: (() => void) | null = null;
let planProgressPanel: PlanProgressPanel | null = null;

/** Read a plan or build-spec artifact for the plan screen preview panel. */
async function readPlanScreenArtifactMarkdown(path: string): Promise<string> {
  const trimmed = path.trim();
  if (!trimmed) return '';
  try {
    const result = await executeTool('read_file', { path: trimmed });
    return result.content;
  } catch {
    return '';
  }
}

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

/** True when persisted {@link Chat.superPlan} still has a resumable pipeline (not finished/cancelled). */
export function isSuperPlanPipelineResumable(chat: Chat): boolean {
  if (normalizeModeId(chat.modeId) !== 'super-plan') return false;
  const sp = chat.superPlan;
  if (!sp || sp.cancelled) return false;
  if (sp.activeStage === 'present') {
    const record = sp.stages.present;
    if (record?.status === 'done') return false;
  }
  return true;
}

function derivePlanScreenPhaseFromSuperPlan(chat: Chat): OrchestratePlanScreenPhase {
  const checkpoint = getSuperPlanCheckpointKind(chat);
  if (checkpoint === 'spec_confirm') return 'spec_confirm';
  if (checkpoint === 'present') return 'preview';
  const sp = chat.superPlan!;
  const record = sp.stages[sp.activeStage];
  if (record?.status === 'error') return 'error';
  if (
    sp.activeStage === 'grill' &&
    (record?.status === 'running' || isChatStreaming(chat.id))
  ) {
    return 'questions';
  }
  return 'super-plan-working';
}

function resolvePlanSessionArtifactPath(
  chat: Chat,
  phase: OrchestratePlanScreenPhase,
): string | undefined {
  const sp = chat.superPlan;
  if (!sp) return undefined;
  if (phase === 'spec_confirm') return sp.specPath?.trim() || undefined;
  if (phase === 'preview') {
    return sp.planPath?.trim() || findLastPlanSavePath(chat.history) || undefined;
  }
  return sp.planPath?.trim() || undefined;
}

/**
 * Rebuild the in-memory plan-screen session from persisted {@link Chat.superPlan}
 * after reload or when returning to Code without an active overlay session.
 */
export function restoreOrchestratePlanScreenSessionFromChat(chat: Chat): boolean {
  if (planSession?.chatId === chat.id) return true;
  if (!isSuperPlanPipelineResumable(chat)) return false;

  const sp = chat.superPlan!;
  const record = sp.stages[sp.activeStage];
  const phase = derivePlanScreenPhaseFromSuperPlan(chat);
  planSession = {
    chatId: chat.id,
    phase,
    planPath: resolvePlanSessionArtifactPath(chat, phase),
    savedPrompt: sp.prompt,
    planScreenSuspended: true,
    errorMessage:
      record?.status === 'error'
        ? record.error?.trim() ||
          'Super Plan stopped with an error. Open the chat to review.'
        : undefined,
  };
  ensureStreamEndListener();
  wireSuperPlanControllerListener(chat);
  return true;
}

/** Suspend overlay when leaving the plan chat via sidebar (keeps session). */
export function suspendOrchestratePlanScreenOnLeave(leavingChatId: string): void {
  if (!planSession || planSession.chatId !== leavingChatId) return;
  if (!isOrchestratePlanScreenMounted()) return;
  preservePlanScreenQuestionsPhase();
  planSession.planScreenSuspended = true;
  teardownOrchestratePlanScreenDom({ chatId: leavingChatId });
}

/** Suspend overlay when foregrounding another MinnowOS app (keep grill questions in composer). */
export function suspendOrchestratePlanScreenOnAppLeave(leavingChatId: string): void {
  if (!planSession || planSession.chatId !== leavingChatId) return;
  if (!isOrchestratePlanScreenMounted()) return;
  preservePlanScreenQuestionsPhase();
  planSession.planScreenSuspended = true;
  teardownOrchestratePlanScreenDom({
    keepQuestionsInComposer: true,
    chatId: leavingChatId,
  });
}

function preservePlanScreenQuestionsPhase(): void {
  if (!planSession) return;
  if (
    planSession.phase === 'questions' ||
    planSession.phase === 'super-plan-working' ||
    planSession.phase === 'working'
  ) {
    if (isAskQuestionModalOpenForChat(planSession.chatId)) {
      planSession.phase = 'questions';
    }
  }
}

function preparePlanScreenQuestionsBeforeTeardown(
  chatId: string,
  options: { keepQuestionsInComposer?: boolean } = {},
): void {
  if (!isAskQuestionModalOnPlanScreenHost()) {
    if (isAskQuestionModalOpenForChat(chatId)) {
      forceCloseAskQuestionModalForChat(chatId);
    }
    return;
  }
  if (options.keepQuestionsInComposer) {
    const composerHost = document.getElementById('questionHost');
    if (composerHost && migrateActiveQuestionModalToHost(composerHost)) {
      if (planSession) planSession.phase = 'questions';
      return;
    }
  }
  forceCloseAskQuestionModalForChat(chatId);
}

/** Remove overlay nodes only; session state is preserved. */
export function teardownOrchestratePlanScreenDom(
  options: { keepQuestionsInComposer?: boolean; chatId?: string } = {},
): void {
  if (typeof document === 'undefined') return;
  if (options.chatId) {
    preparePlanScreenQuestionsBeforeTeardown(options.chatId, options);
  }
  resetPlanScreenDomMounts();
  document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID)?.remove();
  document.getElementById('chatArea')?.classList.remove(CHAT_AREA_PLAN_SCREEN_CLASS);
  document
    .getElementById('mainColumn')
    ?.classList.remove(MAIN_COLUMN_PLAN_SCREEN_CLASS);
}

/** Remove overlay and clear plan-screen session. */
export function teardownOrchestratePlanScreen(): void {
  const chatId = planSession?.chatId;
  teardownOrchestratePlanScreenDom(chatId ? { chatId } : {});
  planSession = null;
}

export function resetOrchestratePlanScreenForTests(): void {
  planSession = null;
  if (streamEndUnsubscribe) {
    streamEndUnsubscribe();
    streamEndUnsubscribe = null;
  }
  superPlanUnsubscribe?.();
  superPlanUnsubscribe = null;
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
  return (
    session.phase === 'working' ||
    session.phase === 'super-plan-working' ||
    session.phase === 'questions'
  );
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
  if (session.phase !== 'working' && session.phase !== 'super-plan-working' && session.phase !== 'questions') {
    return null;
  }
  if (session.phase === 'working' || session.phase === 'super-plan-working') {
    session.phase = 'questions';
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

function resolvePlanScreenWorkingPhase(chat: Chat): 'working' | 'super-plan-working' {
  return normalizeModeId(chat.modeId) === 'super-plan' ? 'super-plan-working' : 'working';
}

function mountPlanProgressPanel(chat: Chat): void {
  const mount = document.getElementById(PLAN_PROGRESS_MOUNT_ID);
  if (!mount) return;

  const variant =
    normalizeModeId(chat.modeId) === 'super-plan' ? 'super-plan' : 'regular-plan';
  planProgressPanel?.destroy();
  planProgressPanel = new PlanProgressPanel(mount, {
    variant,
    reducedMotion: prefersReducedMotion(),
  });
  planProgressPanel.reset();

  if (variant === 'super-plan' && chat.superPlan) {
    planProgressPanel.applySuperPlanState(chat.superPlan);
  } else {
    const activity = getMainTurnActivity(chat.id);
    const step = regularPlanWorkingStepFromChat(
      chat,
      activity?.phase ?? null,
      activity?.currentTool,
    );
    planProgressPanel.applyRegularPlanStep(step);
  }
}

function syncPlanProgressFromChat(chat: Chat): void {
  if (!planProgressPanel) return;
  if (normalizeModeId(chat.modeId) === 'super-plan' && chat.superPlan) {
    planProgressPanel.applySuperPlanState(chat.superPlan);
    return;
  }
  const activity = getMainTurnActivity(chat.id);
  const step = regularPlanWorkingStepFromChat(
    chat,
    activity?.phase ?? null,
    activity?.currentTool,
  );
  planProgressPanel.applyRegularPlanStep(step);
}

function wirePlanScreenActivityListener(chatId: string): void {
  activityUnsubscribe?.();
  activityUnsubscribe = subscribeMainTurnActivity(() => {
    if (!isOrchestratePlanScreenMounted() || !planSession) return;
    if (planSession.chatId !== chatId) return;
    const chat = findChatById(chatId);
    if (!chat) return;
    syncPlanProgressFromChat(chat);
  });
}

function findReusableEmptyPlanChat(modeId: 'plan' | 'super-plan'): Chat | null {
  if (!sessionState) return null;
  const hit = sessionState.chats.find(
    (c) => normalizeModeId(c.modeId) === modeId && c.history.length === 0,
  );
  return hit ?? null;
}

function resolveOrCreatePlanChat(): Chat {
  const targetMode =
    normalizeModeId(getActiveChat().modeId) === 'super-plan' ? 'super-plan' : 'plan';
  const reusable = findReusableEmptyPlanChat(targetMode);
  if (reusable) {
    if (sessionState && sessionState.activeId !== reusable.id) {
      switchChat(reusable.id);
    }
    setChatMode(targetMode);
    return getActiveChat();
  }
  const created = createChatWithMode({ modeId: targetMode });
  if (created.ok && created.chatId && sessionState) {
    if (sessionState.activeId !== created.chatId) {
      switchChat(created.chatId);
    }
    return sessionState.chats.find((c) => c.id === created.chatId) ?? getActiveChat();
  }
  return getActiveChat();
}

async function syncPlanScreenFromSuperPlan(chat: Chat): Promise<void> {
  const session = planSession;
  if (!session || session.chatId !== chat.id) return;

  const checkpoint = getSuperPlanCheckpointKind(chat);
  if (checkpoint === 'spec_confirm') {
    const specPath =
      chat.superPlan?.specPath?.trim() ||
      chat.superPlan?.stages.spec_confirm?.artifactPath?.trim() ||
      '';
    const previewMarkdown = specPath ? await readPlanScreenArtifactMarkdown(specPath) : '';
    if (planSession) {
      planSession.phase = 'spec_confirm';
      planSession.planPath = specPath;
    }
    if (planSession?.planScreenSuspended && getActiveChat().id === chat.id) {
      renderChatFromHistory(chat);
      return;
    }
    renderOrchestratePlanScreen({
      phase: 'spec_confirm',
      chatId: chat.id,
      planPath: specPath,
      savedPrompt: session.savedPrompt,
      previewMarkdown,
    });
    return;
  }

  if (checkpoint === 'present') {
    const planPath =
      chat.superPlan?.planPath?.trim() ?? findLastPlanSavePath(chat.history) ?? '';
    let previewMarkdown = '';
    if (planPath) {
      try {
        const result = await executeTool('read_file', { path: planPath });
        previewMarkdown = result.content;
      } catch {
        previewMarkdown = '';
      }
    }
    if (planSession) {
      planSession.planPath = planPath;
      planSession.phase = 'preview';
    }
    if (planSession?.planScreenSuspended && getActiveChat().id === chat.id) {
      renderChatFromHistory(chat);
      return;
    }
    renderOrchestratePlanScreen({
      phase: 'preview',
      chatId: chat.id,
      planPath,
      savedPrompt: session.savedPrompt,
      previewMarkdown,
    });
    return;
  }

  const activeStage = chat.superPlan?.activeStage;
  const stageStatus = activeStage ? chat.superPlan?.stages[activeStage]?.status : undefined;
  if (stageStatus === 'error') {
    renderOrchestratePlanScreen({
      phase: 'error',
      chatId: chat.id,
      savedPrompt: session.savedPrompt,
      errorMessage:
        chat.superPlan?.stages[activeStage!]?.error ??
        'Super Plan stopped with an error. Open the chat to review.',
    });
    return;
  }

  if (planSession) {
    planSession.phase = 'super-plan-working';
  }
  syncPlanProgressFromChat(chat);
}

function wireSuperPlanControllerListener(chat: Chat): void {
  superPlanUnsubscribe?.();
  superPlanUnsubscribe = subscribeSuperPlanController((updated) => {
    if (updated.id !== chat.id) return;
    if (
      planSession &&
      planSession.chatId === updated.id &&
      updated.superPlan &&
      isOrchestratePlanScreenMounted() &&
      !planSession.planScreenSuspended
    ) {
      syncPlanProgressFromChat(updated);
    }
    void syncPlanScreenFromSuperPlan(updated);
  });
}

async function onPlanSessionStreamEnd(chatId: string): Promise<void> {
  const session = planSession;
  if (!session || session.chatId !== chatId) return;
  if (session.phase !== 'working' && session.phase !== 'super-plan-working' && session.phase !== 'questions') {
    return;
  }

  const chat = findChatById(chatId);
  if (!chat) return;

  if (normalizeModeId(chat.modeId) === 'super-plan' && chat.superPlan) {
    const { onSuperPlanStreamEnd } = await import('../chat/super-plan/controller');
    await onSuperPlanStreamEnd(chatId);
    const refreshed = findChatById(chatId);
    if (refreshed) await syncPlanScreenFromSuperPlan(refreshed);
    return;
  }

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

export interface StartPlanningFromPromptOptions {
  /** Keep the active chat (composer send) instead of reusing/creating an empty plan chat. */
  useActiveChat?: boolean;
}

/** Whether a composer send should open the plan screen and start the Super Plan pipeline. */
export function shouldRouteComposerSendToSuperPlan(
  chat: Chat,
  opts: {
    userText: string;
    skillId: string | null;
    attachmentCount: number;
  },
): boolean {
  if (normalizeModeId(chat.modeId) !== 'super-plan') return false;
  if (!opts.userText.trim()) return false;
  if (opts.skillId) return false;
  if (opts.attachmentCount > 0) return false;
  if (chat.superPlan && !chat.superPlan.cancelled) return false;
  if (isOrchestratePlanScreenOwningChat(chat.id)) return false;
  return true;
}

async function startPlanningFromPrompt(
  promptText: string,
  options?: StartPlanningFromPromptOptions,
): Promise<void> {
  teardownOrchestrateHub();
  const chat = options?.useActiveChat ? getActiveChat() : resolveOrCreatePlanChat();
  ensureStreamEndListener();

  planSession = {
    chatId: chat.id,
    phase: resolvePlanScreenWorkingPhase(chat),
    savedPrompt: promptText,
    planScreenSuspended: false,
  };

  renderOrchestratePlanScreen({
    phase: planSession.phase,
    chatId: chat.id,
    savedPrompt: promptText,
  });

  if (normalizeModeId(chat.modeId) === 'super-plan') {
    wireSuperPlanControllerListener(chat);
    await startSuperPlan(chat, promptText);
    return;
  }

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
  launchBoardFromPlan(planPath);
}

function suspendToViewChat(chat: Chat): void {
  if (!planSession) return;
  preservePlanScreenQuestionsPhase();
  planSession.planScreenSuspended = true;
  teardownOrchestratePlanScreenDom({
    keepQuestionsInComposer: true,
    chatId: chat.id,
  });
  if (sessionState && sessionState.activeId !== chat.id) {
    switchChat(chat.id);
  } else {
    renderChatFromHistory(chat);
  }
}

function buildPlanPreviewActionHandlers(
  opts: RenderOrchestratePlanScreenOptions,
  planPath: string,
): import('./plan-progress-screen').PlanPreviewActionHandlers {
  const chat = findChatById(opts.chatId);
  const isSuperPlan = normalizeModeId(chat?.modeId) === 'super-plan';

  return {
    onRevise: () => {
      if (!chat) return;
      if (isSuperPlan) {
        if (planSession) planSession.phase = 'super-plan-working';
        renderOrchestratePlanScreen({
          phase: 'super-plan-working',
          chatId: opts.chatId,
          savedPrompt: opts.savedPrompt,
        });
        void resumeSuperPlanAfterUser(chat, 'revise');
        return;
      }
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
    },
    onStartOrchestrator: () => {
      if (planPath) openBoardWithPlan(planPath);
    },
    onBuild: () => {
      if (!planPath) return;
      teardownOrchestratePlanScreen();
      createChatWithMode({
        modeId: 'build',
        orchestratePlanPath: planPath,
        initialUserMessage: `Implement the plan at ${planPath}.`,
      });
    },
    onClose: () => {
      teardownOrchestratePlanScreen();
    },
  };
}

function appendWorkingPhaseContent(
  inner: HTMLElement,
  opts: RenderOrchestratePlanScreenOptions,
  isSuperPlan: boolean,
): void {
  appendPlanScreenHeader(
    inner,
    isSuperPlan ? 'Super Plan' : 'Orchestrate',
    'Planning in progress',
    isSuperPlan
      ? 'The Super Plan pipeline runs through interview, spec, research, draft, review, and polish. Answer questions below or open the chat to inspect tool calls.'
      : 'Status updates here. Answer any questions below, or open the chat to inspect tool calls.',
  );

  const progressMount = document.createElement('div');
  progressMount.id = PLAN_PROGRESS_MOUNT_ID;
  progressMount.className = 'orchestrate-plan-screen__progress-mount';
  progressMount.setAttribute('role', 'status');
  progressMount.setAttribute('aria-live', 'polite');

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
  inner.append(progressMount, questionsHost, actions);

  const afterPaint =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: () => void) => {
          fn();
          return 0;
        };
  afterPaint(() => {
    const chat = findChatById(opts.chatId);
    if (chat) mountPlanProgressPanel(chat);
  });
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
  } else if (
    opts.phase === 'working' ||
    opts.phase === 'super-plan-working' ||
    opts.phase === 'questions'
  ) {
    const chat = findChatById(opts.chatId);
    const isSuperPlan =
      opts.phase === 'super-plan-working' ||
      normalizeModeId(chat?.modeId) === 'super-plan';
    appendWorkingPhaseContent(inner, opts, isSuperPlan);
  } else if (opts.phase === 'spec_confirm') {
    const specPath = opts.planPath?.trim() ?? '';
    appendPlanScreenHeader(
      inner,
      'Super Plan',
      'Confirm build spec',
      'Review the build specification below. Confirm to continue with research and drafting, or revise to regenerate the spec.',
    );

    if (specPath) {
      const pathChip = document.createElement('p');
      pathChip.className = 'orchestrate-plan-screen__path';
      pathChip.textContent = shortPlanLabel(specPath);
      pathChip.title = specPath;
      inner.appendChild(pathChip);
    }

    const previewWrap = document.createElement('div');
    previewWrap.className = 'orchestrate-plan-screen__preview-wrap';

    const previewMount = document.createElement('div');
    previewMount.className = 'orchestrate-plan-screen__preview';
    mountPlanPreviewContent(previewMount, opts.previewMarkdown ?? '', {
      modeId: 'super-plan',
      emptyLabel: '(build spec file is empty or could not be loaded)',
    });
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

    const reviseBtn = document.createElement('button');
    reviseBtn.type = 'button';
    reviseBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--ghost';
    reviseBtn.textContent = 'Revise spec';
    reviseBtn.addEventListener('click', () => {
      const chat = findChatById(opts.chatId);
      if (!chat) return;
      if (planSession) planSession.phase = 'super-plan-working';
      renderOrchestratePlanScreen({
        phase: 'super-plan-working',
        chatId: opts.chatId,
        savedPrompt: opts.savedPrompt,
      });
      void resumeSuperPlanAfterUser(chat, 'revise');
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'orchestrate-plan-screen__btn orchestrate-plan-screen__btn--primary';
    confirmBtn.textContent = 'Confirm spec';
    confirmBtn.addEventListener('click', () => {
      const chat = findChatById(opts.chatId);
      if (!chat) return;
      if (planSession) planSession.phase = 'super-plan-working';
      renderOrchestratePlanScreen({
        phase: 'super-plan-working',
        chatId: opts.chatId,
        savedPrompt: opts.savedPrompt,
      });
      void resumeSuperPlanAfterUser(chat, 'confirm');
    });

    actionsStart.append(viewChatBtn, reviseBtn);
    actions.append(actionsStart, confirmBtn);
    inner.append(previewWrap, actions);
  } else if (opts.phase === 'preview') {
    const planPath = opts.planPath?.trim() ?? '';
    const chat = findChatById(opts.chatId);
    const isSuperPlan = normalizeModeId(chat?.modeId) === 'super-plan';
    appendPlanScreenHeader(
      inner,
      isSuperPlan ? 'Super Plan' : 'Orchestrate',
      'Plan ready',
      'Review the draft below, then choose how to continue.',
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
    mountPlanPreviewContent(previewMount, opts.previewMarkdown ?? '', {
      modeId: isSuperPlan ? 'super-plan' : 'plan',
    });
    previewWrap.appendChild(previewMount);

    const popout = buildPlanPreviewPopoutDom(
      buildPlanPreviewActionHandlers(opts, planPath),
      {
        orchestrateEnabled: Boolean(planPath && isExecutableOrchestratePlan(planPath)),
      },
    );

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

    actionsStart.appendChild(viewChatBtn);
    actions.append(actionsStart);
    inner.append(previewWrap, popout, actions);
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

/** Drop progress/activity mounts before rebuilding the plan screen DOM. */
function resetPlanScreenDomMounts(): void {
  activityUnsubscribe?.();
  activityUnsubscribe = null;
  planProgressPanel?.destroy();
  planProgressPanel = null;
}

/** Paint plan screen into #chatArea for the given phase. */
export function renderOrchestratePlanScreen(
  opts: RenderOrchestratePlanScreenOptions,
): void {
  teardownHub();
  const prior = planSession;
  resetPlanScreenDomMounts();

  planSession = {
    chatId: opts.chatId,
    phase: opts.phase,
    planPath: opts.planPath,
    savedPrompt: opts.savedPrompt ?? prior?.savedPrompt,
    planScreenSuspended: opts.planScreenSuspended ?? false,
    errorMessage: opts.errorMessage,
  };

  const area = document.getElementById('chatArea');
  if (!area) return;
  if (
    opts.phase !== 'working' &&
    opts.phase !== 'super-plan-working' &&
    opts.phase !== 'questions'
  ) {
    planProgressPanel?.destroy();
    planProgressPanel = null;
  }
  area.replaceChildren();
  area.appendChild(buildPlanScreenDom(opts));
  area.classList.add(CHAT_AREA_PLAN_SCREEN_CLASS);
  document.getElementById('mainColumn')?.classList.add(MAIN_COLUMN_PLAN_SCREEN_CLASS);
  document.getElementById('mainColumn')?.classList.remove('main-column--board-view');

  const chat = findChatById(opts.chatId);
  const isSuperPlan = chat && normalizeModeId(chat.modeId) === 'super-plan';
  const wiresSuperPlanListener =
    isSuperPlan &&
    (opts.phase === 'working' ||
      opts.phase === 'super-plan-working' ||
      opts.phase === 'questions' ||
      opts.phase === 'spec_confirm' ||
      opts.phase === 'preview');
  if (
    opts.phase === 'working' ||
    opts.phase === 'super-plan-working' ||
    opts.phase === 'questions'
  ) {
    wirePlanScreenActivityListener(opts.chatId);
  }
  if (wiresSuperPlanListener && chat) {
    wireSuperPlanControllerListener(chat);
  }
}

/**
 * Start Super Plan (or regular Plan) from the chat composer — mounts the plan screen
 * and runs {@link startSuperPlan} / {@link runChatTurn} on the active chat.
 */
export async function startPlanningFromComposer(promptText: string): Promise<void> {
  const text = promptText.trim();
  if (!text) return;
  await startPlanningFromPrompt(text, { useActiveChat: true });
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
  } else if (session?.phase === 'spec_confirm') {
    text.textContent =
      'Build spec ready for review. Return to the planning screen to confirm or revise.';
  } else if (session?.phase === 'error') {
    text.textContent =
      'Planning ended without a saved plan. Return to the planning screen or review the chat.';
  } else if (session?.phase === 'questions') {
    text.textContent =
      'Answer the grill questions below or return to the planning screen to continue the interview.';
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
    void (async () => {
      if (!planSession || planSession.chatId !== chat.id) return;
      const session = planSession;
      let previewMarkdown: string | undefined;
      if (
        (session.phase === 'preview' || session.phase === 'spec_confirm') &&
        session.planPath
      ) {
        previewMarkdown = await readPlanScreenArtifactMarkdown(session.planPath);
      }
      session.planScreenSuspended = false;
      renderOrchestratePlanScreen({
        phase: session.phase,
        chatId: session.chatId,
        planPath: session.planPath,
        savedPrompt: session.savedPrompt,
        errorMessage: session.errorMessage,
        previewMarkdown,
      });
      const afterPaint =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (fn: () => void) => {
              fn();
              return 0;
            };
      afterPaint(() => {
        if (isAskQuestionModalOpenForChat(session.chatId)) {
          const planHost = document.getElementById(ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID);
          if (planHost) {
            migrateActiveQuestionModalToHost(planHost);
            planHost.hidden = false;
          }
        }
      });
    })();
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
