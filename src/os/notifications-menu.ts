/**
 * OS menubar notifications popover — lists background app alerts with unread counts.
 */

import { getAppById } from './app-registry';
import { createOsIcon } from './icons';
import {
  clearAllUnread,
  getInstanceSnapshot,
  subscribeInstances,
} from './instances';
import { closeOsModelChipMenu } from './model-chip-menu';
import { launchApp } from './router';
import type { AppInstance } from './types';

let panelEl: HTMLDivElement | null = null;
let listEl: HTMLUListElement | null = null;
let emptyEl: HTMLElement | null = null;
let clearBtn: HTMLButtonElement | null = null;
let anchorBell: HTMLButtonElement | null = null;
let menuOpen = false;
let outsideHandler: ((e: PointerEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;
let unsubInstances: (() => void) | null = null;

/** Instances with unread background messages, newest activity last in array order. */
function getUnreadInstances(): AppInstance[] {
  return getInstanceSnapshot().instances.filter((i) => i.unread > 0);
}

function truncateMessage(msg: string, max = 120): string {
  const trimmed = msg.trim();
  if (!trimmed) return '';
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function rebuildList(): void {
  if (!listEl || !emptyEl || !clearBtn) return;

  const unread = getUnreadInstances();
  listEl.replaceChildren();
  listEl.hidden = unread.length === 0;
  emptyEl.hidden = unread.length > 0;
  clearBtn.hidden = unread.length === 0;

  for (const inst of unread) {
    const app = getAppById(inst.appId);
    if (!app) continue;

    const li = document.createElement('li');
    li.className = 'mn-os-notif-item';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mn-os-notif-item__btn';
    btn.addEventListener('click', () => {
      launchApp(inst.appId);
      closeOsNotificationsMenu();
    });

    const icon = document.createElement('span');
    icon.className = 'mn-os-notif-item__icon';
    icon.appendChild(createOsIcon(app.icon as 'code', { size: 16 }));
    btn.appendChild(icon);

    const body = document.createElement('span');
    body.className = 'mn-os-notif-item__body';

    const head = document.createElement('span');
    head.className = 'mn-os-notif-item__head';

    const title = document.createElement('span');
    title.className = 'mn-os-notif-item__title';
    title.textContent = app.name;
    head.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'mn-os-notif-item__badge';
    badge.textContent = String(inst.unread);
    badge.setAttribute('aria-label', `${inst.unread} unread`);
    head.appendChild(badge);

    body.appendChild(head);

    const preview = document.createElement('span');
    preview.className = 'mn-os-notif-item__preview';
    const snippet = truncateMessage(inst.msg) || app.tag;
    preview.textContent = snippet;
    body.appendChild(preview);

    btn.appendChild(body);
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

function positionPanel(bell: HTMLButtonElement, panel: HTMLElement): void {
  const rect = bell.getBoundingClientRect();
  const margin = 8;
  panel.style.top = `${rect.bottom + 4}px`;
  panel.style.right = 'auto';

  const panelWidth = panel.offsetWidth || panel.getBoundingClientRect().width;
  let left = rect.right - panelWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
  panel.style.left = `${left}px`;
}

function detachGlobalListeners(): void {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler, true);
    outsideHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
}

/** Close the notifications popover. */
export function closeOsNotificationsMenu(): void {
  if (!menuOpen) return;
  menuOpen = false;
  detachGlobalListeners();
  panelEl?.classList.add('hidden');
  anchorBell?.setAttribute('aria-expanded', 'false');
  anchorBell?.classList.remove('is-open');
}

function attachGlobalListeners(): void {
  outsideHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!panelEl || !anchorBell) return;
    if (panelEl.contains(target) || anchorBell.contains(target)) return;
    closeOsNotificationsMenu();
  };
  document.addEventListener('pointerdown', outsideHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeOsNotificationsMenu();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

function ensurePanel(): HTMLDivElement {
  if (panelEl) return panelEl;

  panelEl = document.createElement('div');
  panelEl.id = 'osNotificationsMenu';
  panelEl.className = 'mn-os-notif-menu hidden';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-label', 'Notifications');

  const header = document.createElement('div');
  header.className = 'mn-os-notif-menu__header';

  const title = document.createElement('span');
  title.className = 'mn-os-notif-menu__title';
  title.textContent = 'Notifications';
  header.appendChild(title);

  clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'mn-os-notif-menu__clear';
  clearBtn.textContent = 'Mark all read';
  clearBtn.hidden = true;
  clearBtn.addEventListener('click', () => {
    clearAllUnread();
    rebuildList();
  });
  header.appendChild(clearBtn);

  listEl = document.createElement('ul');
  listEl.className = 'mn-os-notif-menu__list';
  listEl.setAttribute('role', 'list');

  emptyEl = document.createElement('div');
  emptyEl.className = 'mn-os-notif-menu__empty';
  emptyEl.hidden = true;

  const emptyIcon = document.createElement('span');
  emptyIcon.className = 'mn-os-notif-menu__empty-icon';
  emptyIcon.appendChild(createOsIcon('bell', { size: 22 }));
  emptyEl.appendChild(emptyIcon);

  const emptyText = document.createElement('p');
  emptyText.className = 'mn-os-notif-menu__empty-text';
  emptyText.textContent = 'No new notifications';
  emptyEl.appendChild(emptyText);

  const emptyHint = document.createElement('p');
  emptyHint.className = 'mn-os-notif-menu__empty-hint';
  emptyHint.textContent = 'Background agents will appear here when they finish work.';
  emptyEl.appendChild(emptyHint);

  panelEl.append(header, listEl, emptyEl);
  document.body.appendChild(panelEl);
  return panelEl;
}

function openMenu(): void {
  const bell = anchorBell;
  if (!bell) return;
  closeOsModelChipMenu();
  const panel = ensurePanel();
  rebuildList();
  menuOpen = true;
  panel.classList.remove('hidden');
  bell.setAttribute('aria-expanded', 'true');
  bell.classList.add('is-open');
  positionPanel(bell, panel);
  attachGlobalListeners();
}

function toggleMenu(): void {
  if (menuOpen) closeOsNotificationsMenu();
  else openMenu();
}

/** Wire the menubar bell to open the notifications popover. Returns cleanup. */
export function initOsNotificationsMenu(bell: HTMLButtonElement): () => void {
  anchorBell = bell;

  bell.setAttribute('aria-haspopup', 'dialog');
  bell.setAttribute('aria-expanded', 'false');
  bell.setAttribute('aria-controls', 'osNotificationsMenu');

  const onBellClick = () => toggleMenu();
  bell.addEventListener('click', onBellClick);

  unsubInstances = subscribeInstances(() => {
    if (menuOpen) rebuildList();
  });

  return () => {
    bell.removeEventListener('click', onBellClick);
    unsubInstances?.();
    unsubInstances = null;
    closeOsNotificationsMenu();
    panelEl?.remove();
    panelEl = null;
    listEl = null;
    emptyEl = null;
    clearBtn = null;
    anchorBell = null;
  };
}
