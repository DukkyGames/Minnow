/**
 * Resolves the active composer input + send button for Code vs Chat vs desktop.
 */

import { isDesktopChatActive } from '../os/desktop-state';
import { autoResizeDesktopComposer } from '../os/desktop-composer-resize';
import { getForegroundAppId } from '../os/instances';
import type { AppId } from '../os/types';
import { isChatAppForeground } from './chat-mount';

/** Composer DOM targets used by send / steer / streaming affordances. */
export interface ComposerSurface {
  inputEl: HTMLTextAreaElement | null;
  sendBtnEl: HTMLButtonElement | null;
}

const DEFAULT_IDS: Record<string, { inputId: string; sendBtnId: string }> = {
  code: { inputId: 'msgInput', sendBtnId: 'sendBtn' },
  chat: { inputId: 'chatAppInput', sendBtnId: 'chatAppSendBtn' },
  desktop: { inputId: 'desktopInput', sendBtnId: 'desktopSendBtn' },
};

const registry = new Map<AppId | 'desktop', ComposerSurface>();

/** Override composer elements for an app (e.g. tests or embedded hosts). */
export function registerComposerSurface(
  appId: AppId | 'desktop',
  surface: ComposerSurface,
): void {
  registry.set(appId, surface);
}

function resolveByIds(inputId: string, sendBtnId: string): ComposerSurface {
  return {
    inputEl: document.getElementById(inputId) as HTMLTextAreaElement | null,
    sendBtnEl: document.getElementById(sendBtnId) as HTMLButtonElement | null,
  };
}

function resolveComposerKey(): AppId | 'desktop' {
  const foregroundAppId = getForegroundAppId();
  // Code keeps desktop chat state for return navigation, but Code owns the composer.
  if (foregroundAppId === 'code') return 'code';
  if (isDesktopChatActive()) return 'desktop';
  if (isChatAppForeground()) return 'chat';
  return foregroundAppId ?? 'code';
}

/** Composer for the foreground MinnowOS app; Code app when shell is on desktop idle. */
export function getActiveComposerSurface(): ComposerSurface {
  const key = resolveComposerKey();
  const registered = registry.get(key);
  if (registered) return registered;
  const ids = DEFAULT_IDS[key] ?? DEFAULT_IDS.code!;
  return resolveByIds(ids.inputId, ids.sendBtnId);
}

/** Merge explicit overrides with the active foreground composer. */
export function resolveComposerSurface(
  override?: Partial<ComposerSurface>,
): ComposerSurface {
  const active = getActiveComposerSurface();
  return {
    inputEl: override?.inputEl ?? active.inputEl,
    sendBtnEl: override?.sendBtnEl ?? active.sendBtnEl,
  };
}

/** Clear textarea value and reset auto-grow height when present. */
export function clearComposerInput(input: HTMLTextAreaElement | null | undefined): void {
  if (!input) return;
  input.value = '';
  input.style.height = '0px';
  input.style.overflowY = 'hidden';
  input.classList.remove('mn-os-desktop-field--scrollable');
  if (input.id === 'desktopInput') {
    autoResizeDesktopComposer(input);
  }
}
