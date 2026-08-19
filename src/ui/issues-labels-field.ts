/**
 * Inline issue label editor — add/remove chips with autocomplete from workspace labels.
 */

import {
  collectIssueLabelSuggestions,
  normalizeIssueLabel,
} from '../state/issues-store';

export type IssuesLabelsFieldOptions = {
  issueId: string;
  labels: string[];
  /** Legacy severity chip shown read-only beside labels. */
  severity?: string;
  variant: 'detail' | 'row';
  onChange: (labels: string[]) => void;
};

/** True when focus is inside a labels field (skip detail re-render while editing). */
export function isIssuesLabelsFieldFocused(): boolean {
  const active = document.activeElement;
  if (!active || typeof (active as { closest?: unknown }).closest !== 'function') return false;
  return Boolean((active as { closest: (s: string) => Element | null }).closest('.issues-labels-field'));
}

/** Filter workspace label suggestions for the inline editor menu. */
export function filterIssueLabelSuggestions(
  allSuggestions: readonly string[],
  currentLabels: readonly string[],
  query: string,
  limit = 10,
): string[] {
  const applied = new Set(currentLabels.map((label) => label.toLowerCase()));
  const needle = query.trim().toLowerCase();
  const out: string[] = [];
  for (const suggestion of allSuggestions) {
    if (applied.has(suggestion.toLowerCase())) continue;
    if (needle && !suggestion.toLowerCase().includes(needle)) continue;
    out.push(suggestion);
    if (out.length >= limit) break;
  }
  return out;
}

let openSuggestionsMenu: HTMLUListElement | null = null;
let openSuggestionsInput: HTMLInputElement | null = null;
let suggestionsRepositionHandler: (() => void) | null = null;

/** Close any open labels suggestion menu (body-mounted). */
export function closeIssuesLabelsSuggestionsMenu(): void {
  if (suggestionsRepositionHandler) {
    window.removeEventListener('resize', suggestionsRepositionHandler);
    window.removeEventListener('scroll', suggestionsRepositionHandler, true);
    suggestionsRepositionHandler = null;
  }
  openSuggestionsMenu?.remove();
  openSuggestionsMenu = null;
  openSuggestionsInput?.setAttribute('aria-expanded', 'false');
  openSuggestionsInput = null;
}

function positionSuggestionsMenu(anchor: HTMLElement, menu: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 4;
  const menuHeight = menu.offsetHeight || menu.getBoundingClientRect().height;
  const menuWidth = menu.offsetWidth || menu.getBoundingClientRect().width;

  let top = rect.bottom + gap;
  if (top + menuHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - menuHeight - gap);
  }

  let left = rect.left;
  if (left + menuWidth > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - menuWidth - margin);
  }

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

/** Deduplicate labels case-insensitively while preserving first-seen casing. */
export function normalizeIssueLabelsList(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = normalizeIssueLabel(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function buildLabelChip(label: string, onRemove: () => void): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'issues-label issues-label-chip';

  const text = document.createElement('span');
  text.className = 'issues-label-chip__text';
  text.textContent = label;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'issues-label-chip__remove';
  remove.setAttribute('aria-label', `Remove label ${label}`);
  remove.textContent = '×';
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    onRemove();
  });

  chip.append(text, remove);
  return chip;
}

/** Build an interactive labels field for list rows or the detail sticky header. */
export function createIssuesLabelsField(options: IssuesLabelsFieldOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = `issues-labels-field issues-labels-field--${options.variant}`;
  if (options.variant === 'detail') {
    root.classList.add('issues-detail__labels');
  } else {
    root.classList.add('issues-row__labels');
  }
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Labels');

  let currentLabels = normalizeIssueLabelsList(options.labels);
  let expanded = options.variant === 'detail';
  const suggestions = collectIssueLabelSuggestions(options.issueId);

  const chipsHost = document.createElement('div');
  chipsHost.className = 'issues-labels-field__chips';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'issues-labels-field__input';
  input.placeholder = options.variant === 'detail' ? 'Add label…' : 'Label…';
  input.setAttribute('aria-label', 'Add label');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  const suggestionsListId = `issues-labels-suggestions-${options.issueId}`;
  input.setAttribute('aria-controls', suggestionsListId);

  const suggestionsMenu = document.createElement('ul');
  suggestionsMenu.className = 'issues-labels-suggestions';
  suggestionsMenu.id = suggestionsListId;
  suggestionsMenu.setAttribute('role', 'listbox');
  suggestionsMenu.hidden = true;

  let visibleSuggestions: string[] = [];
  let activeSuggestionIndex = -1;

  const commit = (labels: string[]): void => {
    currentLabels = normalizeIssueLabelsList(labels);
    paint();
    options.onChange(currentLabels);
  };

  const removeLabel = (label: string): void => {
    const key = label.toLowerCase();
    commit(currentLabels.filter((entry) => entry.toLowerCase() !== key));
  };

  const addLabel = (raw: string): void => {
    const label = normalizeIssueLabel(raw);
    if (!label) return;
    const key = label.toLowerCase();
    if (currentLabels.some((entry) => entry.toLowerCase() === key)) {
      input.value = '';
      return;
    }
    commit([...currentLabels, label]);
    input.value = '';
    closeSuggestionsMenu();
    if (document.activeElement === input) refreshSuggestions();
  };

  const closeSuggestionsMenu = (): void => {
    if (openSuggestionsInput === input) {
      closeIssuesLabelsSuggestionsMenu();
    }
    suggestionsMenu.hidden = true;
    suggestionsMenu.replaceChildren();
    visibleSuggestions = [];
    activeSuggestionIndex = -1;
    input.setAttribute('aria-expanded', 'false');
  };

  const chooseSuggestion = (label: string): void => {
    addLabel(label);
    input.focus();
  };

  const paintSuggestionsMenu = (): void => {
    suggestionsMenu.replaceChildren();
    visibleSuggestions.forEach((label, index) => {
      const item = document.createElement('li');
      item.className = 'issues-labels-suggestions__item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === activeSuggestionIndex));
      item.classList.toggle('is-active', index === activeSuggestionIndex);
      item.textContent = label;
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        chooseSuggestion(label);
      });
      suggestionsMenu.appendChild(item);
    });

    const hasSuggestions = visibleSuggestions.length > 0;
    suggestionsMenu.hidden = !hasSuggestions;
    input.setAttribute('aria-expanded', String(hasSuggestions));

    if (!hasSuggestions) {
      if (openSuggestionsInput === input) closeIssuesLabelsSuggestionsMenu();
      return;
    }

    if (!suggestionsMenu.isConnected) {
      document.body.appendChild(suggestionsMenu);
    }
    if (openSuggestionsInput && openSuggestionsInput !== input) {
      closeIssuesLabelsSuggestionsMenu();
    }
    openSuggestionsMenu = suggestionsMenu;
    openSuggestionsInput = input;
    positionSuggestionsMenu(input, suggestionsMenu);

    if (!suggestionsRepositionHandler) {
      suggestionsRepositionHandler = () => {
        if (!openSuggestionsMenu || !openSuggestionsInput) return;
        positionSuggestionsMenu(openSuggestionsInput, openSuggestionsMenu);
      };
      window.addEventListener('resize', suggestionsRepositionHandler);
      window.addEventListener('scroll', suggestionsRepositionHandler, true);
    }
  };

  const refreshSuggestions = (): void => {
    visibleSuggestions = filterIssueLabelSuggestions(suggestions, currentLabels, input.value);
    activeSuggestionIndex = visibleSuggestions.length > 0 ? 0 : -1;
    paintSuggestionsMenu();
  };

  const paint = (): void => {
    chipsHost.replaceChildren();
    const collapsedLimit = 3;
    const visible =
      options.variant === 'row' && !expanded
        ? currentLabels.slice(0, collapsedLimit)
        : currentLabels;
    const hiddenCount =
      options.variant === 'row' && !expanded
        ? Math.max(0, currentLabels.length - collapsedLimit)
        : 0;

    for (const label of visible) {
      chipsHost.appendChild(buildLabelChip(label, () => removeLabel(label)));
    }

    if (hiddenCount > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'issues-label issues-labels-field__more';
      more.textContent = `+${hiddenCount}`;
      more.title = currentLabels.slice(collapsedLimit).join(', ');
      more.setAttribute('aria-label', `${hiddenCount} more labels`);
      more.addEventListener('click', (event) => {
        event.stopPropagation();
        expanded = true;
        paint();
        input.focus();
      });
      chipsHost.appendChild(more);
    }

    if (options.severity) {
      const severityChip = document.createElement('span');
      severityChip.className = 'issues-label issues-label--readonly';
      severityChip.textContent = options.severity;
      chipsHost.appendChild(severityChip);
    }

    root.classList.toggle('is-expanded', expanded);
  };

  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (!suggestionsMenu.hidden && visibleSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % visibleSuggestions.length;
        paintSuggestionsMenu();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeSuggestionIndex =
          activeSuggestionIndex <= 0
            ? visibleSuggestions.length - 1
            : activeSuggestionIndex - 1;
        paintSuggestionsMenu();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSuggestionsMenu();
        return;
      }
      if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
        event.preventDefault();
        chooseSuggestion(visibleSuggestions[activeSuggestionIndex]);
        return;
      }
    }
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addLabel(input.value);
      return;
    }
    if (event.key === 'Backspace' && input.value === '' && currentLabels.length > 0) {
      removeLabel(currentLabels[currentLabels.length - 1]);
    }
  });

  input.addEventListener('input', () => {
    refreshSuggestions();
  });

  input.addEventListener('focus', () => {
    if (options.variant === 'row') {
      expanded = true;
      paint();
    }
    refreshSuggestions();
  });

  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (root.contains(document.activeElement) || suggestionsMenu.contains(document.activeElement)) {
        return;
      }
      closeSuggestionsMenu();
      if (options.variant !== 'row') return;
      expanded = false;
      paint();
    }, 0);
  });

  for (const eventName of ['click', 'mousedown'] as const) {
    root.addEventListener(eventName, (event) => event.stopPropagation());
    input.addEventListener(eventName, (event) => event.stopPropagation());
  }

  root.addEventListener('click', () => {
    if (options.variant === 'row') {
      expanded = true;
      paint();
    }
    input.focus();
  });

  paint();
  root.append(chipsHost, input);
  return root;
}
