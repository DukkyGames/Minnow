import { streaming } from '../app-state';
import { stopGeneration } from '../chat/stop-generation';

export type ComposerStreamingMode = 'idle' | 'streaming';

let recoveryBlocked = false;

/** Block composer send while Continue / Discard banner is visible. */
export function setComposerRecoveryBlocked(blocked: boolean): void {
  recoveryBlocked = blocked;
  const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (sendBtn && !streaming) {
    sendBtn.disabled = blocked;
  }
  if (input) {
    input.disabled = blocked;
  }
}

export function isComposerRecoveryBlocked(): boolean {
  return recoveryBlocked;
}

/** Toggle send vs stop affordance on the composer primary button. */
export function setComposerStreamingMode(mode: ComposerStreamingMode): void {
  const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;
  if (!sendBtn) return;

  const sendIcon = document.getElementById('sendIcon');
  const sendStopIcon = document.getElementById('sendStopIcon');
  const sendSpinner = document.getElementById('sendSpinner');
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;

  const isStreaming = mode === 'streaming';
  sendBtn.disabled = false;
  sendBtn.setAttribute('aria-busy', isStreaming ? 'true' : 'false');
  sendBtn.dataset.mode = isStreaming ? 'stop' : 'send';
  sendBtn.classList.toggle('send-btn--stop', isStreaming);
  sendBtn.setAttribute(
    'aria-label',
    isStreaming ? 'Stop generating' : 'Send message',
  );

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

/** Send when idle; abort the active stream when a reply is in progress. */
export function handleComposerPrimaryAction(): void {
  if (streaming) {
    stopGeneration();
    return;
  }
  void import('../chat/messaging').then((m) => m.sendMessage());
}

/** @deprecated Use {@link setComposerStreamingMode} — maps loading flag to idle/streaming. */
export function setSendLoading(loading: boolean): void {
  setComposerStreamingMode(loading ? 'streaming' : 'idle');
}
