/**
 * Resolves the active composer input + send button for Code vs Chat (and other apps).
 */

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
};

const registry = new Map<AppId, ComposerSurface>();

/** Override composer elements for an app (e.g. tests or embedded hosts). */
export function registerComposerSurface(appId: AppId, surface: ComposerSurface): void {
  registry.set(appId, surface);
}

function resolveByIds(inputId: string, sendBtnId: string): ComposerSurface {
  return {
    inputEl: document.getElementById(inputId) as HTMLTextAreaElement | null,
    sendBtnEl: document.getElementById(sendBtnId) as HTMLButtonElement | null,
  };
}

/** Composer for the foreground MinnowOS app; Code app when shell is on desktop. */
export function getActiveComposerSurface(): ComposerSurface {
  const appId = isChatAppForeground() ? 'chat' : (getForegroundAppId() ?? 'code');
  const registered = registry.get(appId);
  if (registered) return registered;
  const ids = DEFAULT_IDS[appId] ?? DEFAULT_IDS.code!;
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
  input.style.height = 'auto';
}
