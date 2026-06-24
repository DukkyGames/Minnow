/**
 * Chat transcript mount resolution for Code (#chatArea) vs Chat app vs desktop chat.
 */

import { isDesktopChatActive } from '../os/desktop-state';
import { getForegroundAppId } from '../os/instances';
import { getOrchestrateChatMountElement } from './orchestrate-board-init-split';

/** True when desktop chat or the legacy Chat app is the active UI. */
export function isChatAppForeground(): boolean {
  const foregroundAppId = getForegroundAppId();
  // Code fullscreen keeps desktop chat state for return navigation, but Code owns the UI.
  if (foregroundAppId === 'code') return false;
  if (isDesktopChatActive()) return true;
  if (foregroundAppId === 'chat') return true;
  if (foregroundAppId != null) return false;
  return document.getElementById('chatView')?.classList.contains('is-open') ?? false;
}

let mountOverride: HTMLElement | null = null;

/**
 * Mount pinned at the start of the active chat's async turn.
 * Only the active-chat turn (useActiveChatDom) sets this. Prevents mid-turn
 * navigation (e.g. launch_minnow_app routing to Code) from re-routing stream output.
 */
let turnMount: HTMLElement | null = null;

/** Pin the stream mount for the active chat's turn. Pass null to release. */
export function setTurnChatMount(mount: HTMLElement | null): void {
  turnMount = mount;
}

/** Resolve a mount selector or element; falls back to orchestrate / #chatArea. */
export function resolveChatMount(mount?: string | HTMLElement): HTMLElement {
  if (mount instanceof HTMLElement) return mount;
  const id = (typeof mount === 'string' ? mount : 'chatArea').replace(/^#/, '');
  return document.getElementById(id) ?? getOrchestrateChatMountElement();
}

/** True when rendering into the Code app main transcript (#chatArea or split pane). */
export function isCodeChatMount(mount?: string | HTMLElement): boolean {
  if (!mount) return true;
  if (mount instanceof HTMLElement) {
    return mount.id === 'chatArea' || mount.dataset.testid === 'orchestrate-chat-pane';
  }
  const normalized = mount.replace(/^#/, '');
  return normalized === 'chatArea';
}

/** Inner message column inside the Chat app scroll viewport. */
function getChatAppMessageCol(): HTMLElement | null {
  return document.getElementById('chatAppMessageCol');
}

/** Active transcript root: override, desktop column, Chat app column, or Code orchestrate mount. */
export function getActiveChatMountElement(): HTMLElement {
  if (mountOverride) return mountOverride;
  if (turnMount) return turnMount;
  const codeForeground = getForegroundAppId() === 'code';
  if (!codeForeground && isDesktopChatActive()) {
    const desktopCol = document.getElementById('desktopChatCol');
    if (desktopCol) return desktopCol;
  }
  if (isChatAppForeground()) {
    const col = getChatAppMessageCol();
    if (col) return col;
    const chatAppArea = document.getElementById('chatAppArea');
    if (chatAppArea) return chatAppArea;
  }
  return getOrchestrateChatMountElement();
}

/** Temporarily pin bubble / stream append targets during a history re-render. */
export function runWithChatMount(mount: HTMLElement, fn: () => void): void {
  const prev = mountOverride;
  mountOverride = mount;
  try {
    fn();
  } finally {
    mountOverride = prev;
  }
}
