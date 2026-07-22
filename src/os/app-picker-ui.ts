/**
 * Shared selectable app cards for onboarding and Settings → Apps.
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

/** Build one keyboard-accessible app card (button). */
export function createAppPickerCard(options: AppPickerCardOptions): HTMLButtonElement {
  const { app, mode, selected, searchKey, onToggle } = options;
  const locked = mode === 'always-on';

  const card = el('button', 'mn-app-picker-card');
  card.type = 'button';
  card.dataset.appId = app.id;
  if (searchKey) card.dataset.settingsSearchKey = searchKey;

  if (locked) {
    card.classList.add('is-always-on', 'is-selected');
    card.setAttribute('aria-disabled', 'true');
    // Keep focusable so keyboard users can read the always-on state.
    card.tabIndex = 0;
  } else {
    card.classList.toggle('is-selected', selected);
    card.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }

  const ico = el('span', 'mn-app-picker-card__icon');
  ico.setAttribute('aria-hidden', 'true');
  ico.appendChild(createAppIcon(app.icon as 'code', { size: 28 }));
  card.appendChild(ico);

  const copy = el('div', 'mn-app-picker-card__copy');
  const head = el('div', 'mn-app-picker-card__head');
  head.appendChild(el('span', 'mn-app-picker-card__title', app.name));
  head.appendChild(
    el(
      'span',
      'mn-app-picker-card__state',
      locked ? 'Always on' : selected ? 'Selected' : 'Off',
    ),
  );
  copy.appendChild(head);
  copy.appendChild(el('p', 'mn-app-picker-card__desc', app.description));
  card.appendChild(copy);

  const label = locked
    ? `${app.name}, always on`
    : `${app.name}, ${selected ? 'selected' : 'not selected'}`;
  card.setAttribute('aria-label', label);

  if (!locked && onToggle) {
    card.addEventListener('click', () => {
      const next = !card.classList.contains('is-selected');
      card.classList.toggle('is-selected', next);
      card.setAttribute('aria-pressed', next ? 'true' : 'false');
      const state = card.querySelector('.mn-app-picker-card__state');
      if (state) state.textContent = next ? 'Selected' : 'Off';
      card.setAttribute('aria-label', `${app.name}, ${next ? 'selected' : 'not selected'}`);
      onToggle(app.id, next);
    });
  } else if (locked) {
    // Prevent accidental activation semantics for locked cards.
    card.addEventListener('click', (event) => {
      event.preventDefault();
    });
  }

  return card;
}

/** Render a labeled group of app picker cards into a host. */
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
  },
): HTMLElement {
  const group = el('section', 'mn-app-picker-group');
  group.appendChild(el('h3', 'mn-app-picker-group__title', options.title));
  if (options.description) {
    group.appendChild(el('p', 'mn-app-picker-group__desc', options.description));
  }

  const grid = el('div', 'mn-app-picker-grid');
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
