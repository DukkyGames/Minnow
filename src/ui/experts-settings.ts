/**
 * Experts settings panel helpers (formerly in expert-select.ts).
 */

import { listExperts } from '../chat/experts/registry';
import { loadExpertsConfig, saveExpertsConfig } from '../config/experts-config';

/** Hint payload after auto-routing on send (chat composer path). */
export interface ExpertHintContext {
  expertId: string | null;
  expertLabel: string | null;
}

/** Read-only expert id list for settings drawer. */
export function renderExpertsReadOnlyList(container: HTMLElement): void {
  container.replaceChildren();
  const ul = document.createElement('ul');
  ul.className = 'experts-id-list';
  for (const expert of listExperts()) {
    const li = document.createElement('li');
    li.textContent = expert.meta.id;
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

/** Bind experts enabled checkbox in settings drawer. */
export async function bindExpertsSettingsCheckbox(): Promise<void> {
  const checkbox = document.getElementById('expertsEnabled') as HTMLInputElement | null;
  const listHost = document.getElementById('expertsBuiltinList');
  if (!checkbox) return;

  const config = await loadExpertsConfig();
  checkbox.checked = config.enabled;

  if (listHost) renderExpertsReadOnlyList(listHost);

  if (checkbox.dataset.bound === '1') return;
  checkbox.dataset.bound = '1';

  checkbox.addEventListener('change', () => {
    void saveExpertsConfig({ enabled: checkbox.checked }).then(() => {
      void import('./expert-lab-page').then((m) => m.refreshExpertLabEnabledState());
    });
  });
}
