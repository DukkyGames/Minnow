/**
 * Settings → Thinking — global default and thinking budget.
 */

import '../styles/settings-general.css';
import '../styles/settings-thinking.css';

import { isServerStorageMode } from '../config/storage-mode';
import { loadThinkingMeta, saveThinkingMeta } from '../config/thinking-meta';
import { detectLocalServer } from '../tools/client';
import { appendSettingsGroup, linkToSettingsSection } from './settings-layout';
import { appendSettingsOfflineHint, createSettingsActionsRow, createSettingsRadioRow } from './settings-controls';
import { buildThinkingBudgetFieldInputs } from './settings-thinking-budget-fields';
import { setStatus } from './status';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Render Settings → Thinking section. */
export async function renderThinkingSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Whether models show extended reasoning by default. Per-role overrides live under ',
    linkToSettingsSection('Routing', 'model-routing'),
    '; toggle per message in the composer.',
  );
  shell.appendChild(lead);

  const serverUp = await detectLocalServer();
  if (!isServerStorageMode() || !serverUp) {
    appendSettingsOfflineHint(
      shell,
      'Start with <code>npm start</code> to persist thinking defaults to <code>~/.minnow/config.json</code>. Values below use browser storage until then.',
      { searchKey: 'models.thinking' },
    );
  }

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const body = appendSettingsGroup(
    content,
    'Global default',
    'Applies to new chats and roles that inherit global settings.',
    'models.thinking',
    { emphasis: true },
  );

  const { row, getValue, setValue } = createSettingsRadioRow('Default thinking', {
    name: 'thinkingGlobal',
    searchKey: 'models.thinking.mode',
    description: 'When on, models that support reasoning expose chain-of-thought when the provider allows it.',
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
    searchKey: 'models.thinking.budget',
  });
  body.appendChild(budgetFields.root);

  const meta = await loadThinkingMeta();
  setValue(meta.defaultMode === 'off' ? 'off' : 'on');
  budgetFields.setValue(meta.thinkingBudgetTokens);

  body.appendChild(
    createSettingsActionsRow(
      [
        {
          label: 'Save global default',
          variant: 'primary',
          onClick: () => {
            void (async () => {
              const mode = getValue() === 'off' ? 'off' : 'on';
              const budgetRead = budgetFields.readValue();
              await saveThinkingMeta({
                defaultMode: mode,
                thinkingBudgetTokens: budgetRead === undefined ? null : budgetRead,
              });
              setStatus('ok', 'Global thinking default saved');
            })();
          },
        },
      ],
      { searchKey: 'models.thinking' },
    ),
  );
}
