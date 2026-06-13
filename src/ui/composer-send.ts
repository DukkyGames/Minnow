import { streaming } from '../app-state';
import { enqueueSteerMessage } from '../chat/steer-message';
import { isActiveChatStreaming } from '../chat/streaming-state';
import { stopGeneration } from '../chat/stop-generation';
import { getActiveChat } from '../state/sessions';
import {
  clearComposerInput,
  getActiveComposerSurface,
} from './composer-surface';
import { isChatAppForeground } from './chat-mount';
import { setStatus } from './status';
import { refreshActiveBoardIfMounted } from './orchestrate-board';
import { syncBackgroundStreamHint } from './composer-stream-hint';

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
    hasText ? 'Send steering message' : 'Stop generating',
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
  const chatApp = isChatAppForeground();

  if (chatApp) {
    syncChatAppStopButton(isStreaming);
    sendBtn.disabled = isStreaming ? false : recoveryBlocked;
    sendBtn.setAttribute('aria-busy', isStreaming ? 'true' : 'false');
    sendBtn.dataset.mode = 'send';
    sendBtn.classList.remove('send-btn--stop');
    sendBtn.removeAttribute('data-steer-ready');
    sendBtn.setAttribute('aria-label', 'Send message');
    if (input) input.disabled = recoveryBlocked;
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
    sendBtn.disabled = recoveryBlocked;
  }
}

/** Hint when a steering correction is queued on the active streaming chat. */
export function syncSteerQueuedHint(): void {
  let el = document.getElementById('composerSteerQueuedHint');
  if (!el) {
    el = document.createElement('p');
    el.id = 'composerSteerQueuedHint';
    el.className = 'composer-steer-queued-hint hidden';
    el.setAttribute('role', 'status');
    const host = document.querySelector('.input-bar-composer');
    if (host) {
      host.insertBefore(el, host.firstChild);
    } else {
      document.body.appendChild(el);
    }
  }

  const chat = getActiveChat();
  const show =
    isActiveChatStreaming() && Boolean(chat.pendingSteerMessage?.trim());
  el.classList.toggle('hidden', !show);
  el.textContent = show ? 'Correction queued — applies after current step' : '';
}

/** Align send/stop button and background-stream hint with active vs streaming chat. */
export function syncComposerFromStreamingState(): void {
  setComposerStreamingMode(isActiveChatStreaming() ? 'streaming' : 'idle');
  syncBackgroundStreamHint();
  syncSteerQueuedHint();
  refreshActiveBoardIfMounted();
}

function submitSteerFromComposer(): void {
  const input = getActiveComposerSurface().inputEl;
  const text = input?.value.trim() ?? '';
  if (!text) return;
  const chat = getActiveChat();
  const hadPrior = Boolean(chat.pendingSteerMessage?.trim());
  if (!enqueueSteerMessage(chat, text)) return;
  clearComposerInput(input);
  setStatus(
    'ok',
    hadPrior
      ? 'Correction updated — applies after current step'
      : 'Steering at next step…',
  );
  refreshComposerStreamingAffordance();
  syncSteerQueuedHint();
}

/** Send when idle; steer when streaming with text; stop when streaming with empty input. */
export function handleComposerPrimaryAction(): void {
  if (isActiveChatStreaming()) {
    if (composerInputHasText()) {
      submitSteerFromComposer();
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
