/**
 * Composer message queue UI — collapsible strip above the input while streaming (MIN-200).
 */

import {
  getPendingMessageQueue,
  getPendingMessageQueueCount,
  pushQueuedMessageNow,
  removeQueuedMessage,
} from '../chat/message-queue';
import { isChatTurnInProgress } from '../chat/chat-turn-guard';
import { isActiveChatStreaming } from '../chat/streaming-state';
import { getActiveChat } from '../state/sessions';
import { getActiveComposerSurface } from './composer-surface';
import { autoResize } from './input';
import { autoResizeDesktopComposer } from '../os/desktop-composer-resize';
import { setStatus } from './status';
import { refreshComposerStreamingAffordance } from './composer-send';

const COMPOSER_FOLLOW_UP_PLACEHOLDER = 'Add a follow-up';

const DEFAULT_PLACEHOLDERS: Record<string, string> = {
  msgInput: 'Type a message…',
  chatAppInput: 'Message Minnow…',
  desktopInput: 'What would you like to do today?',
};

let queueCollapsed = false;

interface QueueMountTarget {
  host: HTMLElement;
  before: ChildNode | null;
}

/** Resolve where the queue strip should mount for the active composer surface. */
export function resolveComposerQueueMount(
  inputEl: HTMLTextAreaElement | null = getActiveComposerSurface().inputEl,
): QueueMountTarget | null {
  if (!inputEl) return null;

  const before =
    inputEl.closest('.input-row') ??
    inputEl.closest('.chat-app-input') ??
    inputEl.closest('.mn-os-desktop-input-row') ??
    inputEl;

  const host = before.parentElement;
  if (!host) return null;
  return { host, before };
}

function mountQueueRoot(root: HTMLElement): void {
  const mount = resolveComposerQueueMount();
  if (!mount) {
    if (root.parentElement !== document.body) {
      document.body.appendChild(root);
    }
    return;
  }

  if (root.parentElement !== mount.host || root.nextSibling !== mount.before) {
    mount.host.insertBefore(root, mount.before);
  }
}

function ensureQueueRoot(): HTMLElement {
  let root = document.getElementById('composerMessageQueue');
  if (!root) {
    root = document.createElement('section');
    root.id = 'composerMessageQueue';
    root.className = 'composer-message-queue hidden';
    root.setAttribute('aria-label', 'Queued follow-up messages');
  }

  mountQueueRoot(root);
  return root;
}

function iconButton(
  className: string,
  label: string,
  svgInner: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = `<svg class="composer-message-queue__icon" viewBox="0 0 24 24" aria-hidden="true">${svgInner}</svg>`;
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick();
  });
  return btn;
}

const ICON_EDIT =
  '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>';
const ICON_PUSH =
  '<path d="M12 19V5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const ICON_TRASH =
  '<path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 6V4h8v2M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';

function loadQueueItemIntoComposer(text: string): void {
  const { inputEl } = getActiveComposerSurface();
  if (!inputEl) return;
  inputEl.value = text;
  inputEl.focus();
  if (inputEl.id === 'desktopInput') {
    autoResizeDesktopComposer(inputEl);
  } else {
    autoResize(inputEl);
  }
}

function renderQueueItem(item: { id: string; text: string }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'composer-message-queue__item';
  row.dataset.queueId = item.id;

  const status = document.createElement('span');
  status.className = 'composer-message-queue__status';
  status.setAttribute('aria-hidden', 'true');
  row.appendChild(status);

  const text = document.createElement('span');
  text.className = 'composer-message-queue__text';
  text.textContent = item.text;
  text.title = item.text;
  row.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'composer-message-queue__actions';

  actions.appendChild(
    iconButton('composer-message-queue__action', 'Edit queued message', ICON_EDIT, () => {
      const chat = getActiveChat();
      if (!removeQueuedMessage(chat, item.id)) return;
      loadQueueItemIntoComposer(item.text);
      setStatus('ok', 'Edit queued message and send again');
      syncComposerMessageQueue();
    }),
  );

  actions.appendChild(
    iconButton('composer-message-queue__action', 'Push now', ICON_PUSH, () => {
      const chat = getActiveChat();
      if (!pushQueuedMessageNow(chat, item.id)) return;
      setStatus('ok', isChatTurnInProgress(chat.id) ? 'Steering at next step…' : 'Sending queued message…');
      refreshComposerStreamingAffordance();
      syncComposerMessageQueue();
    }),
  );

  actions.appendChild(
    iconButton('composer-message-queue__action', 'Delete queued message', ICON_TRASH, () => {
      const chat = getActiveChat();
      if (!removeQueuedMessage(chat, item.id)) return;
      syncComposerMessageQueue();
    }),
  );

  row.appendChild(actions);
  return row;
}

/** Show or hide the queued follow-up strip for the active streaming chat. */
export function syncComposerMessageQueue(): void {
  if (typeof document === 'undefined') return;

  const root = ensureQueueRoot();
  const chat = getActiveChat();
  const count = getPendingMessageQueueCount(chat);
  const show = count > 0;

  root.classList.toggle('hidden', !show);
  if (!show) {
    root.replaceChildren();
    syncComposerFollowUpPlaceholder(false);
    return;
  }

  syncComposerFollowUpPlaceholder(isActiveChatStreaming());

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'composer-message-queue__header';
  header.setAttribute('aria-expanded', queueCollapsed ? 'false' : 'true');

  const chevron = document.createElement('span');
  chevron.className = 'composer-message-queue__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = queueCollapsed ? '▸' : '▾';

  const label = document.createElement('span');
  label.className = 'composer-message-queue__count';
  label.textContent = `${count} Queued`;

  header.append(chevron, label);
  header.addEventListener('click', () => {
    queueCollapsed = !queueCollapsed;
    syncComposerMessageQueue();
  });

  const list = document.createElement('div');
  list.className = 'composer-message-queue__list';
  list.hidden = queueCollapsed;
  list.setAttribute('role', 'list');

  for (const item of getPendingMessageQueue(chat)) {
    list.appendChild(renderQueueItem(item));
  }

  root.replaceChildren(header, list);
}

/** Swap composer placeholder while follow-ups can be queued. */
export function syncComposerFollowUpPlaceholder(streaming: boolean): void {
  const { inputEl } = getActiveComposerSurface();
  if (!inputEl) return;

  const defaultText = DEFAULT_PLACEHOLDERS[inputEl.id] ?? inputEl.placeholder;
  if (!inputEl.dataset.defaultPlaceholder) {
    inputEl.dataset.defaultPlaceholder = defaultText;
  }

  inputEl.placeholder = streaming
    ? COMPOSER_FOLLOW_UP_PLACEHOLDER
    : inputEl.dataset.defaultPlaceholder;
}

/** Reset collapse state when switching chats (optional UX). */
export function resetComposerMessageQueueUi(): void {
  queueCollapsed = false;
}
