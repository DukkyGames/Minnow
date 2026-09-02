import { syncExpertRegistryFromServer } from '../chat/experts/registry';
import { loadExpertsConfig, saveExpertsConfig } from '../config/experts-config';
import { isDeveloperReleased } from '../os/app-registry';

/** Hide the legacy drawer Experts block when the app is not developer-released. */
export function syncExpertsSettingsSectionVisibility(): void {
  document
    .getElementById('expertsSection')
    ?.toggleAttribute('hidden', !isDeveloperReleased('experts'));
}

/** Refresh Experts empty state vs gallery when experts.enabled toggles. */
export async function refreshExpertsEnabledState(): Promise<void> {
  const config = await loadExpertsConfig();
  const empty = document.getElementById('expertsDisabled');
  const pickStep = document.querySelector('.experts-step--browse');
  if (!empty || !pickStep) return;
  if (config.enabled) {
    empty.classList.add('hidden');
    pickStep.classList.remove('hidden-by-disabled');
    await syncExpertRegistryFromServer();
    try {
      const hub = await import('./experts/experts-hub');
      hub.renderGallery();
    } catch {
    }
  } else {
    empty.classList.remove('hidden');
    pickStep.classList.add('hidden-by-disabled');
  }
}

/** Bind experts enabled checkbox in settings drawer. */
export async function bindExpertsSettingsCheckbox(): Promise<void> {
  syncExpertsSettingsSectionVisibility();
  if (!isDeveloperReleased('experts')) return;

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
