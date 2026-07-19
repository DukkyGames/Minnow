/**
 * Undo affordance for queued sends.
 *
 * This is the replacement for the pre-send `window.confirm`. A modal asking
 * "are you sure?" is answered reflexively after the third time and stops being
 * a real check; a few seconds during which the send is visibly recallable
 * catches the mistakes people actually make — wrong recipient, missing
 * attachment, sent-too-soon — without gating the common case behind a click.
 */

import { cancelOutboxSend, type OutboxEntry } from '../../email/client';

let activeToast: HTMLElement | null = null;

function dismiss(): void {
  activeToast?.remove();
  activeToast = null;
}

export interface SendUndoToastOptions {
  /** The send was recalled and the composer should reopen. */
  onUndo?: (entry: OutboxEntry) => void;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
}

/**
 * Show "Sending… / Undo" until the entry's undo window closes.
 * @returns a function that dismisses the toast early
 */
export function showSendUndoToast(
  entry: OutboxEntry,
  options: SendUndoToastOptions = {},
): () => void {
  // Only one send is ever in flight from the composer; a second replaces the first.
  dismiss();

  const toast = document.createElement('div');
  toast.className = 'email-undo-toast';
  toast.setAttribute('role', 'status');

  const label = document.createElement('span');
  label.className = 'email-undo-toast-text';

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'email-undo-toast-btn';
  undoBtn.textContent = 'Undo';

  toast.append(label, undoBtn);
  document.body.appendChild(toast);
  activeToast = toast;

  const deadline = new Date(entry.sendAt).getTime();
  let timer = 0;

  const stop = (): void => {
    window.clearInterval(timer);
    if (activeToast === toast) dismiss();
  };

  const tick = (): void => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    label.textContent = remaining > 0 ? `Sending to ${entry.to} in ${remaining}s` : 'Sending…';
    if (remaining <= 0) {
      window.clearInterval(timer);
      undoBtn.disabled = true;
      // Leave the toast up briefly so "Sending…" isn't a flash of nothing.
      window.setTimeout(stop, 1500);
    }
  };

  undoBtn.addEventListener('click', async () => {
    undoBtn.disabled = true;
    try {
      await cancelOutboxSend(entry.id);
      stop();
      options.onStatus?.('ok', 'Send cancelled');
      options.onUndo?.(entry);
    } catch (err) {
      // The window closed between the click and the request landing.
      undoBtn.disabled = true;
      options.onStatus?.(
        'err',
        err instanceof Error ? err.message : 'Too late to cancel — the message was sent',
      );
      stop();
    }
  });

  tick();
  timer = window.setInterval(tick, 250);

  return stop;
}
