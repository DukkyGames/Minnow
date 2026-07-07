import { streaming } from '../app-state';
import { enqueueComposerMessage } from '../chat/message-queue';
import { isActiveChatStreaming } from '../chat/streaming-state';
import { stopGeneration } from '../chat/stop-generation';
import { getActiveChat } from '../state/sessions';
import {
  clearComposerInput,
  getActiveComposerSurface,
} from './composer-surface';
import { isDesktopChatActive } from '../os/desktop-state';
import { isChatAppForeground } from './chat-mount';
import { setStatus } from './status';
import { refreshActiveBoardIfMounted } from './orchestrate-board';
import { syncBackgroundStreamHint } from './composer-stream-hint';
import { syncGoalActiveHint } from './goal-active-hint';
import {
  syncComposerFollowUpPlaceholder,
  syncComposerMessageQueue,
} from './composer-message-queue';

export type ComposerStreamingMode = 'idle' | 'streaming';

let recoveryBlocked = false;

/** Block composer send while Continue / Discard banner is visible. */
export function setComposerRecoveryBlocked(blocked: boolean): void {
  recoveryBlocked = blocked;
  const { sendBtnEl: sendBtn, inputEl: input } = getActiveComposerSurface();
  if (sendBtn && !isActiveChatStreaming()) {
    sendBtn.disabled = blocked;
  }
  if (input) {
    input.disabled = blocked;
  }
  void import('./view-mode-toggle').then((m) => m.refreshViewModeToggleDisabled());
}

export function isComposerRecoveryBlocked(): boolean {
  return recoveryBlocked;
}

/** True when Send/Enter should run (send, steer, or stop) on the active composer. */
export function shouldAllowComposerPrimaryAction(inputText: string): boolean {
  return Boolean(inputText.trim()) || isActiveChatStreaming();
}

function composerInputHasText(): boolean {
  return Boolean(getActiveComposerSurface().inputEl?.value.trim());
}

/** Update primary button label during streaming from composer text (steer vs stop). */
export function refreshComposerStreamingAffordance(): void {
  const sendBtn = getActiveComposerSurface().sendBtnEl;
  if (!sendBtn || sendBtn.dataset.mode !== 'stop') return;

  const hasText = composerInputHasText();
  sendBtn.setAttribute(
    'aria-label',
    hasText ? 'Queue follow-up message' : 'Stop generating',
  );
  sendBtn.dataset.steerReady = hasText ? 'true' : 'false';
}

/** Show or hide the Chat app dedicated stop control (#btnChatAppStop). */
function syncChatAppStopButton(streaming: boolean): void {
  const stopBtn = document.getElementById('btnChatAppStop') as HTMLButtonElement | null;
  if (!stopBtn) return;
  stopBtn.hidden = !streaming;
  stopBtn.classList.toggle('hidden', !streaming);
  stopBtn.disabled = !streaming;
}

/** Toggle send vs stop affordance on the composer primary button. */
export function setComposerStreamingMode(mode: ComposerStreamingMode): void {
  const { sendBtnEl: sendBtn, inputEl: input } = getActiveComposerSurface();
  if (!sendBtn) return;

  const isStreaming = mode === 'streaming';
  const chatApp = isChatAppForeground() && !isDesktopChatActive();

  if (chatApp) {
    syncChatAppStopButton(isStreaming);
    sendBtn.disabled = isStreaming ? false : recoveryBlocked;
    sendBtn.setAttribute('aria-busy', isStreaming ? 'true' : 'false');
    sendBtn.dataset.mode = 'send';
    sendBtn.classList.remove('send-btn--stop');
    sendBtn.removeAttribute('data-steer-ready');
    sendBtn.setAttribute('aria-label', 'Send message');
    if (input) input.disabled = recoveryBlocked;
    syncDesktopComposerFishSwim();
    return;
  }

  const sendIcon = document.getElementById('sendIcon');
  const sendStopIcon = document.getElementById('sendStopIcon');
  const sendSpinner = document.getElementById('sendSpinner');

  sendBtn.disabled = false;
  sendBtn.setAttribute('aria-busy', isStreaming ? 'true' : 'false');
  sendBtn.dataset.mode = isStreaming ? 'stop' : 'send';
  sendBtn.classList.toggle('send-btn--stop', isStreaming);
  if (!isStreaming) {
    sendBtn.removeAttribute('data-steer-ready');
    sendBtn.setAttribute('aria-label', 'Send message');
  } else {
    refreshComposerStreamingAffordance();
  }

  sendIcon?.classList.toggle('hidden', isStreaming);
  sendStopIcon?.classList.toggle('hidden', !isStreaming);
  sendSpinner?.classList.add('hidden');

  if (input) {
    input.disabled = recoveryBlocked;
  }
  if (sendBtn && !isStreaming) {
    const emptyDesktop =
      isDesktopChatActive() && !composerInputHasText();
    sendBtn.disabled = recoveryBlocked || emptyDesktop;
  }

  syncDesktopComposerFishSwim();
}

/** Swim the desktop send fish while the active chat is streaming. */
export function syncDesktopComposerFishSwim(): void {
  const composer = document.getElementById('desktopComposerRoot');
  const sendBtn = document.getElementById('desktopSendBtn');
  if (!composer) return;

  const swimming = isDesktopChatActive() && isActiveChatStreaming();
  composer.classList.toggle('is-streaming', swimming);
  sendBtn?.setAttribute('aria-busy', swimming ? 'true' : 'false');
}

/** Align send/stop button and background-stream hint with active vs streaming chat. */
export function syncComposerFromStreamingState(): void {
  setComposerStreamingMode(isActiveChatStreaming() ? 'streaming' : 'idle');
  syncDesktopComposerFishSwim();
  syncBackgroundStreamHint();
  syncComposerMessageQueue();
  syncComposerFollowUpPlaceholder(isActiveChatStreaming());
  syncGoalActiveHint();
  refreshActiveBoardIfMounted();
  void import('./composer-run-target').then((m) => m.refreshComposerRunTargetDisabled());
}

function submitQueueFromComposer(): void {
  const input = getActiveComposerSurface().inputEl;
  const text = input?.value.trim() ?? '';
  if (!text) return;
  const chat = getActiveChat();
  if (!enqueueComposerMessage(chat, text)) return;
  clearComposerInput(input);
  setStatus('ok', 'Follow-up queued');
  refreshComposerStreamingAffordance();
  syncComposerMessageQueue();
}

/** Send when idle; queue follow-up when streaming with text; stop when streaming with empty input. */
export function handleComposerPrimaryAction(): void {
  if (isActiveChatStreaming()) {
    if (composerInputHasText()) {
      submitQueueFromComposer();
      return;
    }
    stopGeneration();
    return;
  }
  void import('../chat/messaging').then((m) => m.sendMessage());
}

/** Wire composer input listener for streaming steer/stop aria labels (call once per textarea). */
export function initComposerSteerInputListener(inputEl?: HTMLTextAreaElement | null): void {
  const input = inputEl ?? getActiveComposerSurface().inputEl;
  if (!input || input.dataset.steerListener === '1') return;
  input.dataset.steerListener = '1';
  input.addEventListener('input', () => {
    if (streaming) refreshComposerStreamingAffordance();
  });
}

/** @deprecated Use {@link setComposerStreamingMode} — maps loading flag to idle/streaming. */
export function setSendLoading(loading: boolean): void {
  setComposerStreamingMode(loading ? 'streaming' : 'idle');
}
