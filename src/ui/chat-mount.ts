import { getForegroundAppId } from '../os/instances';
import { getOrchestrateChatMountElement } from './orchestrate-board-init-split';
import {
  isBoardChatEmbedOpen,
  queryBoardChatTranscriptHost,
} from './orchestrate-board-chat-state';

/** Desktop chat surface was removed with the workspace-first shell. */
export function shouldPaintDesktopChatSurface(): boolean {
  return false;
}

/** True when desktop chat or the legacy Chat app is the active UI. */
export function isChatAppForeground(): boolean {
  const foregroundAppId = getForegroundAppId();
  if (foregroundAppId === 'code') return false;
  if (foregroundAppId != null) return false;
  return document.getElementById('chatView')?.classList.contains('is-open') ?? false;
}

/** True when the foreground Email app currently exposes its assistant transcript. */
export function isEmailAssistantForeground(): boolean {
  if (getForegroundAppId() !== 'email') return false;
  const dock = document.querySelector<HTMLElement>('.email-assistant-dock.is-open');
  return Boolean(dock && dock.getAttribute('aria-hidden') !== 'true');
}

let mountOverride: HTMLElement | null = null;

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

/** Column shell for inset overlays (sub-agent drawer, goal eval) on the active chat surface. */
export function resolveSubAgentOverlayMount(): HTMLElement | null {
  if (shouldPaintDesktopChatSurface()) {
    return (
      document.querySelector<HTMLElement>('.mn-os-desktop-chat') ??
      document.getElementById('osDesktopLayer')
    );
  }
  if (isChatAppForeground()) {
    return (
      document.querySelector<HTMLElement>('.chat-app-main') ??
      document.getElementById('chatView')
    );
  }
  return document.getElementById('mainColumn');
}

/** Active transcript root: override, desktop column, Chat app column, or Code orchestrate mount. */
export function getActiveChatMountElement(): HTMLElement {
  if (mountOverride) return mountOverride;
  const boardChatHost = isBoardChatEmbedOpen() ? queryBoardChatTranscriptHost() : null;
  if (boardChatHost) return boardChatHost;
  if (turnMount) return turnMount;
  if (isEmailAssistantForeground()) {
    const emailCol = document.getElementById('emailAssistantMessageCol');
    if (emailCol) return emailCol;
  }
  if (isChatAppForeground()) {
    const col = getChatAppMessageCol();
    if (col) return col;
    const chatAppArea = document.getElementById('chatAppArea');
    if (chatAppArea) return chatAppArea;
  }
  return getOrchestrateChatMountElement();
}

/** Host for composer-queued follow-up bubbles (MIN-647). */
export const QUEUED_TRANSCRIPT_ID = 'queuedTranscript';

/** Append a transcript node above the queued-follow-up cluster. */
export function appendChatTranscriptNode(node: Node, mount?: HTMLElement | null): void {
  const host = mount ?? getActiveChatMountElement();
  if (!host) return;
  const anchor = host.querySelector(`#${QUEUED_TRANSCRIPT_ID}`);
  if (anchor) {
    host.insertBefore(node, anchor);
    return;
  }
  host.appendChild(node);
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
