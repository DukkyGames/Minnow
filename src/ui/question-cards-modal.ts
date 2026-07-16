/**
 * Bottom strip UI for the `ask_question` tool: one question per card, carousel, Other row, submit on last card only.
 */

import { getChatAbort } from '../app-state';
import { isAskQuestionDomVisible, registerAskQuestionDisplayContextSync } from '../chat/ask-question-display';
import { isActiveChatStreaming } from '../chat/streaming-state';
import { notifyAskQuestionShown } from '../notifications/ask-question';
import { getActiveChat } from '../state/sessions';
import {
  ASK_QUESTION_OTHER_ID,
  stringifyAskQuestionResult,
  type AskQuestionArgs,
  type AskQuestionItem,
  type AskQuestionToolResult,
} from '../tools/ask-question-types';
import {
  areAllDraftsValid,
  buildAnswerEntries,
  type AskQuestionAnswerDraft,
} from './question-cards-state';
import { getActiveComposerSurface } from './composer-surface';
import { setComposerStreamingMode } from './composer-send';
import { setSidebarInputPendingChatId } from './chat-item-dot';
import { resolveOrchestratePlanScreenQuestionHost } from './orchestrate-plan-screen';
import { resolvePromptComposerShell, resolveQuestionHost } from './prompt-host-resolve';
import {
  acquireUserPromptLock,
  isUserPromptLocked,
  releaseUserPromptLock,
} from './user-prompt-lock';

export interface QuestionCardsModalContext {
  subAgentType?: string;
}

export interface QuestionCardsModalOptions {
  /** When set, render inside this element instead of #questionHost. */
  host?: HTMLElement;
  /** Skip global composer lock and main-column pending class (plan screen embed). */
  embedded?: boolean;
  /** Plan-screen / tool-loop chat id (resolves embedded host when host omitted). */
  chatId?: string;
}

/** Invoked from stop-generation to close the strip without waiting for user input. */
let requestQuestionCardsCancel: (() => void) | null = null;

type ActiveQuestionModalState = {
  host: HTMLElement;
  chatId: string;
  embedded: boolean;
  parked: boolean;
  composerShell: HTMLElement | null;
  msgInput: HTMLTextAreaElement | null;
  sendBtn: HTMLButtonElement | null;
  prevInputDisabled: boolean;
  prevSendDisabled: boolean;
};

let activeQuestionModal: ActiveQuestionModalState | null = null;

const PLAN_SCREEN_QUESTIONS_HOST_ID = 'orchestratePlanScreenQuestions';

export function isAskQuestionModalOpenForChat(chatId: string): boolean {
  return Boolean(
    requestQuestionCardsCancel &&
      activeQuestionModal &&
      activeQuestionModal.chatId === chatId,
  );
}

/** True when the open strip is embedded in the Super Plan / plan screen host. */
export function isAskQuestionModalOnPlanScreenHost(): boolean {
  return Boolean(
    activeQuestionModal?.embedded &&
      activeQuestionModal.host.id === PLAN_SCREEN_QUESTIONS_HOST_ID,
  );
}

function activateComposerQuestionChrome(state: ActiveQuestionModalState): void {
  state.embedded = false;
  state.parked = false;
  acquireUserPromptLock();
  state.composerShell?.classList.add('main-column--question-pending');
  setSidebarInputPendingChatId(state.chatId);
  const panel = state.host.querySelector('.question-cards-panel');
  panel?.classList.remove('question-cards-panel--embedded');
  const surfaceClass = resolveQuestionPanelSurfaceClass(state.host);
  if (surfaceClass) {
    panel?.classList.add(surfaceClass);
  }
  state.host.hidden = false;
}

function restoreComposerAfterQuestion(state: ActiveQuestionModalState): void {
  state.composerShell?.classList.remove('main-column--question-pending');
  state.host.hidden = true;
  releaseUserPromptLock();
  if (!isUserPromptLocked()) {
    if (state.msgInput) {
      state.msgInput.disabled = isActiveChatStreaming()
        ? false
        : state.prevInputDisabled;
    }
    if (state.sendBtn) {
      if (isActiveChatStreaming()) {
        setComposerStreamingMode('streaming');
      } else {
        state.sendBtn.disabled = state.prevSendDisabled;
      }
    }
    state.msgInput?.focus();
  }
}

function deactivateComposerQuestionChrome(state: ActiveQuestionModalState): void {
  restoreComposerAfterQuestion(state);
  setSidebarInputPendingChatId(null);
}

function activateEmbeddedQuestionChrome(state: ActiveQuestionModalState): void {
  state.embedded = true;
  state.parked = false;
  state.composerShell?.classList.remove('main-column--question-pending');
  setSidebarInputPendingChatId(state.chatId);
  releaseUserPromptLock();
  const panel = state.host.querySelector('.question-cards-panel');
  panel?.classList.add('question-cards-panel--embedded');
  panel?.classList.remove(
    'question-cards-panel--os-dock',
    'question-cards-panel--chat-app',
  );
  state.host.hidden = false;
}

function parkActiveQuestionModal(): void {
  const state = activeQuestionModal;
  if (!state || state.parked || !requestQuestionCardsCancel) return;
  state.parked = true;
  state.host.hidden = true;
  if (!state.embedded) {
    restoreComposerAfterQuestion(state);
  }
  setSidebarInputPendingChatId(state.chatId);
}

function unparkActiveQuestionModal(): void {
  const state = activeQuestionModal;
  if (!state || !state.parked || !requestQuestionCardsCancel) return;
  if (!isAskQuestionDomVisible(state.chatId)) return;

  const planHost = resolveOrchestratePlanScreenQuestionHost(state.chatId);
  if (planHost) {
    migrateActiveQuestionModalToHost(planHost);
    activateEmbeddedQuestionChrome(state);
    return;
  }

  const host = resolveQuestionHost();
  if (!host) return;
  migrateActiveQuestionModalToHost(host);
  state.composerShell = resolvePromptComposerShell();
  const surface = getActiveComposerSurface();
  state.msgInput = surface.inputEl;
  state.sendBtn = surface.sendBtnEl;
  activateComposerQuestionChrome(state);
}

/** Hide the strip when leaving the owning chat; restore when returning. */
export function syncAskQuestionModalOnChatSwitch(
  fromChatId: string | null | undefined,
  toChatId: string,
): void {
  const state = activeQuestionModal;
  if (!state || !requestQuestionCardsCancel) return;

  if (fromChatId && state.chatId === fromChatId && toChatId !== fromChatId && !state.parked) {
    parkActiveQuestionModal();
    return;
  }

  if (state.chatId === toChatId && state.parked) {
    unparkActiveQuestionModal();
  }
}

/** Park or restore the strip when the foreground app changes. */
export function syncAskQuestionModalOnDisplayContextChange(): void {
  const state = activeQuestionModal;
  if (!state || !requestQuestionCardsCancel) return;

  if (isAskQuestionDomVisible(state.chatId)) {
    if (state.parked) unparkActiveQuestionModal();
    return;
  }

  if (!state.parked) parkActiveQuestionModal();
}

/**
 * Move the active question strip to another host (plan screen ↔ composer)
 * without cancelling the pending tool call.
 */
export function migrateActiveQuestionModalToHost(newHost: HTMLElement): boolean {
  if (!activeQuestionModal || !requestQuestionCardsCancel) return false;
  const state = activeQuestionModal;
  if (state.host === newHost) return true;

  const panel = state.host.querySelector('.question-cards-panel');
  if (!panel) return false;

  newHost.replaceChildren();
  newHost.appendChild(panel);
  newHost.hidden = false;
  state.host.replaceChildren();

  const prevHost = state.host;
  state.host = newHost;

  if (state.embedded && newHost.id !== PLAN_SCREEN_QUESTIONS_HOST_ID) {
    activateComposerQuestionChrome(state);
  } else if (!state.embedded && newHost.id === PLAN_SCREEN_QUESTIONS_HOST_ID) {
    activateEmbeddedQuestionChrome(state);
  }

  if (prevHost.id === PLAN_SCREEN_QUESTIONS_HOST_ID) {
    prevHost.hidden = true;
  }

  return true;
}

export function forceCloseAskQuestionModalForChat(chatId?: string): void {
  if (!requestQuestionCardsCancel) return;
  if (chatId?.trim() && activeQuestionModal?.chatId !== chatId.trim()) return;
  forceCloseAskQuestionModal();
}

export function forceCloseAskQuestionModal(): void {
  const chatId = activeQuestionModal?.chatId;
  requestQuestionCardsCancel?.();
  requestQuestionCardsCancel = null;
  if (chatId) {
    setSidebarInputPendingChatId(null);
  }
}

export function resetQuestionCardsModalForTests(): void {
  forceCloseAskQuestionModal();
  activeQuestionModal = null;
}

function getQuestionHost(): HTMLElement | null {
  return resolveQuestionHost();
}

function getQuestionComposerShell(): HTMLElement | null {
  return resolvePromptComposerShell();
}

/** Surface-specific panel class for dock / chat-app / code bench styling. */
function resolveQuestionPanelSurfaceClass(host: HTMLElement): string {
  if (host.id === 'desktopQuestionHost' || host.closest('.mn-os-composer-dock')) {
    return 'question-cards-panel--os-dock';
  }
  if (host.id === 'chatAppQuestionHost' || host.closest('.chat-app-composer')) {
    return 'question-cards-panel--chat-app';
  }
  return '';
}

function getOrCreateDraft(
  drafts: Map<string, AskQuestionAnswerDraft>,
  questionId: string,
): AskQuestionAnswerDraft {
  let d = drafts.get(questionId);
  if (!d) {
    d = { selectedIds: [], otherText: '' };
    drafts.set(questionId, d);
  }
  return d;
}

/**
 * Shows the question strip and resolves with structured JSON (answered or cancelled).
 */
export function showQuestionCardsModal(
  args: AskQuestionArgs,
  context: QuestionCardsModalContext = {},
  options: QuestionCardsModalOptions = {},
): Promise<AskQuestionToolResult> {
  return new Promise((resolve) => {
    let embedded = options.embedded === true;
    let host = options.host;
    if (!host && options.chatId) {
      const planHost = resolveOrchestratePlanScreenQuestionHost(options.chatId);
      if (planHost) {
        host = planHost;
        embedded = true;
      }
    }
    if (!host) {
      host = getQuestionHost();
    }
    if (!host) {
      resolve({ status: 'cancelled', answers: [] });
      return;
    }

    const composerShell = getQuestionComposerShell();
    const { inputEl: msgInput, sendBtnEl: sendBtn } = getActiveComposerSurface();
    const prevInputDisabled = msgInput?.disabled ?? false;
    const prevSendDisabled = sendBtn?.disabled ?? false;
    const chatIdForAbort = options.chatId?.trim() || getActiveChat().id;
    if (!embedded) {
      acquireUserPromptLock();
      composerShell?.classList.add('main-column--question-pending');
      setSidebarInputPendingChatId(chatIdForAbort);
    } else {
      setSidebarInputPendingChatId(chatIdForAbort);
    }
    if (!embedded) {
      host.hidden = false;
    }
    host.replaceChildren();

    activeQuestionModal = {
      host,
      chatId: chatIdForAbort,
      embedded,
      parked: false,
      composerShell,
      msgInput,
      sendBtn,
      prevInputDisabled,
      prevSendDisabled,
    };

    const drafts = new Map<string, AskQuestionAnswerDraft>();
    let cardIndex = 0;
    const questions = args.questions;

    const surfaceClass = resolveQuestionPanelSurfaceClass(host);
    const panelClasses = ['question-cards-panel'];
    if (embedded) panelClasses.push('question-cards-panel--embedded');
    if (surfaceClass) panelClasses.push(surfaceClass);

    const panel = document.createElement('div');
    panel.className = panelClasses.join(' ');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Assistant questions');

    const header = document.createElement('div');
    header.className = 'question-cards-panel__header';

    const headerMain = document.createElement('div');
    headerMain.className = 'question-cards-panel__header-main';

    if (args.title) {
      const eyebrow = document.createElement('p');
      eyebrow.className = 'question-cards-panel__eyebrow';
      eyebrow.textContent = args.title;
      headerMain.appendChild(eyebrow);
    }

    const headerActions = document.createElement('div');
    headerActions.className = 'question-cards-panel__header-actions';

    const nav = document.createElement('div');
    nav.className = 'question-cards-nav';
    nav.hidden = questions.length <= 1;
    const btnPrev = document.createElement('button');
    btnPrev.type = 'button';
    btnPrev.className = 'question-cards-nav-btn';
    btnPrev.setAttribute('aria-label', 'Previous question');
    btnPrev.innerHTML =
      '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
    const indicator = document.createElement('span');
    indicator.className = 'question-cards-nav-indicator';
    const btnNext = document.createElement('button');
    btnNext.type = 'button';
    btnNext.className = 'question-cards-nav-btn';
    btnNext.setAttribute('aria-label', 'Next question');
    btnNext.innerHTML =
      '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
    nav.append(btnPrev, indicator, btnNext);
    headerActions.appendChild(nav);

    if (context.subAgentType) {
      const badge = document.createElement('span');
      badge.className = 'question-cards-badge';
      badge.textContent = `Sub-agent · ${context.subAgentType}`;
      headerActions.appendChild(badge);
    }

    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'question-cards-icon-btn';
    btnClose.setAttribute('aria-label', 'Close and cancel questions');
    btnClose.innerHTML =
      '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    headerActions.appendChild(btnClose);

    header.append(headerMain, headerActions);

    const cardBody = document.createElement('div');
    cardBody.className = 'question-cards-panel__body';

    const footer = document.createElement('div');
    footer.className = 'question-cards-panel__footer';

    const btnSubmit = document.createElement('button');
    btnSubmit.type = 'button';
    btnSubmit.className = 'question-cards-submit';
    btnSubmit.textContent = 'Submit answers';

    const validation = document.createElement('p');
    validation.className = 'question-cards-validation';
    validation.setAttribute('role', 'status');
    validation.setAttribute('aria-live', 'polite');
    validation.hidden = true;

    const hints = document.createElement('p');
    hints.className = 'question-cards-hints';
    hints.textContent = 'Esc to cancel · Arrow keys to change card';

    footer.append(validation, btnSubmit, hints);
    panel.append(header, cardBody, footer);
    host.appendChild(panel);

    let settled = false;
    const finish = (result: AskQuestionToolResult): void => {
      if (settled) return;
      settled = true;
      requestQuestionCardsCancel = null;
      document.removeEventListener('keydown', onDocKeyDown, true);
      if (abortListener) {
        getChatAbort(chatIdForAbort)?.signal.removeEventListener('abort', abortListener);
      }
      const modal = activeQuestionModal;
      if (modal && !modal.embedded) {
        deactivateComposerQuestionChrome(modal);
      }
      (modal?.host ?? host).replaceChildren();
      activeQuestionModal = null;
      resolve(result);
    };

    requestQuestionCardsCancel = () => finish({ status: 'cancelled', answers: [] });

    if (!isAskQuestionDomVisible(chatIdForAbort)) {
      parkActiveQuestionModal();
    }

    const abortListener = (): void => {
      finish({ status: 'cancelled', answers: [] });
    };
    const abortSignal = getChatAbort(chatIdForAbort)?.signal;
    if (abortSignal && !abortSignal.aborted) {
      abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    function tryAutoSubmitAfterSingleSelect(): void {
      if (questions.length !== 1) return;
      const only = questions[0];
      if (only.allow_multiple === true) return;
      if (!areAllDraftsValid(questions, drafts)) return;
      finish({ status: 'answered', answers: buildAnswerEntries(questions, drafts) });
    }

    function syncNav(): void {
      const last = questions.length - 1;
      btnPrev.disabled = cardIndex <= 0;
      btnNext.disabled = cardIndex >= last;
      indicator.textContent = `${cardIndex + 1} / ${questions.length}`;
      const onLast = cardIndex === last;
      const allValid = areAllDraftsValid(questions, drafts);
      btnSubmit.hidden = !onLast;
      btnSubmit.disabled = !allValid;
      if (onLast && !allValid) {
        validation.textContent = 'Answer every question to continue.';
        validation.hidden = false;
      } else {
        validation.textContent = '';
        validation.hidden = true;
      }
    }

    function renderQuestion(q: AskQuestionItem): void {
      cardBody.replaceChildren();

      const promptEl = document.createElement('h2');
      promptEl.className = 'question-cards-prompt';
      promptEl.textContent = q.prompt;
      cardBody.appendChild(promptEl);

      const list = document.createElement('div');
      list.className = 'question-cards-options';
      // +1 for the synthetic Other row; drives grid layout for short option sets.
      list.dataset.optionCount = String(q.options.length + 1);
      list.setAttribute('role', q.allow_multiple ? 'group' : 'radiogroup');
      list.setAttribute(
        'aria-label',
        q.allow_multiple ? 'Select one or more answers' : 'Select one answer',
      );

      const draft = getOrCreateDraft(drafts, q.id);
      const groupName = `ask-q-${q.id}`;

      for (const opt of q.options) {
        const row = document.createElement('label');
        row.className = 'question-cards-option';
        const selected = draft.selectedIds.includes(opt.id);
        if (selected) row.classList.add('question-cards-option--selected');

        const input = document.createElement('input');
        if (q.allow_multiple) {
          input.type = 'checkbox';
          input.checked = selected;
          input.addEventListener('change', () => {
            const d = getOrCreateDraft(drafts, q.id);
            if (input.checked) {
              d.selectedIds = d.selectedIds.filter((id) => id !== ASK_QUESTION_OTHER_ID);
              if (!d.selectedIds.includes(opt.id)) d.selectedIds.push(opt.id);
            } else {
              d.selectedIds = d.selectedIds.filter((id) => id !== opt.id);
            }
            renderQuestion(q);
            syncNav();
          });
        } else {
          input.type = 'radio';
          input.name = groupName;
          input.value = opt.id;
          input.checked = selected && !draft.selectedIds.includes(ASK_QUESTION_OTHER_ID);
          input.addEventListener('change', () => {
            const d = getOrCreateDraft(drafts, q.id);
            d.selectedIds = [opt.id];
            d.otherText = '';
            renderQuestion(q);
            syncNav();
            tryAutoSubmitAfterSingleSelect();
          });
        }

        const textWrap = document.createElement('span');
        textWrap.className = 'question-cards-option-text';
        const title = document.createElement('span');
        title.className = 'question-cards-option-label';
        title.textContent = opt.label;
        textWrap.appendChild(title);
        if (opt.description) {
          const desc = document.createElement('span');
          desc.className = 'question-cards-option-desc';
          desc.textContent = opt.description;
          textWrap.appendChild(desc);
        }
        row.append(input, textWrap);
        list.appendChild(row);
      }

      const otherRow = document.createElement('label');
      otherRow.className = 'question-cards-option question-cards-option--other';
      const otherSelected = draft.selectedIds.includes(ASK_QUESTION_OTHER_ID);
      if (otherSelected) otherRow.classList.add('question-cards-option--selected');

      const otherInput = document.createElement('input');
      if (q.allow_multiple) {
        otherInput.type = 'checkbox';
        otherInput.checked = otherSelected;
        otherInput.addEventListener('change', () => {
          const d = getOrCreateDraft(drafts, q.id);
          if (otherInput.checked) {
            d.selectedIds = [ASK_QUESTION_OTHER_ID];
          } else {
            d.selectedIds = [];
            d.otherText = '';
          }
          renderQuestion(q);
          syncNav();
        });
      } else {
        otherInput.type = 'radio';
        otherInput.name = groupName;
        otherInput.value = ASK_QUESTION_OTHER_ID;
        otherInput.checked = otherSelected;
        otherInput.addEventListener('change', () => {
          const d = getOrCreateDraft(drafts, q.id);
          d.selectedIds = [ASK_QUESTION_OTHER_ID];
          renderQuestion(q);
          syncNav();
        });
      }

      const otherTextWrap = document.createElement('span');
      otherTextWrap.className = 'question-cards-option-text';
      const otherLabel = document.createElement('span');
      otherLabel.className = 'question-cards-option-label';
      otherLabel.textContent = 'Other';
      otherTextWrap.appendChild(otherLabel);

      otherRow.append(otherInput, otherTextWrap);
      list.appendChild(otherRow);

      const otherFieldWrap = document.createElement('div');
      otherFieldWrap.className = 'question-cards-other-field';
      otherFieldWrap.hidden = !otherSelected;
      const ta = document.createElement('textarea');
      ta.className = 'question-cards-other-input';
      ta.rows = 2;
      ta.placeholder = 'Please specify…';
      ta.value = draft.otherText;
      ta.addEventListener('input', () => {
        getOrCreateDraft(drafts, q.id).otherText = ta.value;
        syncNav();
      });
      otherFieldWrap.appendChild(ta);
      cardBody.appendChild(list);
      cardBody.appendChild(otherFieldWrap);

      if (otherSelected) {
        requestAnimationFrame(() => ta.focus());
      }
    }

    function showCard(): void {
      renderQuestion(questions[cardIndex]);
      syncNav();
    }

    btnPrev.addEventListener('click', () => {
      if (cardIndex > 0) {
        cardIndex -= 1;
        showCard();
      }
    });
    btnNext.addEventListener('click', () => {
      if (cardIndex < questions.length - 1) {
        cardIndex += 1;
        showCard();
      }
    });

    btnSubmit.addEventListener('click', () => {
      if (!areAllDraftsValid(questions, drafts)) return;
      const answers = buildAnswerEntries(questions, drafts);
      finish({ status: 'answered', answers });
    });

    btnClose.addEventListener('click', () => finish({ status: 'cancelled', answers: [] }));

    const onDocKeyDown = (ev: KeyboardEvent): void => {
      if (host.hidden) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish({ status: 'cancelled', answers: [] });
        return;
      }
      if (ev.key === 'ArrowLeft' && !isTypingInModal(panel, document.activeElement)) {
        ev.preventDefault();
        btnPrev.click();
        return;
      }
      if (ev.key === 'ArrowRight' && !isTypingInModal(panel, document.activeElement)) {
        ev.preventDefault();
        btnNext.click();
        return;
      }
    };

    document.addEventListener('keydown', onDocKeyDown, true);
    showCard();

    notifyAskQuestionShown(chatIdForAbort, args);

    requestAnimationFrame(() => {
      host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      btnPrev.focus();
    });
  });
}

function isTypingInModal(panel: HTMLElement, el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (!panel.contains(el)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return !(el as HTMLTextAreaElement).readOnly;
  if (tag === 'INPUT') {
    const inp = el as HTMLInputElement;
    const t = inp.type;
    if (t === 'text' || t === 'search' || t === 'url' || t === 'email') return !inp.readOnly;
  }
  return false;
}

/** Runs the UI and returns JSON string for tool content. */
export async function runAskQuestionModal(
  args: AskQuestionArgs,
  context: QuestionCardsModalContext,
): Promise<string> {
  const result = await showQuestionCardsModal(args, context);
  return stringifyAskQuestionResult(result);
}

// Defer until after module init — ask-question-display ↔ orchestrate-plan-screen cycle.
queueMicrotask(() => {
  registerAskQuestionDisplayContextSync(syncAskQuestionModalOnDisplayContextChange);
});
