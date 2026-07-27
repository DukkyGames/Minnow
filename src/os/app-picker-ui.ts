/**
 * Shared app picker for onboarding and Settings → Apps.
 * Core apps collapse to a read-only note; optional apps use quiet toggle cards.
 */

import { createAppIcon } from './icons';
import type { AppDefinition } from './app-registry';
import type { AppId } from './types';

export type AppPickerCardMode = 'selectable' | 'always-on';

export interface AppPickerCardOptions {
  app: AppDefinition;
  mode: AppPickerCardMode;
  selected: boolean;
  /** Settings search key on the card root (optional). */
  searchKey?: string;
  onToggle?: (appId: AppId, selected: boolean) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Apply selected / off visuals and accessible names on a picker card. */
function syncCardState(card: HTMLButtonElement, appName: string, selected: boolean): void {
  card.classList.toggle('is-selected', selected);
  card.classList.toggle('is-off', !selected);
  card.setAttribute('aria-pressed', selected ? 'true' : 'false');
  card.setAttribute('aria-label', `${appName}, ${selected ? 'on' : 'off'}`);
}

/** Build one keyboard-accessible optional-app card (button). */
export function createAppPickerCard(options: AppPickerCardOptions): HTMLButtonElement {
  const { app, mode, selected, searchKey, onToggle } = options;
  const locked = mode === 'always-on';

  const card = el('button', 'mn-app-picker-card');
  card.type = 'button';
  card.dataset.appId = app.id;
  if (searchKey) card.dataset.settingsSearchKey = searchKey;

  if (locked) {
    // Legacy always-on cards (tests / rare hosts). Prefer appendAppPickerCoreNote.
    card.classList.add('is-always-on', 'is-selected');
    card.setAttribute('aria-disabled', 'true');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${app.name}, always on`);
  } else {
    syncCardState(card, app.name, selected);
  }

  const ico = el('span', 'mn-app-picker-card__icon');
  ico.setAttribute('aria-hidden', 'true');
  ico.appendChild(createAppIcon(app.icon as 'code'));
  card.appendChild(ico);

  const copy = el('div', 'mn-app-picker-card__copy');
  copy.appendChild(el('span', 'mn-app-picker-card__title', app.name));
  copy.appendChild(el('p', 'mn-app-picker-card__desc', app.description));
  card.appendChild(copy);

  if (!locked && onToggle) {
    card.addEventListener('click', () => {
      const next = !card.classList.contains('is-selected');
      syncCardState(card, app.name, next);
      onToggle(app.id, next);
    });
  } else if (locked) {
    card.addEventListener('click', (event) => {
      event.preventDefault();
    });
  }

  return card;
}

/**
 * Collapsed read-only line for always-on core apps.
 * Individual names keep settings search keys for the finder.
 */
export function appendAppPickerCoreNote(
  host: HTMLElement,
  options: {
    apps: readonly AppDefinition[];
    searchKeyFor?: (appId: AppId) => string | undefined;
  },
): HTMLElement {
  const note = el('p', 'mn-app-picker-core');
  note.appendChild(document.createTextNode('Always included: '));

  options.apps.forEach((app, index) => {
    if (index > 0) {
      note.appendChild(document.createTextNode(', '));
    }
    const name = el('span', 'mn-app-picker-core__name', app.name);
    const searchKey = options.searchKeyFor?.(app.id);
    if (searchKey) name.dataset.settingsSearchKey = searchKey;
    note.appendChild(name);
  });

  host.appendChild(note);
  return note;
}

/**
 * Empty-state note when no optional released apps are available to toggle yet.
 * Used by onboarding Choose your apps and Settings → Apps.
 */
export function appendAppPickerComingSoon(
  host: HTMLElement,
  options?: {
    title?: string;
    message?: string;
    searchKey?: string;
  },
): HTMLElement {
  const panel = el('div', 'mn-app-picker-coming-soon');
  panel.setAttribute('role', 'status');
  if (options?.searchKey) panel.dataset.settingsSearchKey = options.searchKey;

  panel.appendChild(
    el('p', 'mn-app-picker-coming-soon__title', options?.title ?? 'Coming soon'),
  );
  panel.appendChild(
    el(
      'p',
      'mn-app-picker-coming-soon__message',
      options?.message ??
        'More optional apps for the dock are on the way. You can turn them on here when they ship.',
    ),
  );

  host.appendChild(panel);
  return panel;
}

/** Sync every selectable card in a grid to match a selection predicate. */
function syncGridSelection(
  grid: HTMLElement,
  isSelected: (appId: AppId) => boolean,
): void {
  for (const node of grid.querySelectorAll<HTMLButtonElement>('.mn-app-picker-card[data-app-id]')) {
    const id = node.dataset.appId as AppId | undefined;
    if (!id || node.classList.contains('is-always-on')) continue;
    const title = node.querySelector('.mn-app-picker-card__title')?.textContent ?? id;
    syncCardState(node, title, isSelected(id));
  }
}

/** Render a labeled group of optional app picker cards into a host. */
export function appendAppPickerGroup(
  host: HTMLElement,
  options: {
    title: string;
    description?: string;
    apps: readonly AppDefinition[];
    mode: AppPickerCardMode;
    isSelected: (appId: AppId) => boolean;
    searchKeyFor?: (appId: AppId) => string | undefined;
    onToggle?: (appId: AppId, selected: boolean) => void;
    /** When true (default for selectable), show Enable all / Disable all. */
    showBulkActions?: boolean;
    /** Called after Enable all / Disable all updates the grid. */
    onBulkSet?: (selected: boolean) => void;
  },
): HTMLElement {
  const group = el('section', 'mn-app-picker-group');
  const head = el('div', 'mn-app-picker-group__head');
  const titles = el('div', 'mn-app-picker-group__titles');
  titles.appendChild(el('h3', 'mn-app-picker-group__title', options.title));
  if (options.description) {
    titles.appendChild(el('p', 'mn-app-picker-group__desc', options.description));
  }
  head.appendChild(titles);

  const grid = el('div', 'mn-app-picker-grid');
  const selectable = options.mode === 'selectable';
  const showBulk = selectable && options.showBulkActions !== false;

  if (showBulk) {
    const toolbar = el('div', 'mn-app-picker-toolbar');
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', `${options.title} bulk actions`);

    const enableAll = el('button', 'mn-app-picker-toolbar__btn', 'Enable all');
    enableAll.type = 'button';
    const disableAll = el('button', 'mn-app-picker-toolbar__btn', 'Disable all');
    disableAll.type = 'button';

    enableAll.addEventListener('click', () => {
      // Host updates prefs / working set first; then cards mirror isSelected.
      options.onBulkSet?.(true);
      syncGridSelection(grid, options.isSelected);
    });

    disableAll.addEventListener('click', () => {
      options.onBulkSet?.(false);
      syncGridSelection(grid, options.isSelected);
    });

    toolbar.append(enableAll, disableAll);
    head.appendChild(toolbar);
  }

  group.appendChild(head);

  for (const app of options.apps) {
    grid.appendChild(
      createAppPickerCard({
        app,
        mode: options.mode,
        selected: options.mode === 'always-on' ? true : options.isSelected(app.id),
        searchKey: options.searchKeyFor?.(app.id),
        onToggle: options.onToggle,
      }),
    );
  }
  group.appendChild(grid);
  host.appendChild(group);
  return group;
}
