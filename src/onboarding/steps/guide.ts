/**
 * S10 — "Meet Minnow": a real chat session embedded in the wizard.
 * The model runs in the dedicated `onboarding` mode: it introduces Minnow,
 * asks about the user, demos tools live, and files what it learns into Brain
 * via visible save_memory / brain_write_page calls. The session is a normal
 * chat — it stays in the sidebar after setup so the user can pick it up later.
 *
 * The real chat pipeline is reused wholesale: chat-mount.ts routes the active
 * transcript to #onboardingChatCol and composer-surface.ts routes the composer
 * to #onboardingChatInput while this step's DOM exists.
 */

import { fetchModels } from '../../api/models';
import {
  activateChatById,
  createAndActivateChat,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from '../../state/sessions';
import type { Chat } from '../../types';
import { runChatTurn } from '../../tools/loop';
import {
  handleComposerPrimaryAction,
  initComposerSteerInputListener,
} from '../../ui/composer-send';
import { renderChatFromHistory } from '../../ui/messages';
import { el, renderStepHeader } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep } from '../types';
import {
  ONBOARDING_GUIDE_QUESTIONS_ID,
  registerOnboardingGuideChatId,
} from '../guide-questions';
import { recordStepProgress } from '../state-core';

const GUIDE_CHAT_NAME = 'Welcome to Minnow';

/**
 * Trigger for the model's opening message. Not echoed as a bubble during
 * onboarding, but the row stays in history (the chat lives on in the sidebar),
 * so it is phrased as a plausible user opener rather than stage directions.
 */
const KICKOFF_TEXT = "Hi! I just finished setting up Minnow — show me around.";

let guideChatId: string | null = null;
let kickoffStarted = false;

function findGuideChat(): Chat | null {
  if (!guideChatId) return null;
  return sessionState?.chats.find((c) => c.id === guideChatId) ?? null;
}

function ensureGuideChat(ctx: OnboardingContext): Chat {
  const existing = findGuideChat();
  if (existing) {
    activateChatById(existing.id);
    registerOnboardingGuideChatId(existing.id);
    return existing;
  }
  const chat = createAndActivateChat(ctx.modelId ?? '');
  chat.name = GUIDE_CHAT_NAME;
  chat.modeId = 'onboarding';
  chat.providerId = ctx.providerId ?? '';
  touchChat(chat);
  scheduleSaveSessions();
  guideChatId = chat.id;
  registerOnboardingGuideChatId(chat.id);
  return chat;
}

function startKickoffIfNeeded(chat: Chat): void {
  if (kickoffStarted || chat.history.length > 0) return;
  kickoffStarted = true;
  void runChatTurn({
    chat,
    pushUser: true,
    rawText: KICKOFF_TEXT,
    userText: KICKOFF_TEXT,
    displayText: KICKOFF_TEXT,
    historyContent: KICKOFF_TEXT,
    skillId: null,
    validAttachments: [],
    shouldScheduleTitle: false,
    suppressUserEcho: true,
  }).catch(() => {
    // Surface errors through the transcript's own error rendering; allow retry.
    kickoffStarted = false;
  });
}

function autoResize(input: HTMLTextAreaElement): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}

function renderFallback(container: HTMLElement, ctx: OnboardingContext): void {
  const card = el('div', 'mn-onboarding-info-card');
  card.appendChild(
    el(
      'p',
      null,
      'The guided tour is a live chat with your model, so it needs a connected provider' +
        (ctx.serverAvailable ? '.' : ' and Minnow running locally.'),
    ),
  );
  card.appendChild(
    el(
      'p',
      null,
      'You can finish setup now and meet Minnow later — rerun this wizard anytime from Settings → General → Run setup again.',
    ),
  );
  container.appendChild(card);
}

export const guideStep: OnboardingStep = {
  id: 'explainer',
  title: 'Meet Minnow',
  canSkip: true,
  isApplicable: () => true,

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step mn-onboarding-step--guide';

    renderStepHeader(container, guideStep, actions.stepIndex, actions.totalSteps);

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(true);

    const canChat = Boolean(ctx.providerId && ctx.modelId && ctx.serverAvailable);
    if (!canChat) {
      renderFallback(container, ctx);
      return;
    }

    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'This is a real chat — Minnow will show you around, ask a few questions, and save what it learns to your local Brain. It stays in your sidebar after setup.',
      ),
    );

    const chat = ensureGuideChat(ctx);
    // Align the top-bar model select with the wizard's provider/model choice so
    // the turn loop resolves the same binding the user just picked.
    void fetchModels().catch(() => {});

    const surface = el('div', 'mn-onboarding-guide');

    const col = el('div', 'mn-onboarding-guide__col');
    col.id = 'onboardingChatCol';
    surface.appendChild(col);

    const questionsHost = el('div', 'mn-onboarding-guide__questions');
    questionsHost.id = ONBOARDING_GUIDE_QUESTIONS_ID;
    questionsHost.hidden = true;
    surface.appendChild(questionsHost);

    const composer = el('div', 'mn-onboarding-guide__composer');
    const input = el('textarea', 'mn-onboarding-guide__input') as HTMLTextAreaElement;
    input.id = 'onboardingChatInput';
    input.rows = 1;
    input.placeholder = 'Reply to Minnow…';
    input.addEventListener('input', () => autoResize(input));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        handleComposerPrimaryAction();
      }
    });
    composer.appendChild(input);

    const sendBtn = el('button', 'mn-onboarding-guide__send');
    sendBtn.id = 'onboardingChatSendBtn';
    sendBtn.type = 'button';
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.appendChild(el('span', 'mn-onboarding-guide__send-label', 'Send'));
    sendBtn.appendChild(el('span', 'mn-onboarding-guide__send-stop', 'Stop'));
    sendBtn.addEventListener('click', () => handleComposerPrimaryAction());
    composer.appendChild(sendBtn);
    surface.appendChild(composer);

    container.appendChild(surface);

    renderChatFromHistory(chat, col);
    initComposerSteerInputListener(input);
    startKickoffIfNeeded(chat);
    input.focus();
  },

  commit(ctx) {
    const chat = findGuideChat();
    const talked = Boolean(chat?.history.some((m) => m.role === 'assistant'));
    ctx.state = recordStepProgress(ctx.state, 'explainer', {
      done: talked,
      skipped: !talked,
      data: { chatId: guideChatId, messages: chat?.history.length ?? 0 },
    });
  },
};

/** Forget the current guide chat so a wizard re-run starts a fresh conversation. */
export function resetGuideChatState(): void {
  guideChatId = null;
  kickoffStarted = false;
  registerOnboardingGuideChatId(null);
}
