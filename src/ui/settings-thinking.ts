/**
 * Settings → Thinking — global default and per-agent tri-state overrides.
 */

import {
  loadThinkingMeta,
  saveThinkingMeta,
} from '../config/thinking-meta';
import { appendSettingsCrosslinks, appendSettingsGroup } from './settings-layout';
import { createSettingsActionsRow, createSettingsRadioRow } from './settings-controls';
import { setStatus } from './status';

function mountGlobalThinkingBlock(mount: HTMLElement): void {
  const body = appendSettingsGroup(
    mount,
    'Global default',
    'Default for new chats and roles that inherit global settings. Override per role in Routing.',
    'thinking.global',
  );

  const { row, getValue, setValue } = createSettingsRadioRow('Default thinking', {
    name: 'thinkingGlobal',
    searchKey: 'thinking.global.mode',
    options: [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
  });
  body.appendChild(row);

  void loadThinkingMeta().then((meta) => {
    setValue(meta.defaultMode === 'off' ? 'off' : 'on');
  });

  body.appendChild(
    createSettingsActionsRow([
      {
        label: 'Save global default',
        onClick: () => {
          void (async () => {
            const mode = getValue() === 'off' ? 'off' : 'on';
            await saveThinkingMeta({ defaultMode: mode });
            setStatus('ok', 'Global thinking default saved');
          })();
        },
      },
    ]),
  );
}

/** Render Settings → Thinking section. */
export async function renderThinkingSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();
  mountGlobalThinkingBlock(mount);
  appendSettingsCrosslinks(mount, [{ label: 'Per-role overrides in Routing', sectionId: 'model-routing' }]);
}
