/**
 * Per-chat Reef widget LLM provider/model overrides (Settings → Modes → Reef).
 */

import { fetchModelsForProvider } from '../providers/fetch-models';
import { isProvidersApiAvailable, listProviders } from '../providers/store';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';

let providerSelectEl: HTMLSelectElement | null = null;
let modelSelectEl: HTMLSelectElement | null = null;

function getProviderSelect(): HTMLSelectElement | null {
  return providerSelectEl;
}

function getModelSelect(): HTMLSelectElement | null {
  return modelSelectEl;
}

async function fillProviderSelect(selectedId: string): Promise<void> {
  const sel = getProviderSelect();
  if (!sel) return;

  sel.replaceChildren();
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '(use chat default)';
  sel.appendChild(defaultOpt);

  if (!isProvidersApiAvailable()) {
    sel.disabled = true;
    return;
  }

  const { providers } = await listProviders();
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label || p.id;
    sel.appendChild(opt);
  }
  sel.value = selectedId || '';
  sel.disabled = false;
}

async function fillModelSelectForProvider(
  providerId: string,
  selectedModelId: string,
): Promise<void> {
  const sel = getModelSelect();
  if (!sel) return;

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '(use chat default)';
  sel.replaceChildren();
  sel.appendChild(empty);

  if (!providerId || !isProvidersApiAvailable()) {
    sel.disabled = true;
    return;
  }

  const { providers } = await listProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) {
    sel.disabled = true;
    return;
  }

  sel.disabled = true;
  sel.innerHTML = '<option value="">Loading models…</option>';
  try {
    const controller = new AbortController();
    const models = await fetchModelsForProvider(provider, controller.signal);
    sel.replaceChildren();
    sel.appendChild(empty);
    for (const m of models) {
      if (m.type !== 'llm' && m.type !== 'vlm') continue;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      sel.appendChild(opt);
    }
    sel.value = selectedModelId || '';
    sel.disabled = false;
  } catch {
    sel.replaceChildren();
    sel.appendChild(empty);
    sel.disabled = false;
  }
}

function persistFromUi(): void {
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
    void fillModelSelectForProvider(providerId, '');
    persistFromUi();
  });
  modelSelectEl.addEventListener('change', () => persistFromUi());

  void syncReefWidgetSettingsFromActiveChat();
}

/** Refresh selects when the active chat changes (no-op until Reef row is expanded). */
export function syncReefWidgetSettingsFromActiveChat(): void {
  const providerSel = getProviderSelect();
  const modelSel = getModelSelect();
  if (!providerSel || !modelSel) return;

  const chat = getActiveChat();

  void (async () => {
    await fillProviderSelect(chat.reefWidgetProviderId ?? chat.providerId ?? '');
    const providerId =
      chat.reefWidgetProviderId ?? chat.providerId ?? providerSel.value ?? '';
    await fillModelSelectForProvider(providerId, chat.reefWidgetModelId ?? '');
  })();
}
