/**
 * One vocabulary for every secondary block in the Issues peek.
 *
 * A section is a single 28px header row — glyph, name, count, trailing icon
 * controls — and an optional body under it. An empty section is the header row
 * alone, so "nothing linked yet" costs one line instead of a heading, a
 * sentence, and a pair of buttons. Sections with content collapse, and that
 * choice is remembered across cards.
 */

import { createIcon, type IconName } from './icon';

/** localStorage map: section key → collapsed. */
export const ISSUES_PEEK_SECTIONS_STORAGE_KEY = 'minnow.issues.peekSections';

let collapsedCache: Record<string, boolean> | null = null;

function readCollapsed(): Record<string, boolean> {
  if (collapsedCache) return collapsedCache;
  const out: Record<string, boolean> = {};
  try {
    const raw = localStorage.getItem(ISSUES_PEEK_SECTIONS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'boolean') out[key] = value;
      }
    }
  } catch {
    /* private mode — this session still toggles in memory */
  }
  collapsedCache = out;
  return out;
}

function writeCollapsed(map: Record<string, boolean>): void {
  collapsedCache = map;
  try {
    localStorage.setItem(ISSUES_PEEK_SECTIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota — in-memory state still applies */
  }
}

/** Whether this section is currently folded away. */
export function isDetailSectionCollapsed(key: string): boolean {
  return readCollapsed()[key] === true;
}

function setDetailSectionCollapsed(key: string, collapsed: boolean): void {
  const map = { ...readCollapsed() };
  if (collapsed) map[key] = true;
  else delete map[key];
  writeCollapsed(map);
}

/** Test helper — drop persisted fold state. */
export function resetDetailSectionsForTests(): void {
  collapsedCache = null;
  try {
    localStorage.removeItem(ISSUES_PEEK_SECTIONS_STORAGE_KEY);
  } catch {
    /* nothing stored */
  }
}

export interface DetailIconButtonOptions {
  label: string;
  icon: IconName;
  onClick: (anchor: HTMLButtonElement) => void;
  disabled?: boolean;
  /** Tooltip; defaults to `label`. */
  title?: string;
  danger?: boolean;
  className?: string;
}

/** Square icon-only control used in section headers and on hover rows. */
export function createDetailIconButton(options: DetailIconButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = options.className
    ? `issues-detail__sec-btn ${options.className}`
    : 'issues-detail__sec-btn';
  if (options.danger) btn.classList.add('issues-detail__sec-btn--danger');
  btn.setAttribute('aria-label', options.label);
  btn.title = options.title ?? options.label;
  btn.disabled = Boolean(options.disabled);
  btn.appendChild(createIcon(options.icon, { size: 14 }));
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (btn.disabled) return;
    options.onClick(btn);
  });
  return btn;
}

export interface DetailTextButtonOptions {
  label: string;
  icon: IconName;
  onClick: (anchor: HTMLButtonElement) => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
  className?: string;
}

/** Labelled action with a leading glyph — the Git / Plan button vocabulary. */
export function createDetailTextButton(options: DetailTextButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  const classes = ['issues-btn', 'issues-detail__act'];
  if (options.primary) classes.push('issues-btn--primary');
  if (options.className) classes.push(options.className);
  btn.className = classes.join(' ');
  btn.disabled = Boolean(options.disabled);
  if (options.title) btn.title = options.title;
  btn.appendChild(createIcon(options.icon, { size: 13, className: 'issues-detail__act-icon' }));
  const text = document.createElement('span');
  text.textContent = options.label;
  btn.appendChild(text);
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    if (btn.disabled) return;
    options.onClick(btn);
  });
  return btn;
}

export interface DetailSectionOptions {
  /** Stable id for the persisted fold state. */
  key: string;
  icon: IconName;
  title: string;
  /** Rendered as a quiet pill beside the name when above zero. */
  count?: number;
  /** Fold control; ignored when the section has no body content. */
  collapsible?: boolean;
  /** Trailing header controls, left to right. */
  actions?: HTMLElement[];
  /** Extra class on the `<section>`. */
  className?: string;
}

export interface DetailSectionHandle {
  section: HTMLElement;
  /** Where content goes. Stays empty for a header-only section. */
  body: HTMLElement;
  head: HTMLElement;
}

/** Build the header row (and empty body) for one peek section. */
export function createDetailSection(options: DetailSectionOptions): DetailSectionHandle {
  const section = document.createElement('section');
  section.className = 'issues-detail__section issues-detail__section--rail';
  if (options.className) section.classList.add(options.className);
  section.dataset.section = options.key;

  const head = document.createElement('div');
  head.className = 'issues-detail__sec-head';

  const body = document.createElement('div');
  body.className = 'issues-detail__section-body';
  body.id = `issues-sec-${options.key}`;

  const collapsible = Boolean(options.collapsible);
  const label = document.createElement(collapsible ? 'button' : 'div');
  label.className = 'issues-detail__sec-label';
  if (label instanceof HTMLButtonElement) {
    label.type = 'button';
    label.setAttribute('aria-controls', body.id);
  }

  if (collapsible) {
    label.appendChild(
      createIcon('chevronDown', { size: 12, className: 'issues-detail__sec-chevron' }),
    );
  }
  label.appendChild(createIcon(options.icon, { size: 14, className: 'issues-detail__sec-icon' }));

  const title = document.createElement('h3');
  title.className = 'issues-detail__section-title';
  title.textContent = options.title;
  label.appendChild(title);

  if (options.count && options.count > 0) {
    const count = document.createElement('span');
    count.className = 'issues-detail__sec-count';
    count.textContent = String(options.count);
    label.appendChild(count);
  }

  head.appendChild(label);

  if (options.actions?.length) {
    const actions = document.createElement('div');
    actions.className = 'issues-detail__sec-actions';
    actions.append(...options.actions);
    head.appendChild(actions);
  }

  section.append(head, body);

  if (collapsible && label instanceof HTMLButtonElement) {
    const paint = (): void => {
      const collapsed = isDetailSectionCollapsed(options.key);
      section.classList.toggle('is-collapsed', collapsed);
      body.hidden = collapsed;
      label.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      label.title = collapsed ? `Show ${options.title}` : `Hide ${options.title}`;
    };
    label.addEventListener('click', () => {
      setDetailSectionCollapsed(options.key, !isDetailSectionCollapsed(options.key));
      paint();
    });
    paint();
  }

  return { section, body, head };
}
