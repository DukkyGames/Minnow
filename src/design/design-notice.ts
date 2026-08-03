/**
 * Inline Design Mode notices anchored to the preview host (#previewBody), not global toasts.
 */

const NOTICE_CLASS = 'mn-design-notice';

export type DesignNoticeTone = 'error' | 'info';

/** Show or hide a notice banner inside the preview panel host. */
export function setDesignModeNotice(
  host: HTMLElement | null | undefined,
  message: string | null,
  tone: DesignNoticeTone = 'error',
): void {
  if (!host) return;

  const trimmed = message?.trim() ?? '';
  const existing = host.querySelector<HTMLElement>(`.${NOTICE_CLASS}`);

  if (!trimmed) {
    existing?.remove();
    return;
  }

  const el = existing ?? document.createElement('div');
  el.className = `${NOTICE_CLASS} mn-design-notice--${tone}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.textContent = trimmed;

  if (!existing) {
    host.appendChild(el);
  }
}

export function clearDesignModeNotice(host: HTMLElement | null | undefined): void {
  setDesignModeNotice(host, null);
}
