/**
 * Capture menus for the two surfaces that had no context menu at all.
 *
 * Chat messages and terminal output are where you most often notice something
 * worth filing, and until now right-clicking either did nothing. Both are bound
 * by delegation on the document so they survive re-renders, and both go through
 * the shared menu registry rather than growing their own menu vocabulary.
 *
 * Phase 2 of `documentation/plans/issues-app-v2.md`.
 */

import { openRegisteredMenu } from './menu-registry';
import { CAPTURE_MENU_KINDS } from './issue-capture';

/** Longest selection folded into a capture before it stops being useful. */
const MAX_SELECTION_CHARS = 8000;

function selectedText(): string {
  const selection = window.getSelection?.();
  const text = selection?.toString() ?? '';
  return text.trim() ? text.slice(0, MAX_SELECTION_CHARS) : '';
}

function closestMessage(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('.msg');
  return el instanceof HTMLElement ? el : null;
}

function messageText(el: HTMLElement): string {
  const bubble = el.querySelector('.msg-bubble');
  const text = (bubble?.textContent ?? el.textContent ?? '').trim();
  return text.slice(0, MAX_SELECTION_CHARS);
}

function onChatContextMenu(event: MouseEvent): void {
  const message = closestMessage(event.target);
  if (!message) return;

  // A selection inside the message is more specific than the whole message, so
  // it wins — right-clicking a highlighted stack trace should capture that,
  // not the entire assistant turn around it.
  const selection = selectedText();
  const text = selection || messageText(message);
  if (!text) return;

  event.preventDefault();
  openRegisteredMenu({
    label: 'Message actions',
    clientX: event.clientX,
    clientY: event.clientY,
    target: {
      kind: CAPTURE_MENU_KINDS.chatMessage,
      chatId: message.dataset.chatId ?? '',
      chatTitle: selection ? 'Selected text' : 'Chat message',
      text,
    },
  });
}

function onTerminalContextMenu(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  if (!event.target.closest('.terminal-xterm-host, .terminal-output')) return;

  const text = selectedText();
  // No selection means no capture worth offering; the native menu (copy/paste)
  // is more useful than an empty issue.
  if (!text) return;

  event.preventDefault();
  openRegisteredMenu({
    label: 'Terminal selection',
    clientX: event.clientX,
    clientY: event.clientY,
    target: { kind: CAPTURE_MENU_KINDS.terminalSelection, text },
  });
}

let bound = false;

/** Bind the delegated menus once. */
export function initCaptureSurfaceMenus(): void {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('contextmenu', onChatContextMenu);
  document.addEventListener('contextmenu', onTerminalContextMenu);
}

/** Reset module state (tests). */
export function resetCaptureSurfaceMenusForTests(): void {
  if (!bound) return;
  document.removeEventListener('contextmenu', onChatContextMenu);
  document.removeEventListener('contextmenu', onTerminalContextMenu);
  bound = false;
}
