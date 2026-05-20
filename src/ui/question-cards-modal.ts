/**
 * Bottom strip UI for the `ask_question` tool: one question per card, carousel, Other row, submit on last card only.
 */

import { chatFetchAbort, streaming } from '../app-state';
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
import { setComposerStreamingMode } from './composer-send';

export interface QuestionCardsModalContext {
  subAgentType?: string;
}

/** Invoked from stop-generation to close the strip without waiting for user input. */
let requestQuestionCardsCancel: (() => void) | null = null;

export function forceCloseAskQuestionModal(): void {
  requestQuestionCardsCancel?.();
  requestQuestionCardsCancel = null;
}

function getQuestionHost(): HTMLElement | null {
  return document.getElementById('questionHost');
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
): Promise<AskQuestionToolResult> {
  return new Promise((resolve) => {
    const host = getQuestionHost();
    if (!host) {
      resolve({ status: 'cancelled', answers: [] });
      return;
    }

    const mainColumn = document.getElementById('mainColumn');
    const msgInput = document.getElementById('msgInput') as HTMLTextAreaElement | null;
    const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;
    const prevInputDisabled = msgInput?.disabled ?? false;
    const prevSendDisabled = sendBtn?.disabled ?? false;
    if (msgInput) msgInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    mainColumn?.classList.add('main-column--question-pending');
    host.hidden = false;
    host.replaceChildren();

    const drafts = new Map<string, AskQuestionAnswerDraft>();
    let cardIndex = 0;
    const questions = args.questions;

    const panel = document.createElement('div');
    panel.className = 'question-cards-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Assistant questions');

    const header = document.createElement('div');
    header.className = 'question-cards-panel__header';

    const titleRow = document.createElement('div');
    titleRow.className = 'question-cards-panel__title-row';

    if (args.title) {
      const cat = document.createElement('p');
      cat.className = 'question-cards-panel__category';
      cat.textContent = args.title;
      titleRow.appendChild(cat);
    }

    const headerRight = document.createElement('div');
    headerRight.className = 'question-cards-panel__header-right';

    if (context.subAgentType) {
      const badge = document.createElement('span');
      badge.className = 'question-cards-badge';
      badge.textContent = `Sub-agent · ${context.subAgentType}`;
      headerRight.appendChild(badge);
    }

    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'question-cards-icon-btn';
    btnClose.setAttribute('aria-label', 'Close and cancel questions');
    btnClose.textContent = '×';
    headerRight.appendChild(btnClose);

    titleRow.appendChild(headerRight);
    header.appendChild(titleRow);

    const nav = document.createElement('div');
    nav.className = 'question-cards-nav';
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

    const cardBody = document.createElement('div');
    cardBody.className = 'question-cards-panel__body';

    const footer = document.createElement('div');
    footer.className = 'question-cards-panel__footer';

    const btnSubmit = document.createElement('button');
    btnSubmit.type = 'button';
    btnSubmit.className = 'question-cards-submit';
    btnSubmit.textContent = 'Submit answers';

    const hints = document.createElement('p');
    hints.className = 'question-cards-hints';
    hints.textContent = 'Esc to cancel · Arrow keys to change card';

    footer.append(btnSubmit, hints);
    panel.append(header, nav, cardBody, footer);
    host.appendChild(panel);

    let settled = false;
    const finish = (result: AskQuestionToolResult): void => {
      if (settled) return;
      settled = true;
      requestQuestionCardsCancel = null;
      document.removeEventListener('keydown', onDocKeyDown, true);
      if (abortListener) {
        chatFetchAbort?.signal.removeEventListener('abort', abortListener);
      }
      mainColumn?.classList.remove('main-column--question-pending');
      host.replaceChildren();
      host.hidden = true;
      if (msgInput) {
        msgInput.disabled = streaming ? false : prevInputDisabled;
      }
      if (sendBtn) {
        if (streaming) {
          setComposerStreamingMode('streaming');
        } else {
          sendBtn.disabled = prevSendDisabled;
        }
      }
      msgInput?.focus();
      resolve(result);
    };

    requestQuestionCardsCancel = () => finish({ status: 'cancelled', answers: [] });

    const abortListener = (): void => {
      finish({ status: 'cancelled', answers: [] });
    };
    if (chatFetchAbort?.signal) {
      chatFetchAbort.signal.addEventListener('abort', abortListener, { once: true });
    }

    function syncNav(): void {
      const last = questions.length - 1;
      btnPrev.disabled = cardIndex <= 0;
      btnNext.disabled = cardIndex >= last;
      indicator.textContent = `${cardIndex + 1} / ${questions.length}`;
      const onLast = cardIndex === last;
      btnSubmit.hidden = !onLast;
      btnSubmit.disabled = !areAllDraftsValid(questions, drafts);
    }

    function renderQuestion(q: AskQuestionItem): void {
      cardBody.replaceChildren();

      const promptEl = document.createElement('p');
      promptEl.className = 'question-cards-prompt';
      promptEl.textContent = q.prompt;
      cardBody.appendChild(promptEl);

      const list = document.createElement('div');
      list.className = 'question-cards-options';
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
