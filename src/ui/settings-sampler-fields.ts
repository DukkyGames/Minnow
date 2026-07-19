/**
 * Shared numeric inputs for sampler preset fields in Settings.
 */

import type { SamplerPreset } from '../agents/sampler-types';

export interface SamplerFieldInputs {
  root: HTMLElement;
  readPatch: () => SamplerPreset | null;
  /** Set all inputs from a preset (empty fields when null). */
  setValues: (preset: SamplerPreset | null | undefined) => void;
}

export interface BuildSamplerFieldInputsOptions {
  /** Show max output tokens (global defaults and sub-agent types). */
  includeMaxTokens?: boolean;
  /** Placeholder when empty (e.g. "Inherit" for per-agent overrides). */
  emptyPlaceholder?: string;
  /** Prefix for data-settings-search-key on each field (e.g. models.sampler). */
  searchKeyPrefix?: string;
}

const SEARCH_KEY_BY_FIELD: Record<keyof SamplerPreset, string> = {
  temperature: 'temperature',
  topP: 'topP',
  topK: 'topK',
  minP: 'minP',
  repetitionPenalty: 'repetitionPenalty',
  presencePenalty: 'presencePenalty',
  maxTokens: 'maxTokens',
};

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

/** Numeric inputs for sampler fields; empty inputs mean inherit (when placeholder set). */
export function buildSamplerFieldInputs(
  initial: SamplerPreset | null | undefined,
  options: BuildSamplerFieldInputsOptions = {},
): SamplerFieldInputs {
  const useGrid = Boolean(options.searchKeyPrefix);
  const root = el(
    'div',
    useGrid ? 'settings-sampler-grid' : 'settings-model-row settings-sampler-row',
  );
  const placeholder = options.emptyPlaceholder ?? 'Inherit';

  const fields: Array<{
    key: keyof SamplerPreset;
    label: string;
    step: string;
    min: string;
    max: string;
  }> = [
    { key: 'temperature', label: 'Temperature', step: '0.05', min: '0', max: '2' },
    { key: 'topP', label: 'Top P', step: '0.05', min: '0', max: '1' },
    { key: 'topK', label: 'Top K', step: '1', min: '1', max: '200' },
    { key: 'minP', label: 'Min P', step: '0.01', min: '0', max: '1' },
    {
      key: 'repetitionPenalty',
      label: 'Repeat penalty',
      step: '0.01',
      min: '1',
      max: '2',
    },
    {
      key: 'presencePenalty',
      label: 'Presence penalty',
      step: '0.1',
      min: '0',
      max: '2',
    },
  ];

  if (options.includeMaxTokens) {
    fields.push({
      key: 'maxTokens',
      label: 'Max tokens',
      step: '1',
      min: '1',
      max: '131072',
    });
  }

  const inputs = new Map<keyof SamplerPreset, HTMLInputElement>();

  const applyInitial = (preset: SamplerPreset | null | undefined): void => {
    for (const [key, input] of inputs) {
      const value = preset?.[key];
      input.value =
        value !== undefined && Number.isFinite(value) ? String(value) : '';
    }
  };

  for (const field of fields) {
    const inputId = options.searchKeyPrefix ? `sampler-${field.key}` : undefined;

    let mount: HTMLElement = root;

    if (useGrid) {
      const wrap = el('div', 'settings-sampler-field');
      if (options.searchKeyPrefix) {
        wrap.dataset.settingsSearchKey = `${options.searchKeyPrefix}.${SEARCH_KEY_BY_FIELD[field.key]}`;
      }
      const labelEl = el('label', 'settings-sampler-field__label', field.label);
      if (inputId) labelEl.htmlFor = inputId;
      mount = wrap;
      root.appendChild(wrap);
      mount.appendChild(labelEl);
    } else {
      root.appendChild(el('label', 'settings-field-label', field.label));
    }

    const input = document.createElement('input');
    input.type = 'number';
    input.className = useGrid
      ? 'settings-sampler-field__input'
      : 'settings-select settings-kv-input';
    if (inputId) input.id = inputId;
    input.step = field.step;
    input.min = field.min;
    input.max = field.max;
    input.placeholder = placeholder;
    inputs.set(field.key, input);
    mount.appendChild(input);
  }

  applyInitial(initial);

  const readPatch = (): SamplerPreset | null => {
    const patch: SamplerPreset = {};
    for (const [key, input] of inputs) {
      const raw = input.value.trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      if (key === 'temperature') patch.temperature = n;
      else if (key === 'topP') patch.topP = n;
      else if (key === 'topK') patch.topK = n;
      else if (key === 'minP') patch.minP = n;
      else if (key === 'repetitionPenalty') patch.repetitionPenalty = n;
      else if (key === 'presencePenalty') patch.presencePenalty = n;
      else if (key === 'maxTokens') patch.maxTokens = n;
    }
    return Object.keys(patch).length > 0 ? patch : null;
  };

  return { root, readPatch, setValues: applyInitial };
}
