/**
 * Settings UI for editor Intent mode (MIN-131).
 */

import {
  loadEditorIntentModeConfig,
  saveEditorIntentModeConfig,
  type EditorIntentModeConfig,
} from '../config/editor-intent-mode';
import { appendSettingsGroup } from './settings-layout';
import { createSettingsToggleRow } from './settings-switch';
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

function kbdKey(label: string): HTMLElement {
  return el('kbd', 'settings-editor-kbd', label);
}

function appendNumberSetting(
  mount: HTMLElement,
  label: string,
  id: string,
  value: number,
  min: number,
  max: number,
  step: number,
  suffix: string,
  onSave: (n: number) => void,
): void {
  const kv = el('dl', 'settings-kv settings-editor-debounce');
  kv.append(el('dt', 'settings-kv__term', label));
  const dd = el('dd', 'settings-kv__value');
  const wrap = el('span', 'settings-kv-input-wrap settings-editor-debounce__control');
  const input = document.createElement('input');
  input.type = 'number';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.className = 'settings-select settings-kv-input';
  input.setAttribute('aria-label', label);
  wrap.append(input, el('span', 'settings-kv-suffix', suffix));
  dd.append(wrap);
  kv.append(dd);
  input.addEventListener('change', () => {
    const raw = Number(input.value);
    const n = Number.isFinite(raw)
      ? Math.min(max, Math.max(min, Math.round(raw)))
      : value;
    input.value = String(n);
    onSave(n);
  });
  mount.append(kv);
}

/** Append Intent mode settings group into an existing Editor settings mount. */
export async function appendEditorIntentSettings(
  mount: HTMLElement,
  refresh: () => void,
): Promise<void> {
  const config = await loadEditorIntentModeConfig();
  renderIntentSettingsGroup(mount, config, refresh);
}

function renderIntentSettingsGroup(
  mount: HTMLElement,
  config: EditorIntentModeConfig,
  refresh: () => void,
): void {
  const group = appendSettingsGroup(
    mount,
    'Intent mode',
    'Type plain intent on a line; leave the line to resolve it in place. Uses the same model as inline completion and Quick Edit.',
  );

  const { row: defaultRow } = createSettingsToggleRow('Enable by default in new files', {
    checked: config.enabledByDefault,
    ariaLabel: 'Enable Intent mode by default when opening files',
    onChange: async (enabled) => {
      await saveEditorIntentModeConfig({ enabledByDefault: enabled });
      setStatus('ok', enabled ? 'Intent mode default on' : 'Intent mode default off');
      refresh();
    },
  });
  group.append(defaultRow);

  const { row: recheckRow } = createSettingsToggleRow('Auto-recheck stale lines', {
    checked: config.autoRecheckDefault,
    ariaLabel: 'Automatically re-resolve lines flagged stale after neighbor edits',
    onChange: async (enabled) => {
      await saveEditorIntentModeConfig({ autoRecheckDefault: enabled });
      setStatus('ok', enabled ? 'Auto-recheck on' : 'Auto-recheck off');
      refresh();
    },
  });
  group.append(recheckRow);

  group.append(
    el(
      'p',
      'settings-group__lead',
      'Auto-recheck lets the local model re-edit stale resolved lines. Off by default.',
    ),
  );

  const shortcuts = el('dl', 'settings-kv settings-editor-shortcuts');
  shortcuts.append(el('dt', 'settings-kv__term', 'Toggle Intent mode'));
  const toggleDd = el('dd', 'settings-kv__value');
  toggleDd.append(kbdKey('Ctrl'), document.createTextNode('+'), kbdKey('I'));
  shortcuts.append(toggleDd);
  shortcuts.append(el('dt', 'settings-kv__term', 'Resolve'));
  shortcuts.append(
    el('dd', 'settings-kv__value', 'Leave the line (Enter, move cursor, or blur)'),
  );
  shortcuts.append(el('dt', 'settings-kv__term', 'Revert'));
  shortcuts.append(el('dd', 'settings-kv__value', 'Click a resolved line or use Revert control'));
  group.append(shortcuts);

  appendNumberSetting(
    group,
    'Pause before blur resolve',
    'settingsIntentDebounceMs',
    config.debounceMs,
    200,
    2000,
    50,
    'ms',
    (ms) => {
      void saveEditorIntentModeConfig({ debounceMs: ms }).then(() => {
        setStatus('ok', 'Blur resolve delay saved');
        refresh();
      });
    },
  );

  appendNumberSetting(
    group,
    'Context window',
    'settingsIntentContextWindow',
    config.contextWindow,
    1,
    20,
    1,
    'lines',
    (n) => {
      void saveEditorIntentModeConfig({ contextWindow: n }).then(() => {
        setStatus('ok', 'Context window saved');
        refresh();
      });
    },
  );

  appendNumberSetting(
    group,
    'Recheck delay',
    'settingsIntentRecheckDelayMs',
    config.recheckDelayMs,
    200,
    5000,
    100,
    'ms',
    (ms) => {
      void saveEditorIntentModeConfig({ recheckDelayMs: ms }).then(() => {
        setStatus('ok', 'Recheck delay saved');
        refresh();
      });
    },
  );

  appendNumberSetting(
    group,
    'Max recheck passes',
    'settingsIntentMaxRecheckPasses',
    config.maxRecheckPasses,
    1,
    32,
    1,
    'passes',
    (n) => {
      void saveEditorIntentModeConfig({ maxRecheckPasses: n }).then(() => {
        setStatus('ok', 'Recheck budget saved');
        refresh();
      });
    },
  );
}
