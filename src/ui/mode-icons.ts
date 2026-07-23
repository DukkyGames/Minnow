/**
 * Raster icons for operating modes (General / Build / Plan / …).
 * Used in the mode selector, sidebar rail, and expanded chat rows.
 */

import { normalizeModeId, type ModeId } from '../chat/modes/types';

/** Thicker Orchestrate glyph for hub intent chips and sidebar chat list (board folders + planner rows). */
export const ORCHESTRATE_PROMINENT_ICON_SRC = '/icons/Orchestrate-thick.svg';

/** Public URL for each mode icon under /public/icons. */
export const MODE_ICON_SRC: Record<ModeId, string> = {
  general: '/icons/mode-general.png',
  desktop: '/icons/mode-general.png',
  email: '/icons/mode-general.png',
  build: '/icons/mode-build.png',
  plan: '/icons/mode-plan.png',
  'super-plan': '/icons/mode-super-plan.png',
  orchestrate: '/icons/Orchestrate.svg',
  reef: '/icons/mode-reef.svg',
  debug: '/icons/mode-debug.png',
  onboarding: '/icons/mode-general.png',
};

/** Resolve icon path for a persisted or unknown mode id. */
export function modeIconSrc(modeId: string | null | undefined): string {
  return MODE_ICON_SRC[normalizeModeId(modeId)];
}

/** Sidebar `#chatList` rows: thicker Orchestrate glyph at compact sizes. */
export function chatListModeIconSrc(modeId: string | null | undefined): string {
  const normalized = normalizeModeId(modeId);
  if (normalized === 'orchestrate') return ORCHESTRATE_PROMINENT_ICON_SRC;
  return MODE_ICON_SRC[normalized];
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
  const src = chatListModeIconSrc(modeId);
  const normalized = normalizeModeId(modeId);
  document
    .querySelectorAll<HTMLElement>(`.chat-item-row[data-chat-id="${chatId}"] .chat-item-icon`)
    .forEach((icon) => {
      icon.dataset.modeId = normalized;
      icon.style.setProperty('--mode-icon-url', `url('${src}')`);
    });
}
