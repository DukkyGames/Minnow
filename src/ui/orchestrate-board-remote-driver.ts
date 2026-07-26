/**
 * Read-only board banner when orchestrate auto-drive runs on another device.
 */

import { isBoardDrivenRemotely, getRemoteBoardDriverLabel } from '../state/session-sync';
import { getActiveChat } from '../state/sessions';
import { isBoardViewActive } from './view-mode-toggle';

const BANNER_CLASS = 'board-header__remote-driver';

/** Show or hide the "driven on another device" chip in the board header. */
export function syncOrchestrateBoardRemoteDriverBanner(): void {
  if (typeof document === 'undefined') return;
  const header = document.querySelector('.board-header');
  if (!(header instanceof HTMLElement)) return;

  const remote = isBoardDrivenRemotely();
  let banner = header.querySelector(`.${BANNER_CLASS}`);

  if (!remote || !isBoardViewActive()) {
    banner?.remove();
    return;
  }

  const label = getRemoteBoardDriverLabel() ?? 'another device';
  let bannerEl: HTMLElement;
  if (banner instanceof HTMLElement) {
    bannerEl = banner;
  } else {
    bannerEl = document.createElement('span');
    bannerEl.className = BANNER_CLASS;
    bannerEl.setAttribute('role', 'status');
    const leading = header.querySelector('.board-header__leading');
    if (leading) {
      leading.appendChild(bannerEl);
    } else {
      header.prepend(bannerEl);
    }
  }
  bannerEl.textContent = `Driven on ${label}`;
  bannerEl.title = `Orchestrate board auto-run is active on ${label}. This view is read-only.`;
}

/** Re-sync banner when active chat / view mode changes. */
export function initOrchestrateBoardRemoteDriverBanner(): void {
  syncOrchestrateBoardRemoteDriverBanner();
  const chat = getActiveChat();
  if (!chat?.groupId) return;
}
