/**
 * Shared provider/model &lt;select&gt; helpers for Settings (work agents, sub-agents, model routing, Reef).
 */

import { fetchModelsForProvider } from '../providers/fetch-models';
import { isProvidersApiAvailable, listProviders } from '../providers/store';

/** Label for empty model option (inherits active chat model at runtime). */
export const MODEL_SELECT_EMPTY_LABEL = '(use chat default)';

/** Populate model &lt;select&gt; for a provider (empty option = chat default). */
export async function fillModelSelect(
  select: HTMLSelectElement,
  providerId: string,
  selectedModelId: string,
): Promise<void> {
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = MODEL_SELECT_EMPTY_LABEL;
  select.appendChild(empty);

  if (!providerId || !isProvidersApiAvailable()) {
    select.disabled = true;
    return;
  }

  const { providers } = await listProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) {
    select.disabled = true;
    return;
  }

  select.disabled = true;
  select.innerHTML = '<option value="">Loading models…</option>';
  try {
    const controller = new AbortController();
    const models = await fetchModelsForProvider(provider, controller.signal);
    select.replaceChildren();
    select.appendChild(empty);
    for (const m of models) {
      if (m.type !== 'llm' && m.type !== 'vlm') continue;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      select.appendChild(opt);
    }
    select.value = selectedModelId || '';
    select.disabled = false;
  } catch {
    select.replaceChildren();
    select.appendChild(empty);
    select.disabled = false;
  }
}

/** Populate provider &lt;select&gt; with an optional empty “chat default” row. */
export async function fillProviderSelect(
  select: HTMLSelectElement,
  selectedId: string,
  options?: { includeEmptyOption?: boolean },
): Promise<void> {
  select.replaceChildren();
  if (options?.includeEmptyOption) {
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = MODEL_SELECT_EMPTY_LABEL;
    select.appendChild(defaultOpt);
  }

  if (!isProvidersApiAvailable()) {
    select.disabled = true;
    return;
  }

  const { providers } = await listProviders();
  for (const p of providers) {
    if (p.enabled === false) continue;
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label || p.id;
    select.appendChild(opt);
  }
  select.value = selectedId || '';
  select.disabled = false;
}

/** Append labeled provider + model selects; returns handles for wiring save handlers. */
export function appendProviderModelFields(
  container: HTMLElement,
  ids: { provider: string; model: string },
  labels?: { provider?: string; model?: string },
  layout?: 'stacked' | 'inline',
): { providerSelect: HTMLSelectElement; modelSelect: HTMLSelectElement } {
  const fieldClass =
    layout === 'inline' ? 'settings-field settings-field--inline' : 'settings-field';
  const providerField = document.createElement('div');
  providerField.className = fieldClass;
  const providerLabel = document.createElement('label');
  providerLabel.className = 'settings-field-label';
  providerLabel.htmlFor = ids.provider;
  providerLabel.textContent = labels?.provider ?? 'Provider';
  const providerSelect = document.createElement('select');
  providerSelect.id = ids.provider;
  providerSelect.className = 'settings-select';
  providerField.appendChild(providerLabel);
  providerField.appendChild(providerSelect);
  container.appendChild(providerField);

  const modelField = document.createElement('div');
  modelField.className = fieldClass;
  const modelLabel = document.createElement('label');
  modelLabel.className = 'settings-field-label';
  modelLabel.htmlFor = ids.model;
  modelLabel.textContent = labels?.model ?? 'Model';
  const modelSelect = document.createElement('select');
  modelSelect.id = ids.model;
  modelSelect.className = 'settings-select';
  modelField.appendChild(modelLabel);
  modelField.appendChild(modelSelect);
  container.appendChild(modelField);

  return { providerSelect, modelSelect };
}
