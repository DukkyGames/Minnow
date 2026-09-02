import { cancelOutboxSend, type OutboxEntry } from '../../email/client';

let activeToast: HTMLElement | null = null;

function dismiss(): void {
  activeToast?.remove();
  activeToast = null;
}

/** Build the shared toast shell: a status line and one trailing action button. */
function buildToast(buttonLabel: string): {
  toast: HTMLElement;
  label: HTMLElement;
  button: HTMLButtonElement;
} {
  dismiss();

  const toast = document.createElement('div');
  toast.className = 'email-undo-toast';
  toast.setAttribute('role', 'status');

  const label = document.createElement('span');
  label.className = 'email-undo-toast-text';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'email-undo-toast-btn';
  button.textContent = buttonLabel;

  toast.append(label, button);
  document.body.appendChild(toast);
  activeToast = toast;

  return { toast, label, button };
}

export interface SendUndoToastOptions {
  /** The send was recalled and the composer should reopen. */
  onUndo?: (entry: OutboxEntry) => void;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
}

/** Show "Sending… / Undo" until the entry's undo window closes. */
export function showSendUndoToast(
  entry: OutboxEntry,
  options: SendUndoToastOptions = {},
): () => void {
  const { toast, label, button: undoBtn } = buildToast('Undo');

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

export interface ActionUndoToastOptions {
  /** Reverse the action. Rejections surface through `onStatus`. */
  onUndo: () => void | Promise<void>;
  /** How long the Undo stays offered. */
  durationMs?: number;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
}

/** Show "{message} · Undo" for an action that already applied optimistically (trash, archive, move). */
export function showActionUndoToast(
  message: string,
  options: ActionUndoToastOptions,
): () => void {
  const { toast, label, button: undoBtn } = buildToast('Undo');
  label.textContent = message;

  let timer = 0;
  const stop = (): void => {
    window.clearTimeout(timer);
    if (activeToast === toast) dismiss();
  };

  undoBtn.addEventListener('click', async () => {
    undoBtn.disabled = true;
    try {
      await options.onUndo();
      options.onStatus?.('ok', `Undid ${message.toLowerCase()}`);
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Undo failed');
    } finally {
      stop();
    }
  });

  timer = window.setTimeout(stop, options.durationMs ?? 6000);
  return stop;
}
