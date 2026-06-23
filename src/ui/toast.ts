/**
 * Ephemeral bottom-center toast notifications for local UI actions.
 */

export type ToastVariant = 'success' | 'error';

const DEFAULT_DURATION_MS = 2800;

let toastEl: HTMLElement | null = null;
let hideTimer: number | undefined;
let removeTimer: number | undefined;

/** Show a short-lived toast above the bottom edge of the viewport. */
export function showToast(
  message: string,
  variant: ToastVariant = 'success',
  durationMs = DEFAULT_DURATION_MS,
): void {
  const text = message.trim();
  if (!text) return;

  if (hideTimer !== undefined) window.clearTimeout(hideTimer);
  if (removeTimer !== undefined) window.clearTimeout(removeTimer);

  toastEl?.remove();
  toastEl = null;

  const el = document.createElement('div');
  el.className = `mn-toast mn-toast--${variant}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = text;
  document.body.appendChild(el);
  toastEl = el;

  requestAnimationFrame(() => el.classList.add('mn-toast--visible'));

  hideTimer = window.setTimeout(() => {
    el.classList.remove('mn-toast--visible');
    removeTimer = window.setTimeout(() => {
      el.remove();
      if (toastEl === el) toastEl = null;
    }, 250);
  }, durationMs);
}
