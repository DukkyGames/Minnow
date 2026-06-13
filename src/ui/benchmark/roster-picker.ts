/**
 * Benchmark roster add row: provider + model selects from the live catalog.
 */

import { getActiveTargetFromDom } from '../../benchmark/roster.ts';
import { fillModelSelect, fillProviderSelect } from '../settings-model-binding.ts';

let pickerBound = false;

function getPickerElements(): {
  providerSelect: HTMLSelectElement;
  modelSelect: HTMLSelectElement;
} | null {
  const providerSelect = document.getElementById(
    'benchmarkRosterProvider',
  ) as HTMLSelectElement | null;
  const modelSelect = document.getElementById(
    'benchmarkRosterModel',
  ) as HTMLSelectElement | null;
  if (!providerSelect || !modelSelect) return null;
  return { providerSelect, modelSelect };
}

/** Populate provider/model dropdowns from Settings catalog APIs. */
export async function refreshBenchmarkRosterPicker(): Promise<void> {
  const els = getPickerElements();
  if (!els) return;
  const { providerSelect, modelSelect } = els;

  const active = getActiveTargetFromDom();
  const previousProvider = providerSelect.value || active?.providerId || '';
  const previousModel = modelSelect.value || active?.modelId || '';

  await fillProviderSelect(providerSelect, previousProvider, { includeEmptyOption: false });

  const providerId =
    providerSelect.value || providerSelect.options[0]?.value?.trim() || '';
  if (providerId) {
    providerSelect.value = providerId;
  }

  await fillModelSelect(modelSelect, providerId, previousModel, {
    includeEmptyOption: false,
  });
}

/** Wire provider change → model list refresh (once). */
export function initBenchmarkRosterPicker(): void {
  const els = getPickerElements();
  if (!els || pickerBound) return;
  pickerBound = true;

  const { providerSelect, modelSelect } = els;
  providerSelect.addEventListener('change', () => {
    void fillModelSelect(modelSelect, providerSelect.value, '', {
      includeEmptyOption: false,
    });
  });

  void refreshBenchmarkRosterPicker();
}

/** Read the roster picker selection, or null when incomplete. */
export function readBenchmarkRosterPickerSelection(): {
  providerId: string;
  modelId: string;
} | null {
  const els = getPickerElements();
  if (!els) return null;
  const providerId = els.providerSelect.value.trim();
  const modelId = els.modelSelect.value.trim();
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}
