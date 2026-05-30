/**
 * Settings UI for editor AI inline completion (POLISH-006).
 */

import {
  loadEditorAiCompletionConfig,
  saveEditorAiCompletionConfig,
} from '../config/editor-ai-completion';
import { isLocalServerAvailable } from '../tools/config';
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

/** Render editor AI completion controls inside the LSP settings section. */
export async function renderEditorAiSettingsSection(): Promise<void> {
  const mount = document.getElementById('settingsEditorAiMount');
  if (!mount) return;
  mount.replaceChildren();

  const heading = el('h3', 'settings-subheading', 'AI inline completion');
  mount.append(heading);

  const lead = el(
    'p',
    'settings-field-hint',
    'Copilot-style ghost text in the file editor. Tab accepts, Esc dismisses. Uses the active chat model unless overridden. Disabled for read-only excerpts.',
  );
  mount.append(lead);

  const online = isLocalServerAvailable();
  if (!online) {
    mount.append(
      el(
        'p',
        'field-hint',
        'Start with npm start to enable AI completions (requires a configured provider).',
      ),
    );
    return;
  }

  const config = await loadEditorAiCompletionConfig();

  const { row: enableRow, input: enableCb } = createSettingsToggleRow(
    'Enable AI inline completion',
    {
      checked: config.enabled,
      ariaLabel: 'Enable AI inline completion in the file editor',
      onChange: async (enabled) => {
        await saveEditorAiCompletionConfig({ enabled });
        setStatus('ok', enabled ? 'AI completion enabled' : 'AI completion disabled');
      },
    },
  );
  mount.append(enableRow);

  const debounceLabel = el('label', 'settings-field');
  debounceLabel.append(el('span', 'settings-field-label', 'Debounce (ms)'));
  const debounceInput = document.createElement('input');
  debounceInput.type = 'number';
  debounceInput.min = '200';
  debounceInput.max = '2000';
  debounceInput.step = '50';
  debounceInput.value = String(config.debounceMs);
  debounceInput.className = 'settings-input settings-input--narrow';
  debounceInput.addEventListener('change', () => {
    void saveEditorAiCompletionConfig({ debounceMs: Number(debounceInput.value) }).then(() => {
      setStatus('ok', 'Debounce saved');
    });
  });
  debounceLabel.append(debounceInput);
  mount.append(debounceLabel);

  const modelHint = el(
    'p',
    'settings-field-hint',
    config.useChatModel
      ? 'Model: active chat provider and model.'
      : 'Model: pinned provider override below.',
  );
  mount.append(modelHint);

  const providerLabel = el('label', 'settings-field');
  providerLabel.append(el('span', 'settings-field-label', 'Provider override (optional)'));
  const providerInput = document.createElement('input');
  providerInput.type = 'text';
  providerInput.className = 'settings-input';
  providerInput.placeholder = 'Leave empty for chat default';
  providerInput.value = config.providerId;
  providerInput.addEventListener('change', () => {
    void saveEditorAiCompletionConfig({
      providerId: providerInput.value.trim(),
      useChatModel: !providerInput.value.trim(),
    }).then(() => {
      setStatus('ok', 'Provider override saved');
      void renderEditorAiSettingsSection();
    });
  });
  providerLabel.append(providerInput);
  mount.append(providerLabel);

  const modelLabel = el('label', 'settings-field');
  modelLabel.append(el('span', 'settings-field-label', 'Model override (optional)'));
  const modelInput = document.createElement('input');
  modelInput.type = 'text';
  modelInput.className = 'settings-input';
  modelInput.placeholder = 'Leave empty for chat default';
  modelInput.value = config.modelId;
  modelInput.addEventListener('change', () => {
    void saveEditorAiCompletionConfig({ modelId: modelInput.value.trim() }).then(() => {
      setStatus('ok', 'Model override saved');
    });
  });
  modelLabel.append(modelInput);
  mount.append(modelLabel);
}
