/**
 * Settings → Sampler — global defaults and per-agent overrides.
 */

import { loadSamplerMeta, saveSamplerMeta } from '../config/sampler-meta';
import { appendSettingsCrosslinks, appendSettingsGroup } from './settings-layout';
import { createSettingsActionsRow } from './settings-controls';
import { buildSamplerFieldInputs } from './settings-sampler-fields';
import { setStatus } from './status';

async function mountGlobalSamplerBlock(mount: HTMLElement): Promise<void> {
  const body = appendSettingsGroup(
    mount,
    'Global defaults',
    'Baseline temperature, penalties, and token limits for main chat. Override per role in Routing.',
    'sampler.global',
  );

  const meta = await loadSamplerMeta();
  const globalFields = buildSamplerFieldInputs(meta, {
    includeMaxTokens: true,
    emptyPlaceholder: '',
  });

  body.appendChild(globalFields.root);

  body.appendChild(
    createSettingsActionsRow([
      {
        label: 'Save global defaults',
        onClick: () => {
          void (async () => {
            const patch = globalFields.readPatch();
            if (!patch) {
              setStatus('err', 'Enter at least one global sampler value');
              return;
            }
            const next = await saveSamplerMeta(patch);
            globalFields.setValues(next);
            setStatus('ok', 'Global sampler defaults saved');
          })();
        },
      },
    ]),
  );
}

/** Render Settings → Sampler section. */
export async function renderSamplerSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();
  await mountGlobalSamplerBlock(mount);
  appendSettingsCrosslinks(mount, [{ label: 'Per-role overrides in Routing', sectionId: 'model-routing' }]);
}
