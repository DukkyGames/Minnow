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
  const datalistId = `issues-labels-datalist-${options.issueId}`;
  input.setAttribute('list', datalistId);

  const datalist = document.createElement('datalist');
  datalist.id = datalistId;
  for (const suggestion of suggestions) {
    const opt = document.createElement('option');
    opt.value = suggestion;
    datalist.appendChild(opt);
  }

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
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addLabel(input.value);
      return;
    }
    if (event.key === 'Backspace' && input.value === '' && currentLabels.length > 0) {
      removeLabel(currentLabels[currentLabels.length - 1]);
    }
  });

  input.addEventListener('focus', () => {
    if (options.variant === 'row') {
      expanded = true;
      paint();
    }
  });

  input.addEventListener('blur', () => {
    if (options.variant !== 'row') return;
    window.setTimeout(() => {
      if (root.contains(document.activeElement)) return;
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
  root.append(chipsHost, input, datalist);
  return root;
}
