/**
 * Chat search popover — fuzzy search across desktop and Code chats from the
 * sidebar / desktop rail search buttons. Results deep-link into the owning surface.
 */

import { searchChats, type ChatSearchResult } from '../chat/chat-search';
import { getChatsWorkspacePath, isChatsWorkspacePath } from '../lib/chats-workspace';
import { getDesktopWorkspacePath, isDesktopWorkspacePath } from '../lib/desktop-workspace';
import { sessionState } from '../state/sessions';
import type { Chat } from '../types';

/** True when the chat opens on the desktop chat surface (assistant or desktop sandbox). */
function isDesktopSurfaceChat(chat: Chat): boolean {
  const path = chat.workspacePath ?? '';
  return isChatsWorkspacePath(path) || isDesktopWorkspacePath(path);
}

let popoverEl: HTMLDivElement | null = null;
let anchorEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let resultsEl: HTMLDivElement | null = null;
let open = false;
let results: ChatSearchResult[] = [];
let activeIndex = -1;
let outsidePointerHandler: ((e: PointerEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

function detachGlobalListeners(): void {
  if (outsidePointerHandler) {
    document.removeEventListener('pointerdown', outsidePointerHandler, true);
    outsidePointerHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
}

/** Close the chat search popover if open. */
export function closeChatSearchPopover(): void {
  if (!open) return;
  open = false;
  detachGlobalListeners();
  anchorEl?.setAttribute('aria-expanded', 'false');
  anchorEl = null;
  inputEl = null;
  resultsEl = null;
  results = [];
  activeIndex = -1;
  popoverEl?.remove();
  popoverEl = null;
}

/** Whether the chat search popover is visible. */
export function isChatSearchPopoverOpen(): boolean {
  return open;
}

function positionPopover(anchor: HTMLElement, popover: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const popoverWidth = popover.offsetWidth || 320;

  let left = rect.left;
  left = Math.max(margin, Math.min(left, window.innerWidth - popoverWidth - margin));
  const top = Math.min(rect.bottom + 4, window.innerHeight - margin - 80);

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function attachGlobalListeners(): void {
  outsidePointerHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!popoverEl || !anchorEl) return;
    if (popoverEl.contains(target) || anchorEl.contains(target)) return;
    closeChatSearchPopover();
  };
  document.addEventListener('pointerdown', outsidePointerHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    closeChatSearchPopover();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

/** Foreground the surface that owns the chat (desktop assistant vs Code workspace). */
function openSearchResult(chat: Chat): void {
  const isDesktop = isDesktopSurfaceChat(chat);
  closeChatSearchPopover();
  void import('../os/chat-launch').then((m) => {
    if (isDesktop) {
      void m.launchChatWithThread(chat.id);
    } else {
      void m.launchCodeWithChat(chat.id);
    }
  });
}

function workspaceBasename(workspacePath: string): string {
  const normalized = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function setActiveIndex(next: number): void {
  if (!resultsEl) return;
  const rows = resultsEl.querySelectorAll<HTMLElement>('.chat-search-result');
  if (!rows.length) {
    activeIndex = -1;
    return;
  }
  activeIndex = Math.max(0, Math.min(next, rows.length - 1));
  rows.forEach((row, i) => {
    row.classList.toggle('is-active', i === activeIndex);
    row.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
  });
  rows[activeIndex].scrollIntoView({ block: 'nearest' });
}

function renderResults(query: string): void {
  if (!resultsEl) return;
  resultsEl.replaceChildren();
  activeIndex = -1;

  if (!query.trim()) {
    results = [];
    const hint = document.createElement('div');
    hint.className = 'chat-search-empty';
    hint.textContent = 'Type to search chat titles and messages';
    resultsEl.appendChild(hint);
    return;
  }

  results = searchChats(sessionState?.chats ?? [], query);
  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-search-empty';
    empty.textContent = 'No matching chats';
    resultsEl.appendChild(empty);
    return;
  }

  results.forEach((result, index) => {
    const { chat } = result;
    const isDesktop = isDesktopSurfaceChat(chat);

    const row = document.createElement('div');
    row.className = 'chat-search-result';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.dataset.chatId = chat.id;

    const head = document.createElement('div');
    head.className = 'chat-search-result__head';

    const badge = document.createElement('span');
    badge.className =
      'chat-search-result__badge' +
      (isDesktop ? ' chat-search-result__badge--chat' : ' chat-search-result__badge--code');
    badge.textContent = isDesktop ? 'Chat' : 'Code';
    head.appendChild(badge);

    const name = document.createElement('span');
    name.className = 'chat-search-result__name';
    name.textContent = chat.name;
    head.appendChild(name);

    if (!isDesktop && chat.workspacePath) {
      const ws = document.createElement('span');
      ws.className = 'chat-search-result__workspace';
      ws.textContent = workspaceBasename(chat.workspacePath);
      ws.title = chat.workspacePath;
      head.appendChild(ws);
    }

    row.appendChild(head);

    if (result.snippet) {
      const snippet = document.createElement('div');
      snippet.className = 'chat-search-result__snippet';
      snippet.textContent =
        result.matchedIn === 'message' && result.role === 'user'
          ? `You: ${result.snippet}`
          : result.snippet;
      row.appendChild(snippet);
    }

    row.addEventListener('click', () => openSearchResult(chat));
    row.addEventListener('pointerenter', () => setActiveIndex(index));
    resultsEl?.appendChild(row);
  });
}

function onInputKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActiveIndex(activeIndex + 1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActiveIndex(activeIndex - 1);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const target = results[activeIndex] ?? results[0];
    if (target) openSearchResult(target.chat);
  }
}

function buildPopover(): HTMLDivElement {
  const popover = document.createElement('div');
  popover.className = 'chat-search-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.setAttribute('aria-label', 'Search chats');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-search-input';
  input.placeholder = 'Search all chats…';
  input.setAttribute('aria-label', 'Search all chats');
  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('keydown', onInputKeydown);

  const list = document.createElement('div');
  list.className = 'chat-search-results';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Matching chats');

  popover.append(input, list);
  inputEl = input;
  resultsEl = list;
  return popover;
}

/** Open the chat search popover anchored to a sidebar / rail button. */
export function openChatSearchPopover(anchor: HTMLElement): void {
  closeChatSearchPopover();

  // Prime the sandbox path caches so results classify desktop vs Code chats.
  void getChatsWorkspacePath();
  void getDesktopWorkspacePath();

  popoverEl = buildPopover();
  document.body.appendChild(popoverEl);
  anchorEl = anchor;
  open = true;
  anchor.setAttribute('aria-expanded', 'true');

  renderResults('');
  positionPopover(anchor, popoverEl);
  attachGlobalListeners();

  requestAnimationFrame(() => inputEl?.focus());
}

/** Toggle the popover from its anchor button. */
export function toggleChatSearchPopover(anchor: HTMLElement): void {
  if (open && anchorEl === anchor) {
    closeChatSearchPopover();
    return;
  }
  openChatSearchPopover(anchor);
}
