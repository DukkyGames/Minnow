/**
 * Shared thinking budget numeric input for Settings (global + per-agent overrides).
 */

import { clampThinkingBudgetTokens } from '../agents/thinking-types';

export interface ThinkingBudgetFieldInputs {
  root: HTMLElement;
  readValue: () => number | null | undefined;
  setValue: (value: number | null | undefined) => void;
}

/** Numeric input for thinking budget; blank = inherit, 0 = off. */
export function buildThinkingBudgetFieldInputs(
  initial: number | null | undefined,
  options?: { label?: string; hint?: string; placeholder?: string },
): ThinkingBudgetFieldInputs {
  const root = document.createElement('div');
  root.className = 'settings-model-row settings-thinking-budget-row';

  const label = document.createElement('label');
  label.className = 'settings-field-label';
  label.textContent = options?.label ?? 'Thinking budget (tokens)';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings-input settings-input--narrow';
  input.min = '0';
  input.step = '1';
  input.placeholder = options?.placeholder ?? 'Inherit';
  input.title = 'Approximate reasoning tokens (chars ÷ 4). Blank = inherit · 0 = off';

  const hint = document.createElement('p');
  hint.className = 'settings-field-hint';
  hint.textContent =
    options?.hint ?? 'Blank = inherit · 0 = off · min 512 when set';

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

  label.appendChild(input);
  root.appendChild(label);
  root.appendChild(hint);

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
  };
}
