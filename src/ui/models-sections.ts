/**
 * Lazy-render Models app section panels.
 */

import type { ModelsSectionId } from './models-page';
import { mountRecommendSection } from './models/recommend-panel';
import { mountInstalledSection } from './models/installed-panel';
import { mountModelsSettingsSection } from './models/models-settings-panel';
import { reparentSettingsSectionIntoModels } from './models/settings-reparent';
import { mountVoicePanel } from './models/voice-panel';

/** Map Models routing section ids to legacy settings section ids. */
const SETTINGS_SECTION_BY_MODELS: Partial<
  Record<ModelsSectionId, import('./settings-page-types').SettingsSectionId>
> = {
  providers: 'providers',
  routing: 'model-routing',
  sampler: 'sampler',
  thinking: 'thinking',
  usage: 'usage',
};

/** Render a Models section on first activation. */
export async function renderModelsSection(section: ModelsSectionId): Promise<void> {
  switch (section) {
    case 'recommend':
      await mountRecommendSection();
      break;
    case 'installed':
      mountInstalledSection();
      break;
    case 'settings':
      await mountModelsSettingsSection();
      break;
    case 'voice':
      mountVoicePanel();
      break;
    default: {
      const settingsId = SETTINGS_SECTION_BY_MODELS[section];
      if (settingsId) {
        await reparentSettingsSectionIntoModels(section, settingsId);
      }
      break;
    }
  }
}
