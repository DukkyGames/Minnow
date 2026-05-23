/**
 * Per-chat Reef widget LLM provider/model overrides (Settings → Modes → Reef).
 */

import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import {
  fillModelSelect,
  fillProviderSelect,
} from './settings-model-binding';

let providerSelectEl: HTMLSelectElement | null = null;
let modelSelectEl: HTMLSelectElement | null = null;

function getProviderSelect(): HTMLSelectElement | null {
  return providerSelectEl;
}

function getModelSelect(): HTMLSelectElement | null {
  return modelSelectEl;
}

/** Write reef widget provider/model from the mounted selects into the active chat. */
export function persistReefWidgetBindingFromUi(): void {
  const chat = getActiveChat();
  const providerSel = getProviderSelect();
  const modelSel = getModelSelect();
  chat.reefWidgetProviderId = providerSel?.value?.trim() || undefined;
  chat.reefWidgetModelId = modelSel?.value?.trim() || undefined;
  if (!chat.reefWidgetProviderId) chat.reefWidgetProviderId = undefined;
  if (!chat.reefWidgetModelId) chat.reefWidgetModelId = undefined;
  touchChat(chat);
  scheduleSaveSessions();
}

function appendSelectField(
  container: HTMLElement,
  labelText: string,
  selectId: string,
): HTMLSelectElement {
  const field = document.createElement('div');
  field.className = 'settings-field';

  const label = document.createElement('label');
  label.className = 'settings-field-label';
  label.htmlFor = selectId;
  label.textContent = labelText;

  const select = document.createElement('select');
  select.id = selectId;
  select.className = 'settings-select';

  field.appendChild(label);
  field.appendChild(select);
  container.appendChild(field);
  return select;
}

/** Mount widget LLM provider/model controls inside Settings → Modes → Reef. */
export function mountReefWidgetLlmSettings(container: HTMLElement): void {
  providerSelectEl = null;
  modelSelectEl = null;

  const wrap = document.createElement('div');
  wrap.id = 'reefWidgetSettings';
  wrap.className = 'settings-reef-widget-llm';

  wrap.appendChild(
    Object.assign(document.createElement('p'), {
      className: 'settings-field-hint',
      textContent:
        'Provider and model for widget callLLM in the active chat. Empty options use the chat default.',
    }),
  );

  providerSelectEl = appendSelectField(
    wrap,
    'Widget LLM provider',
    'reefWidgetProviderSelect',
  );
  modelSelectEl = appendSelectField(
    wrap,
    'Widget LLM model',
    'reefWidgetModelSelect',
  );

  container.appendChild(wrap);

  providerSelectEl.addEventListener('change', () => {
    const providerId = providerSelectEl?.value ?? '';
    void fillModelSelect(modelSelectEl!, providerId, '');
    persistReefWidgetBindingFromUi();
  });
  modelSelectEl.addEventListener('change', () => persistReefWidgetBindingFromUi());

  void syncReefWidgetSettingsFromActiveChat();
}

/** Refresh selects when the active chat changes (no-op until Reef row is expanded). */
export function syncReefWidgetSettingsFromActiveChat(): void {
  const providerSel = getProviderSelect();
  const modelSel = getModelSelect();
  if (!providerSel || !modelSel) return;

  const chat = getActiveChat();

  void (async () => {
    await fillProviderSelect(providerSel, chat.reefWidgetProviderId ?? chat.providerId ?? '', {
      includeEmptyOption: true,
    });
    const providerId =
      chat.reefWidgetProviderId ?? chat.providerId ?? providerSel.value ?? '';
    await fillModelSelect(modelSel, providerId, chat.reefWidgetModelId ?? '');
  })();
}
