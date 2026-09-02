import { clampThinkingBudgetTokens } from '../agents/thinking-types';

export interface ThinkingBudgetFieldInputs {
  root: HTMLElement;
  readValue: () => number | null | undefined;
  setValue: (value: number | null | undefined) => void;
  setDisabled: (disabled: boolean) => void;
}

/** Numeric input for thinking budget; blank = inherit (or off globally), 0 = off. */
export function buildThinkingBudgetFieldInputs(
  initial: number | null | undefined,
  options?: {
    label?: string;
    description?: string;
    hint?: string;
    placeholder?: string;
    searchKey?: string;
    layout?: 'stack' | 'row';
  },
): ThinkingBudgetFieldInputs {
  const layout = options?.layout ?? 'stack';
  const root = document.createElement('div');
  root.className =
    layout === 'row'
      ? 'settings-row settings-thinking-budget-row'
      : 'settings-model-row settings-thinking-budget-row';
  if (options?.searchKey) {
    root.dataset.settingsSearchKey = options.searchKey;
  }

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings-input settings-input--narrow';
  input.min = '0';
  input.step = '1';
  input.inputMode = 'numeric';
  if (layout === 'stack') {
    input.placeholder = options?.placeholder ?? 'Inherit';
  } else if (options?.placeholder) {
    input.placeholder = options.placeholder;
  }
  input.title = 'Approximate reasoning tokens (chars ÷ 4). Blank = inherit · 0 = off';

  const applyInitial = (value: number | null | undefined): void => {
    if (value === undefined || value === null) {
      input.value = '';
      return;
    }
    input.value = String(value);
  };
  applyInitial(initial);

  input.addEventListener('blur', () => {
    const raw = input.value.trim();
    if (!raw) {
      input.value = '';
      return;
    }
    const clamped = clampThinkingBudgetTokens(Number(raw));
    if (clamped === null) {
      input.value = '';
      return;
    }
    input.value = String(clamped);
  });

  const labelText = options?.label ?? 'Thinking budget (tokens)';

  if (layout === 'row') {
    const labelWrap = document.createElement('div');
    labelWrap.className = 'settings-row__label';

    const title = document.createElement('span');
    title.className = 'settings-row__title';
    title.textContent = labelText;
    labelWrap.appendChild(title);

    if (options?.description) {
      const desc = document.createElement('span');
      desc.className = 'settings-row__desc settings-thinking-budget-row__desc';
      desc.textContent = options.description;
      labelWrap.appendChild(desc);
    }

    const control = document.createElement('div');
    control.className = 'settings-row__control';
    control.appendChild(input);

    root.append(labelWrap, control);
  } else {
    const label = document.createElement('label');
    label.className = 'settings-field-label';
    label.textContent = labelText;

    const hint = document.createElement('p');
    hint.className = 'settings-field-hint';
    hint.textContent =
      options?.hint ?? 'Blank = inherit · 0 = off · min 10 when set';

    label.appendChild(input);
    root.appendChild(label);
    root.appendChild(hint);
  }

  const setDisabled = (disabled: boolean): void => {
    input.disabled = disabled;
    root.classList.toggle('is-disabled', disabled);
  };

  return {
    root,
    readValue: () => {
      const raw = input.value.trim();
      if (!raw) return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n)) return undefined;
      return clampThinkingBudgetTokens(n);
    },
    setValue: applyInitial,
    setDisabled,
  };
}
