/**
 * Composer toolbar tools button — quick off/ask/full permissions popover.
 */

import { loadToolConfigIntoDrawer, syncWebSearchProviderFromSearchConfig } from '../tools/config';

interface ToolsPopoverIds {
  buttonId: string;
  popoverId: string;
  settingsLinkId: string;
}

const popoverState = new Map<string, boolean>();
const registeredPopovers: ToolsPopoverIds[] = [];

function isPopoverOpen(popoverId: string): boolean {
  return popoverState.get(popoverId) === true;
}

function getButton(ids: ToolsPopoverIds): HTMLButtonElement | null {
  return document.getElementById(ids.buttonId) as HTMLButtonElement | null;
}

function getPopover(ids: ToolsPopoverIds): HTMLElement | null {
  return document.getElementById(ids.popoverId);
}

/** Close one tools popover and restore focus to its button. */
function closeToolsPopover(ids: ToolsPopoverIds): void {
  const popover = getPopover(ids);
  const button = getButton(ids);
  if (!popover || popover.classList.contains('hidden')) {
    popoverState.set(ids.popoverId, false);
    return;
  }

  popover.classList.add('hidden');
  popoverState.set(ids.popoverId, false);
  button?.setAttribute('aria-expanded', 'false');
  button?.focus();
}

/** Close every registered tools popover except the optional keep-open id. */
function closeOtherToolsPopovers(keepOpenId?: string): void {
  for (const ids of registeredPopovers) {
    if (ids.popoverId === keepOpenId) continue;
    closeToolsPopover(ids);
  }
}

/** Open a tools popover and focus the first control inside. */
function openToolsPopover(ids: ToolsPopoverIds): void {
  const popover = getPopover(ids);
  const button = getButton(ids);
  if (!popover || !button) return;

  closeOtherToolsPopovers(ids.popoverId);
  loadToolConfigIntoDrawer(document);
  void syncWebSearchProviderFromSearchConfig();

  popover.classList.remove('hidden');
  popoverState.set(ids.popoverId, true);
  button.setAttribute('aria-expanded', 'true');

  const first = popover.querySelector<HTMLElement>(
    'select, input, button, [href], [tabindex]:not([tabindex="-1"])',
  );
  first?.focus();
}

/** Toggle one tools popover. */
function toggleToolsPopover(ids: ToolsPopoverIds): void {
  if (isPopoverOpen(ids.popoverId)) {
    closeToolsPopover(ids);
    return;
  }
  openToolsPopover(ids);
}

/** Wire button, outside click, Escape, and settings link for one popover. */
function initToolsPopover(ids: ToolsPopoverIds): void {
  registeredPopovers.push(ids);

  const button = getButton(ids);
  const popover = getPopover(ids);
  const settingsLink = document.getElementById(ids.settingsLinkId);

  if (!button || !popover) return;

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleToolsPopover(ids);
  });

  document.addEventListener('click', (event) => {
    if (!isPopoverOpen(ids.popoverId)) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (button.contains(target) || popover.contains(target)) return;
    closeToolsPopover(ids);
  });

  document.addEventListener('keydown', (event) => {
    if (!isPopoverOpen(ids.popoverId) || event.key !== 'Escape') return;
    event.stopPropagation();
    closeToolsPopover(ids);
  });

  settingsLink?.addEventListener('click', () => {
    closeToolsPopover(ids);
    void import('./settings-page').then(({ openSettings }) => openSettings('tools'));
  });
}

const COMPOSER_POPOVER_IDS: ToolsPopoverIds = {
  buttonId: 'btnComposerTools',
  popoverId: 'composerToolsPopover',
  settingsLinkId: 'composerToolsOpenSettings',
};

const CHAT_APP_POPOVER_IDS: ToolsPopoverIds = {
  buttonId: 'btnChatAppTools',
  popoverId: 'chatAppToolsPopover',
  settingsLinkId: 'chatAppToolsOpenSettings',
};

const DESKTOP_POPOVER_IDS: ToolsPopoverIds = {
  buttonId: 'btnDesktopTools',
  popoverId: 'desktopToolsPopover',
  settingsLinkId: 'desktopToolsOpenSettings',
};

/** Whether the Code composer tools popover is visible. */
export function isComposerToolsPopoverOpen(): boolean {
  return isPopoverOpen(COMPOSER_POPOVER_IDS.popoverId);
}

/** Close the Code composer tools popover. */
export function closeComposerToolsPopover(): void {
  closeToolsPopover(COMPOSER_POPOVER_IDS);
}

/** Close the Chat app tools popover. */
export function closeChatAppToolsPopover(): void {
  closeToolsPopover(CHAT_APP_POPOVER_IDS);
}

/** Close every tools popover (composer + Chat app). */
export function closeAllToolsPopovers(): void {
  closeOtherToolsPopovers();
}

/** Wire Code composer tools button popover. */
export function initComposerToolsPopover(): void {
  initToolsPopover(COMPOSER_POPOVER_IDS);
}

/** Wire Chat app composer tools button popover. */
export function initChatAppToolsPopover(): void {
  initToolsPopover(CHAT_APP_POPOVER_IDS);
}

/** Close the desktop composer tools popover. */
export function closeDesktopToolsPopover(): void {
  closeToolsPopover(DESKTOP_POPOVER_IDS);
}

/** Wire desktop composer tools button popover. */
export function initDesktopToolsPopover(): void {
  initToolsPopover(DESKTOP_POPOVER_IDS);
}
