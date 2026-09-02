/**
 * Issue type icons — defaults, picker catalog, and chip rendering.
 * Uses Flaticon Uicons solid-rounded glyphs (fi-sr-*).
 */

import type { TaxonomyItem } from './taxonomy';

/** Uicons class token (without the base `fi` class). */
export type IssueTypeIconClass = `fi-sr-${string}` | `fi-rr-${string}`;

export const ISSUE_TYPE_ICON_RE = /^fi-(?:rr|sr)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Built-in type ids mapped to their default glyphs. */
export const DEFAULT_ISSUE_TYPE_ICONS: Record<string, IssueTypeIconClass> = {
  bug: 'fi-sr-bug',
  task: 'fi-sr-list-check',
  idea: 'fi-sr-bulb',
  note: 'fi-sr-edit',
};

/** Curated icons users can pick for custom types in Settings → Issues. */
export const ISSUE_TYPE_ICON_PICKER: readonly IssueTypeIconClass[] = [
  'fi-sr-bug',
  'fi-sr-list-check',
  'fi-sr-bulb',
  'fi-sr-edit',
  'fi-sr-hammer',
  'fi-sr-wrench-simple',
  'fi-sr-band-aid',
  'fi-sr-flask',
  'fi-sr-code-branch',
  'fi-sr-terminal',
  'fi-sr-rocket',
  'fi-sr-sparkles',
  'fi-sr-star',
  'fi-sr-flag',
  'fi-sr-tags',
  'fi-sr-bookmark',
  'fi-sr-box',
  'fi-sr-layers',
  'fi-sr-puzzle-piece',
  'fi-sr-shield',
  'fi-sr-brain',
  'fi-sr-bolt',
  'fi-sr-clipboard-list',
  'fi-sr-note-sticky',
  'fi-sr-document',
  'fi-sr-folder',
  'fi-sr-calendar',
  'fi-sr-clock',
  'fi-sr-users',
] as const;

const PICKER_SET = new Set<string>(ISSUE_TYPE_ICON_PICKER);

/** True when the icon class is in the settings picker catalog. */
export function isIssueTypeIconClass(value: string): value is IssueTypeIconClass {
  return ISSUE_TYPE_ICON_RE.test(value) && PICKER_SET.has(value);
}

/** Resolve the glyph for a taxonomy type (stored icon, built-in default, or fallback). */
export function resolveIssueTypeIcon(typeId: string, item?: TaxonomyItem): IssueTypeIconClass {
  const stored = item?.icon?.trim();
  if (stored && isIssueTypeIconClass(stored)) return stored;
  return DEFAULT_ISSUE_TYPE_ICONS[typeId] ?? 'fi-sr-box';
}

/** Create a Uicons `<i>` element for an issue type glyph. */
export function createIssueTypeIconElement(
  iconClass: IssueTypeIconClass,
  options: { className?: string; size?: number } = {},
): HTMLElement {
  const el = document.createElement('i');
  const parts = ['fi', iconClass, 'icon-svg'];
  if (options.className) parts.push(options.className);
  el.className = parts.join(' ');
  el.setAttribute('aria-hidden', 'true');
  if (options.size != null) el.style.setProperty('--mn-icon-size', `${options.size}px`);
  return el;
}

/** Build a type badge (icon inside a tinted chip). */
export function createIssueTypeChip(
  typeId: string,
  item?: TaxonomyItem,
  options: { labeled?: boolean; className?: string } = {},
): HTMLElement {
  const chip = document.createElement('span');
  const extra = options.className ? ` ${options.className}` : '';
  chip.className = `issues-type-chip issues-type-chip--${typeId}${options.labeled ? '' : ' issues-row__type'}${extra}`;
  const label = item?.label ?? `${typeId} (unknown)`;
  chip.title = label;
  if (item?.color) chip.style.setProperty('--issues-chip-color', item.color);
  chip.classList.toggle('is-unknown', !item);
  chip.appendChild(
    createIssueTypeIconElement(resolveIssueTypeIcon(typeId, item), {
      className: 'issues-type-chip__icon',
      size: 14,
    }),
  );
  if (options.labeled) {
    const text = document.createElement('span');
    text.className = 'issues-type-chip__label';
    text.textContent = label;
    chip.appendChild(text);
  }
  return chip;
}
