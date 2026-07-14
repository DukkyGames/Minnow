/**
 * Settings → Thinking — global default and per-agent tri-state overrides.
 */

import {
  loadThinkingMeta,
  saveThinkingMeta,
} from '../config/thinking-meta';
import { appendSettingsCrosslinks, appendSettingsGroup } from './settings-layout';
import { createSettingsActionsRow, createSettingsRadioRow } from './settings-controls';
import { buildThinkingBudgetFieldInputs } from './settings-thinking-budget-fields';
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

  const budgetFields = buildThinkingBudgetFieldInputs(null, {
    label: 'Default thinking budget (tokens)',
    placeholder: 'Off',
    hint: 'Blank = off globally · 0 = off · approximate (chars ÷ 4)',
  });
  body.appendChild(budgetFields.root);

  void loadThinkingMeta().then((meta) => {
    setValue(meta.defaultMode === 'off' ? 'off' : 'on');
    budgetFields.setValue(meta.thinkingBudgetTokens);
  });

  body.appendChild(
    createSettingsActionsRow([
      {
        label: 'Save global default',
        onClick: () => {
          void (async () => {
            const mode = getValue() === 'off' ? 'off' : 'on';
            const budgetRead = budgetFields.readValue();
            await saveThinkingMeta({
              defaultMode: mode,
              thinkingBudgetTokens:
                budgetRead === undefined ? null : budgetRead,
            });
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
