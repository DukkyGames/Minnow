/**
 * Settings → Rules: global standing instructions appended after the system prompt.
 */

import {
  loadUserRules,
  MAX_USER_RULES_BYTES,
  saveUserRules,
} from '../config/user-rules';
import { detectConfigServer } from '../config/storage-mode';
import { appendSettingsGroup } from './settings-layout';
import {
  appendSettingsOfflineHint,
  createSettingsActionsRow,
  createSettingsTextareaRow,
} from './settings-controls';
import { createSettingsToggleRow } from './settings-switch';

type StatusFn = (kind: 'ok' | 'err' | 'spin', message: string) => void;

/** Render user rules controls into a settings content mount. */
export async function renderRulesSettingsSection(
  mount: HTMLElement,
  setStatus: StatusFn,
): Promise<void> {
  mount.replaceChildren();

  const serverUp = await detectConfigServer();
  if (!serverUp) {
    appendSettingsOfflineHint(
      mount,
      'Start with <code>npm start</code> to persist rules to <code>~/.minnow/rules.json</code>. Edits are kept in this browser until then.',
      { searchKey: 'agents.rules.offline' },
    );
  }

  const rules = await loadUserRules();

  const group = appendSettingsGroup(
    mount,
    'User rules',
    'Applied on every parent chat send. Sub-agents do not inherit these instructions.',
    'agents.rules',
    { emphasis: true },
  );

  const { row: enabledRow, input: enabledInput } = createSettingsToggleRow(
    'Enable user rules',
    {
      id: 'settingsRulesEnabled',
      checked: rules.enabled,
      searchKey: 'agents.rules.enabled',
    },
  );
  group.appendChild(enabledRow);

  const { row: textRow, textarea } = createSettingsTextareaRow('Instructions', {
    id: 'settingsRulesText',
    value: rules.text,
    rows: 12,
    spellcheck: true,
    placeholder: 'e.g. Always use TypeScript strict mode. Prefer small diffs.',
    searchKey: 'agents.rules.text',
    description: `Up to ${MAX_USER_RULES_BYTES.toLocaleString()} bytes of UTF-8 text.`,
  });
  group.appendChild(textRow);

  const actions = createSettingsActionsRow(
    [
      {
        label: 'Save rules',
        variant: 'primary',
        onClick: () => {
          void (async () => {
            const text = textarea.value;
            const bytes = new TextEncoder().encode(text).length;
            if (bytes > MAX_USER_RULES_BYTES) {
              setStatus('err', `Rules text exceeds ${MAX_USER_RULES_BYTES} bytes`);
              return;
            }

            try {
              await saveUserRules({
                version: 1,
                enabled: enabledInput.checked,
                text,
              });
              const mode = await detectConfigServer();
              setStatus(
                'ok',
                mode === 'server'
                  ? 'User rules saved'
                  : 'Saved locally — start npm start to persist to disk',
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Save failed';
              setStatus('err', message);
            }
          })();
        },
      },
    ],
    { searchKey: 'agents.rules.save' },
  );
  mount.appendChild(actions);
}
