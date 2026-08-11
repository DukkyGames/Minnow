/**
 * Capability matrix — roster panel grouped by provider host band.
 */

import type { CapabilityMatrixRosterEntry } from '../../benchmark/capabilities/roster-store.ts';
import {
  groupRosterByHost,
  type CapabilityMatrixViewModel,
} from '../../benchmark/capabilities/view-model.ts';
import { fillModelSelect, fillProviderSelect } from '../settings-model-binding.ts';
import { mountAuxiliaryModelSelectCombobox } from '../model-select-picker.ts';
import { fetchModelsForAllProviders } from '../../providers/fetch-all-models.ts';
import { listProviders } from '../../providers/store.ts';
import { targetKeyFromTarget } from '../../benchmark/model-key.ts';
import { createSettingsActionsRow } from '../settings-controls';
import { setStatus } from '../status';

export type CapabilityRosterPanelOptions = {
  host: HTMLElement;
  roster: CapabilityMatrixRosterEntry[];
  onRosterChange: (next: CapabilityMatrixRosterEntry[]) => void | Promise<void>;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Paint roster groups and add/remove controls. */
export function renderCapabilityRosterPanel(options: CapabilityRosterPanelOptions): void {
  const { host, roster, onRosterChange } = options;
  host.replaceChildren();
  host.className = 'cap-matrix-roster';

  const groups = groupRosterByHost(roster);
  if (!groups.length) {
    host.appendChild(el('p', 'cap-matrix-roster__empty', 'No models in the roster yet.'));
  } else {
    for (const group of groups) {
      const section = el('details', 'cap-matrix-roster__group');
      section.open = true;
      const heading = el('summary', 'cap-matrix-roster__group-title', group.label);
      section.appendChild(heading);

      const list = el('ul', 'cap-matrix-roster__list');
      for (const entry of group.entries) {
        const item = el('li', 'cap-matrix-roster__item');
        const label = entry.label?.trim() || `${entry.providerId} / ${entry.modelId}`;
        const name = el('span', 'cap-matrix-roster__label', label);
        const remove = el('button', 'cap-matrix-roster__remove', 'Remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${label}`);
        remove.addEventListener('click', () => {
          const key = targetKeyFromTarget(entry);
          const next = roster.filter((row) => targetKeyFromTarget(row) !== key);
          void onRosterChange(next);
        });
        item.append(name, remove);
        list.appendChild(item);
      }
      section.appendChild(list);
      host.appendChild(section);
    }
  }

  const addRow = el('div', 'cap-matrix-roster__add');
  const providerSelect = el('select', 'cap-matrix-roster__provider');
  providerSelect.id = 'capMatrixRosterProvider';
  const modelSelect = el('select', 'cap-matrix-roster__model');
  modelSelect.id = 'capMatrixRosterModel';

  const providerWrap = el('label', 'cap-matrix-roster__field');
  providerWrap.append('Provider', providerSelect);
  const modelWrap = el('label', 'cap-matrix-roster__field');
  modelWrap.append('Model', modelSelect);
  addRow.append(providerWrap, modelWrap);

  void fillProviderSelect(providerSelect, '', { includeEmptyOption: false }).then(() => {
    const providerId = providerSelect.value;
    if (providerId) {
      void fillModelSelect(modelSelect, providerId, '', { includeEmptyOption: false }).then(() => {
        mountAuxiliaryModelSelectCombobox(modelSelect);
      });
    } else {
      mountAuxiliaryModelSelectCombobox(modelSelect);
    }
  });

  providerSelect.addEventListener('change', () => {
    void fillModelSelect(modelSelect, providerSelect.value, '', {
      includeEmptyOption: false,
    }).then(() => {
      mountAuxiliaryModelSelectCombobox(modelSelect);
    });
  });

  const actions = createSettingsActionsRow(
    [
      {
        label: 'Add model',
        variant: 'primary',
        onClick: () => {
          const providerId = providerSelect.value.trim();
          const modelId = modelSelect.value.trim();
          if (!providerId || !modelId) return;
          const key = targetKeyFromTarget({ providerId, modelId });
          if (roster.some((row) => targetKeyFromTarget(row) === key)) return;
          const next: CapabilityMatrixRosterEntry[] = [
            ...roster,
            { providerId, modelId, enabled: true },
          ];
          void onRosterChange(next);
        },
      },
      {
        label: 'Add all catalog models',
        variant: 'default',
        onClick: () => {
          void (async () => {
            try {
              setStatus('spin', 'Loading provider catalogs…');
              const { providers } = await listProviders();
              const enabled = providers.filter((p) => p.enabled !== false);
              const controller = new AbortController();
              const results = await fetchModelsForAllProviders(enabled, controller.signal);
              const existing = new Set(roster.map((row) => targetKeyFromTarget(row)));
              const additions: CapabilityMatrixRosterEntry[] = [];
              for (const result of results) {
                for (const model of result.models) {
                  const entry: CapabilityMatrixRosterEntry = {
                    providerId: result.provider.id,
                    modelId: model.id,
                    enabled: true,
                  };
                  const key = targetKeyFromTarget(entry);
                  if (existing.has(key)) continue;
                  existing.add(key);
                  additions.push(entry);
                }
              }
              if (!additions.length) {
                setStatus('ok', 'Roster already includes all catalog models');
                return;
              }
              await onRosterChange([...roster, ...additions]);
              setStatus('ok', `Added ${additions.length} model(s) to roster`);
            } catch (err) {
              setStatus('err', err instanceof Error ? err.message : 'Bulk add failed');
            }
          })();
        },
      },
    ],
    { searchKey: 'advanced.capabilityMatrix.roster.add' },
  );

  host.append(addRow, actions);
}

/** Short score chips for column headers (from view-model). */
export function formatColumnScore(score: number | null): string {
  if (score == null) return '—';
  return `${Math.round(score * 100)}%`;
}

export type { CapabilityMatrixViewModel };
