/**
 * Raster icons for operating modes (General / Build / Plan / …).
 * Used in the mode selector, sidebar rail, and expanded chat rows.
 */

import { normalizeModeId, type ModeId } from '../chat/modes/types';

/** Public URL for each mode icon under /public/icons. */
export const MODE_ICON_SRC: Record<ModeId, string> = {
  general: '/icons/mode-general.png',
  build: '/icons/mode-build.png',
  plan: '/icons/mode-plan.png',
  'super-plan': '/icons/mode-super-plan.png',
  orchestrate: '/icons/mode-orchestrate.svg',
  reef: '/icons/mode-reef.svg',
  debug: '/icons/mode-debug.png',
};

/** Resolve icon path for a persisted or unknown mode id. */
export function modeIconSrc(modeId: string | null | undefined): string {
  return MODE_ICON_SRC[normalizeModeId(modeId)];
}

/** Create a masked span that tints via currentColor (sidebar rail + compact rows). */
export function createModeMaskIcon(
  modeId: ModeId | string | null | undefined,
  className = 'mode-mask-icon',
): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  applyModeMaskIcon(el, modeId);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Footer / hub sized mask icon (18px via `.mode-mask-icon--lg`). */
export function createModeMaskIconLg(
  modeId: ModeId | string | null | undefined,
  className = 'mode-mask-icon mode-mask-icon--lg',
): HTMLSpanElement {
  return createModeMaskIcon(modeId, className);
}

/** Sync mask icon data-mode-id when chat mode changes without rebuilding the row. */
export function applyModeMaskIcon(
  el: HTMLElement,
  modeId: ModeId | string | null | undefined,
): void {
  const normalized = normalizeModeId(modeId);
  el.dataset.modeId = normalized;
  el.style.setProperty('--mode-icon-url', `url('${modeIconSrc(normalized)}')`);
}

/** Update mode glyphs for a chat across all sidebar / rail lists. */
export function syncModeIconInDom(
  chatId: string,
  modeId: ModeId | string | null | undefined,
): void {
  const src = modeIconSrc(modeId);
  const normalized = normalizeModeId(modeId);
  document
    .querySelectorAll<HTMLElement>(`.chat-item-row[data-chat-id="${chatId}"] .chat-item-icon`)
    .forEach((icon) => {
      icon.dataset.modeId = normalized;
      icon.style.setProperty('--mode-icon-url', `url('${src}')`);
    });
}

/** Wire static chrome slots (sidebar footer Orchestrate, etc.). */
export function initModeChromeIcons(): void {
  const orchestrateIcon = document.querySelector<HTMLElement>(
    '#btnOrchestrate .chat-sidebar-footer-btn__mode-icon',
  );
  if (orchestrateIcon) applyModeMaskIcon(orchestrateIcon, 'orchestrate');
}
