/**
 * Resolves visible hosts for tool approval and ask_question strips.
 * Mirrors composer-surface routing so prompts are not mounted in hidden shells.
 */

import {
  isDesktopChatActive,
  isDesktopExpertsActive,
  isDesktopResearchActive,
} from '../os/desktop-state';
import { getForegroundAppId } from '../os/instances';
import { shouldPaintDesktopChatSurface } from './chat-mount';

const GLOBAL_PROMPT_HOST_IDS = new Set(['globalToolApprovalHost', 'globalQuestionHost']);

/** True when an element can be shown to the user (not display:none / hidden). */
export function isPromptHostVisible(host: HTMLElement | null): boolean {
  if (!host || host.hidden) return false;
  if (host.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(host);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

/**
 * True when the host's owning chat shell is on screen.
 * Ignores `host.hidden` — empty prompt slots stay hidden until a strip opens.
 */
export function isPromptHostShellVisible(host: HTMLElement): boolean {
  if (GLOBAL_PROMPT_HOST_IDS.has(host.id)) return true;

  const chatView = host.closest('#chatView');
  if (chatView) {
    return chatView.classList.contains('is-open');
  }

  if (host.closest('#desktopComposerRoot')) {
    return (
      isDesktopChatActive() || isDesktopResearchActive() || isDesktopExpertsActive()
    );
  }

  if (host.closest('#mainColumn')) {
    const fg = getForegroundAppId();
    return fg === 'code' || fg == null;
  }

  const emailDock = host.closest('.email-assistant-dock');
  if (emailDock) {
    return (
      getForegroundAppId() === 'email' &&
      emailDock.classList.contains('is-open') &&
      emailDock.getAttribute('aria-hidden') !== 'true'
    );
  }

  return true;
}

/** Pick the first host whose shell is visible; else global or any existing host. */
function pickPromptHost(candidates: (HTMLElement | null)[]): HTMLElement | null {
  for (const host of candidates) {
    if (host && isPromptHostShellVisible(host)) return host;
  }
  const global = candidates.find((host) => host && GLOBAL_PROMPT_HOST_IDS.has(host.id));
  if (global) return global;
  return candidates.find((host) => host != null) ?? null;
}

/** Chat app page is open (legacy #/chat or Minnow Chat window). */
function isLegacyChatAppOpen(): boolean {
  return document.getElementById('chatView')?.classList.contains('is-open') ?? false;
}

/** Ordered tool-approval host candidates for the active chat surface. */
export function resolveToolApprovalHost(): HTMLElement | null {
  const codeHost = document.getElementById('toolApprovalHost');
  const chatHost = document.getElementById('chatAppToolApprovalHost');
  const desktopHost = document.getElementById('desktopToolApprovalHost');
  const emailHost = document.getElementById('emailAssistantToolApprovalHost');
  const globalHost = document.getElementById('globalToolApprovalHost');

  if (getForegroundAppId() === 'email') {
    return pickPromptHost([emailHost, globalHost, codeHost, chatHost, desktopHost]);
  }
  if (shouldPaintDesktopChatSurface()) {
    return pickPromptHost([desktopHost, globalHost, codeHost, chatHost]);
  }
  if (isLegacyChatAppOpen()) {
    return pickPromptHost([chatHost, globalHost, codeHost, desktopHost]);
  }
  return pickPromptHost([codeHost, globalHost, chatHost, desktopHost]);
}

/** Ordered ask_question host candidates for the active chat surface. */
export function resolveQuestionHost(): HTMLElement | null {
  const codeHost = document.getElementById('questionHost');
  const chatHost = document.getElementById('chatAppQuestionHost');
  const desktopHost = document.getElementById('desktopQuestionHost');
  const emailHost = document.getElementById('emailAssistantQuestionHost');
  const globalHost = document.getElementById('globalQuestionHost');

  if (getForegroundAppId() === 'email') {
    return pickPromptHost([emailHost, globalHost, codeHost, chatHost, desktopHost]);
  }
  if (shouldPaintDesktopChatSurface()) {
    return pickPromptHost([desktopHost, globalHost, codeHost, chatHost]);
  }
  if (isLegacyChatAppOpen()) {
    return pickPromptHost([chatHost, globalHost, codeHost, desktopHost]);
  }
  return pickPromptHost([codeHost, globalHost, chatHost, desktopHost]);
}

/** Composer shell that should hide its input row while a prompt strip is open. */
export function resolvePromptComposerShell(): HTMLElement | null {
  if (getForegroundAppId() === 'email') {
    return document.querySelector('.email-assistant-composer');
  }
  if (shouldPaintDesktopChatSurface()) {
    return (
      document.querySelector('.mn-os-composer-dock') ??
      document.getElementById('desktopComposerRoot')
    );
  }
  if (isLegacyChatAppOpen()) {
    return document.querySelector('.chat-app-composer');
  }
  return document.getElementById('mainColumn');
}
