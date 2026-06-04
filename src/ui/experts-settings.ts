/**
 * Experts settings panel helpers (formerly in expert-select.ts).
 */

import { syncExpertRegistryFromServer } from '../chat/experts/registry';
import { loadExpertsConfig, saveExpertsConfig } from '../config/experts-config';

/** Hint payload after auto-routing on send (chat composer path). */
export interface ExpertHintContext {
  expertId: string | null;
  expertLabel: string | null;
}

/** Refresh Experts empty state vs picker grid when experts.enabled toggles. */
export async function refreshExpertsEnabledState(): Promise<void> {
  const config = await loadExpertsConfig();
  const empty =
    document.getElementById('expertsDisabled') ??
    document.getElementById('expertLabDisabled');
  const pickStep =
    document.querySelector('.experts-step--gallery') ??
    document.querySelector('.expert-lab-step--pick');
  if (!empty || !pickStep) return;
  if (config.enabled) {
    empty.classList.add('hidden');
    pickStep.classList.remove('hidden-by-disabled');
    await syncExpertRegistryFromServer();
    try {
      const hub = await import('./experts/experts-hub');
      hub.renderGallery();
    } catch {
      try {
        const lab = await import('./expert-lab-page');
        lab.renderExpertGrid();
      } catch {
        /* picker module not loaded */
      }
    }
  } else {
    empty.classList.remove('hidden');
    pickStep.classList.add('hidden-by-disabled');
  }
}

/** Bind experts enabled checkbox in settings drawer. */
export async function bindExpertsSettingsCheckbox(): Promise<void> {
  const checkbox = document.getElementById('expertsEnabled') as HTMLInputElement | null;
  if (!checkbox) return;

  const config = await loadExpertsConfig();
  checkbox.checked = config.enabled;

  if (checkbox.dataset.bound === '1') return;
  checkbox.dataset.bound = '1';

  checkbox.addEventListener('change', () => {
    void saveExpertsConfig({ enabled: checkbox.checked }).then(() => refreshExpertsEnabledState());
  });
}
