/**
 * Anchored icon picker popover for Settings → Issues type rows.
 */

import {
  createIssueTypeIconElement,
  ISSUE_TYPE_ICON_PICKER,
  type IssueTypeIconClass,
} from '../issues/type-icons';

export interface IssueTypeIconPickerOptions {
  anchor: HTMLElement;
  value: IssueTypeIconClass;
  onSelect: (icon: IssueTypeIconClass) => void;
}

let popoverEl: HTMLDivElement | null = null;
let anchorEl: HTMLElement | null = null;
let open = false;
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

/** Close the type icon picker if open. */
export function closeIssueTypeIconPicker(): void {
  if (!open) return;
  open = false;
  detachGlobalListeners();
  anchorEl?.setAttribute('aria-expanded', 'false');
  anchorEl = null;
  popoverEl?.remove();
  popoverEl = null;
}

function positionPopover(anchor: HTMLElement, popover: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const popoverWidth = popover.offsetWidth || 280;
  const popoverHeight = popover.offsetHeight || 200;

  let top = rect.bottom + 4;
  if (top + popoverHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popoverHeight - 4);
  }

  let left = rect.left;
  left = Math.max(margin, Math.min(left, window.innerWidth - popoverWidth - margin));

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function attachGlobalListeners(): void {
  outsidePointerHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!popoverEl || !anchorEl) return;
    if (popoverEl.contains(target) || anchorEl.contains(target)) return;
    closeIssueTypeIconPicker();
  };
  document.addEventListener('pointerdown', outsidePointerHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    closeIssueTypeIconPicker();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

/** Open the icon grid anchored to a settings row button. */
export function openIssueTypeIconPicker(options: IssueTypeIconPickerOptions): void {
  closeIssueTypeIconPicker();

  const { anchor, value, onSelect } = options;
  anchorEl = anchor;
  open = true;
  anchor.setAttribute('aria-expanded', 'true');

  popoverEl = document.createElement('div');
  popoverEl.className = 'settings-issues-icon-picker';
  popoverEl.setAttribute('role', 'dialog');
  popoverEl.setAttribute('aria-label', 'Choose type icon');

  const grid = document.createElement('div');
  grid.className = 'settings-issues-icon-picker__grid';

  for (const iconClass of ISSUE_TYPE_ICON_PICKER) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-issues-icon-picker__option';
    btn.title = iconClass.replace(/^fi-(?:rr|sr)-/, '').replace(/-/g, ' ');
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', iconClass === value ? 'true' : 'false');
    btn.classList.toggle('is-selected', iconClass === value);
    btn.appendChild(
      createIssueTypeIconElement(iconClass, {
        className: 'settings-issues-icon-picker__glyph',
        size: 16,
      }),
    );
    btn.addEventListener('click', () => {
      onSelect(iconClass);
      closeIssueTypeIconPicker();
    });
    grid.appendChild(btn);
  }

  popoverEl.appendChild(grid);
  document.body.appendChild(popoverEl);
  positionPopover(anchor, popoverEl);
  attachGlobalListeners();
}

/** Button that shows the current icon and opens the picker on click. */
export function createIssueTypeIconPickerButton(
  value: IssueTypeIconClass,
  label: string,
  onSelect: (icon: IssueTypeIconClass) => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-issues-icon-btn';
  btn.title = 'Choose icon';
  btn.setAttribute('aria-label', `Icon for ${label}`);
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');

  const renderIcon = (iconClass: IssueTypeIconClass): void => {
    btn.replaceChildren(
      createIssueTypeIconElement(iconClass, {
        className: 'settings-issues-icon-btn__glyph',
        size: 16,
      }),
    );
  };

  renderIcon(value);
  btn.addEventListener('click', () => {
    openIssueTypeIconPicker({
      anchor: btn,
      value,
      onSelect: (icon) => {
        renderIcon(icon);
        onSelect(icon);
      },
    });
  });

  return btn;
}
