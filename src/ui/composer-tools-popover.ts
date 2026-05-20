/**
 * Composer toolbar tools button — quick off/ask/full permissions popover.
 */

import { loadToolConfigIntoDrawer } from '../tools/config';
import { openSettings } from './settings-page';

let popoverOpen = false;

/** Whether the composer tools popover is visible. */
export function isComposerToolsPopoverOpen(): boolean {
  return popoverOpen;
}

function getButton(): HTMLButtonElement | null {
  return document.getElementById('btnComposerTools') as HTMLButtonElement | null;
}

function getPopover(): HTMLElement | null {
  return document.getElementById('composerToolsPopover');
}

/** Close the popover and restore focus to the tools button. */
export function closeComposerToolsPopover(): void {
  const popover = getPopover();
  const button = getButton();
  if (!popover || popover.classList.contains('hidden')) {
    popoverOpen = false;
    return;
  }

  popover.classList.add('hidden');
  popoverOpen = false;
  button?.setAttribute('aria-expanded', 'false');

  button?.focus();
}

/** Open the popover and focus the first control inside. */
export function openComposerToolsPopover(): void {
  const popover = getPopover();
  const button = getButton();
  if (!popover || !button) return;

  loadToolConfigIntoDrawer(document);

  popover.classList.remove('hidden');
  popoverOpen = true;
  button.setAttribute('aria-expanded', 'true');

  const first = popover.querySelector<HTMLElement>(
    'select, input, button, [href], [tabindex]:not([tabindex="-1"])',
  );
  first?.focus();
}

/** Toggle popover visibility. */
function toggleComposerToolsPopover(): void {
  if (popoverOpen) {
    closeComposerToolsPopover();
    return;
  }
  openComposerToolsPopover();
}

/** Wire composer tools button, outside click, Escape, and settings link. */
export function initComposerToolsPopover(): void {
  const button = getButton();
  const popover = getPopover();
  const settingsLink = document.getElementById('composerToolsOpenSettings');

  if (!button || !popover) return;

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleComposerToolsPopover();
  });

  document.addEventListener('click', (event) => {
    if (!popoverOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (button.contains(target) || popover.contains(target)) return;
    closeComposerToolsPopover();
  });

  document.addEventListener('keydown', (event) => {
    if (!popoverOpen || event.key !== 'Escape') return;
    event.stopPropagation();
    closeComposerToolsPopover();
  });

  settingsLink?.addEventListener('click', () => {
    closeComposerToolsPopover();
    openSettings('tools');
  });
}
