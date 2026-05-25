/**
 * Settings → Providers: list, set active, add, edit, and remove LLM backends.
 */

import { isServerStorageMode } from '../config/storage-mode';
import { getDefaultPaths, pathsForProvider } from '../providers/paths';
import type { ApiKind, AuthStyle, ProviderPublic } from '../providers/types';
import {
  createProvider,
  deleteProvider,
  isProvidersApiAvailable,
  listProviders,
  setActiveProvider,
  updateProvider,
  updateProviderSecrets,
} from '../providers/store';
import { loadProviderSelect } from './settings';
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

function parseApiKind(select: HTMLSelectElement | null): ApiKind {
  return select?.value === 'openai-v1' ? 'openai-v1' : 'lm-studio-v0';
}

function parseAuthStyle(select: HTMLSelectElement | null): AuthStyle {
  if (select?.value === 'api-key') return 'api-key';
  if (select?.value === 'x-api-key') return 'x-api-key';
  return 'bearer';
}

/** Read models/chat paths from a provider form; paths must start with /. */
function parsePathFields(
  form: ParentNode,
): { modelsPath: string; chatCompletionsPath: string } | { error: string } {
  const models =
    form.querySelector<HTMLInputElement>('input[name="modelsPath"]')?.value.trim() ?? '';
  const chat =
    form.querySelector<HTMLInputElement>('input[name="chatCompletionsPath"]')?.value.trim() ??
    '';
  if (!models || !chat) {
    return { error: 'Models path and chat completions path are required.' };
  }
  if (!models.startsWith('/') || !chat.startsWith('/')) {
    return { error: 'Paths must start with / (e.g. /v1/models).' };
  }
  return { modelsPath: models, chatCompletionsPath: chat };
}

/** Set models/chat path inputs from apiKind defaults. */
function fillPathInputs(form: ParentNode, apiKind: ApiKind): void {
  const defaults = getDefaultPaths(apiKind);
  const modelsInput = form.querySelector<HTMLInputElement>('input[name="modelsPath"]');
  const chatInput = form.querySelector<HTMLInputElement>('input[name="chatCompletionsPath"]');
  if (modelsInput) modelsInput.value = defaults.modelsPath;
  if (chatInput) chatInput.value = defaults.chatCompletionsPath;
}

/** When API style changes, refresh paths if they still match the previous kind's defaults. */
function wirePathSyncOnApiKindChange(form: HTMLElement, kindSel: HTMLSelectElement): void {
  kindSel.dataset.prevApiKind = kindSel.value;
  kindSel.addEventListener('change', () => {
    const prevKind =
      kindSel.dataset.prevApiKind === 'openai-v1' ? 'openai-v1' : 'lm-studio-v0';
    const modelsInput = form.querySelector<HTMLInputElement>('input[name="modelsPath"]');
    const chatInput = form.querySelector<HTMLInputElement>('input[name="chatCompletionsPath"]');
    if (!modelsInput || !chatInput) return;

    const prevDefaults = getDefaultPaths(prevKind);
    const models = modelsInput.value.trim();
    const chat = chatInput.value.trim();
    const matchesPrevDefaults =
      models === prevDefaults.modelsPath && chat === prevDefaults.chatCompletionsPath;

    if (!models || !chat || matchesPrevDefaults) {
      fillPathInputs(form, parseApiKind(kindSel));
    }
    kindSel.dataset.prevApiKind = kindSel.value;
  });
}

/** Append models + chat path inputs after API kind row. */
function appendPathFields(
  parent: HTMLElement,
  modelsPath: string,
  chatCompletionsPath: string,
): void {
  const row = el('div', 'field-row');

  const modelsField = el('div', 'field');
  modelsField.append(el('label', undefined, 'Models path'));
  const modelsInput = document.createElement('input');
  modelsInput.type = 'text';
  modelsInput.className = 'settings-input';
  modelsInput.name = 'modelsPath';
  modelsInput.required = true;
  modelsInput.autocomplete = 'off';
  modelsInput.spellcheck = false;
  modelsInput.value = modelsPath;
  modelsField.append(modelsInput);
  row.append(modelsField);

  const chatField = el('div', 'field');
  chatField.append(el('label', undefined, 'Chat completions path'));
  const chatInput = document.createElement('input');
  chatInput.type = 'text';
  chatInput.className = 'settings-input';
  chatInput.name = 'chatCompletionsPath';
  chatInput.required = true;
  chatInput.autocomplete = 'off';
  chatInput.spellcheck = false;
  chatInput.value = chatCompletionsPath;
  chatField.append(chatInput);
  row.append(chatField);

  parent.append(row);
  parent.append(
    el(
      'p',
      'field-hint',
      'Appended to base URL. OpenCode Go: /zen/go/v1/models and /zen/go/v1/chat/completions.',
    ),
  );
}

/** Append API kind + auth style selects; returns the kind select for path sync wiring. */
function appendApiFields(
  parent: HTMLElement,
  apiKind: ApiKind,
  authStyle: AuthStyle,
): HTMLSelectElement {
  const row = el('div', 'field-row');

  const kindField = el('div', 'field');
  kindField.append(el('label', undefined, 'API style'));
  const kindSel = document.createElement('select');
  kindSel.className = 'settings-select';
  kindSel.name = 'apiKind';
  for (const opt of [
    { value: 'lm-studio-v0', label: 'LM Studio v0 (/api/v0/...)' },
    { value: 'openai-v1', label: 'OpenAI v1 (/v1/...)' },
  ]) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    kindSel.appendChild(o);
  }
  kindSel.value = apiKind;
  kindField.append(kindSel);
  row.append(kindField);

  const authField = el('div', 'field');
  authField.append(el('label', undefined, 'Auth header'));
  const authSel = document.createElement('select');
  authSel.className = 'settings-select';
  authSel.name = 'authStyle';
  for (const opt of [
    { value: 'bearer', label: 'Bearer token' },
    { value: 'api-key', label: 'Authorization: Api-Key' },
    { value: 'x-api-key', label: 'X-Api-Key' },
  ]) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    authSel.appendChild(o);
  }
  authSel.value = authStyle;
  authField.append(authSel);
  row.append(authField);

  parent.append(row);
  return kindSel;
}

/** Persist optional API key after profile create/update. */
async function saveApiKeyIfProvided(
  providerId: string,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!apiKey) return { ok: true };
  return updateProviderSecrets(providerId, { apiKey });
}

/** Inline edit form for one provider (submitted via list delegation). */
function buildProviderEditForm(provider: ProviderPublic): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'settings-providers-form settings-providers-edit-form';
  form.dataset.providerId = provider.id;
  form.noValidate = true;

  const resolved = pathsForProvider(provider);

  const idField = el('div', 'field');
  idField.append(el('label', undefined, 'Provider id'));
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.className = 'settings-input';
  idInput.value = provider.id;
  idInput.readOnly = true;
  idInput.setAttribute('aria-readonly', 'true');
  idField.append(idInput);
  form.append(idField);

  const labelField = el('div', 'field');
  labelField.append(el('label', undefined, 'Display name'));
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'settings-input';
  labelInput.name = 'label';
  labelInput.required = true;
  labelInput.autocomplete = 'off';
  labelInput.value = provider.label;
  labelField.append(labelInput);
  form.append(labelField);

  const urlField = el('div', 'field');
  urlField.append(el('label', undefined, 'Base URL'));
  const baseUrlInput = document.createElement('input');
  baseUrlInput.type = 'url';
  baseUrlInput.className = 'settings-input';
  baseUrlInput.name = 'baseUrl';
  baseUrlInput.required = true;
  baseUrlInput.autocomplete = 'off';
  baseUrlInput.spellcheck = false;
  baseUrlInput.value = provider.baseUrl;
  urlField.append(baseUrlInput);
  form.append(urlField);

  const kindSel = appendApiFields(form, provider.apiKind, provider.authStyle ?? 'bearer');
  appendPathFields(form, resolved.modelsPath, resolved.chatCompletionsPath);
  wirePathSyncOnApiKindChange(form, kindSel);

  const keyField = el('div', 'field');
  keyField.append(el('label', undefined, 'API key'));
  const apiKeyInput = document.createElement('input');
  apiKeyInput.type = 'password';
  apiKeyInput.className = 'settings-input';
  apiKeyInput.name = 'apiKey';
  apiKeyInput.autocomplete = 'off';
  apiKeyInput.placeholder = provider.hasApiKey
    ? 'Leave blank to keep current key'
    : 'Optional';
  keyField.append(apiKeyInput);
  const keyHint = el(
    'p',
    'field-hint',
    provider.hasApiKey ? 'A key is saved on the server (not shown here).' : 'No API key saved yet.',
  );
  keyField.append(keyHint);
  form.append(keyField);

  const enabledLabel = el('label', 'settings-toggle-row');
  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  enabledInput.name = 'enabled';
  enabledInput.checked = provider.enabled !== false;
  enabledLabel.append(enabledInput, el('span', undefined, 'Enabled'));
  form.append(enabledLabel);

  const err = el('p', 'settings-providers-form-error hidden');
  err.setAttribute('role', 'alert');
  err.dataset.providerEditError = provider.id;
  form.append(err);

  const actions = el('div', 'settings-providers-form-actions');
  const saveBtn = el('button', 'settings-action-btn', 'Save changes');
  saveBtn.type = 'submit';
  actions.append(saveBtn);
  form.append(actions);

  return form;
}

/** Build one provider row in the settings list. */
function createProviderSettingsRow(
  provider: ProviderPublic,
  activeProviderId: string,
  canRemove: boolean,
): HTMLElement {
  const row = el('article', 'settings-providers-row');
  row.setAttribute('role', 'listitem');
  row.dataset.providerId = provider.id;

  const resolved = pathsForProvider(provider);

  const head = el('div', 'settings-providers-row-head');
  const title = el('span', 'settings-providers-name');
  title.textContent = provider.label;
  head.append(title);

  const idMeta = el('span', 'settings-providers-id', provider.id);
  head.append(idMeta);

  if (provider.enabled === false) {
    head.append(el('span', 'settings-badge settings-badge--muted', 'Disabled'));
  }

  if (provider.id === activeProviderId) {
    head.append(el('span', 'settings-badge', 'Active'));
  } else if (provider.enabled !== false) {
    const activeBtn = el('button', 'settings-inline-btn', 'Set active');
    activeBtn.type = 'button';
    activeBtn.dataset.providerSetActive = provider.id;
    activeBtn.setAttribute('aria-label', `Set ${provider.label} as active provider`);
    head.append(activeBtn);
  }

  if (canRemove) {
    const removeBtn = el('button', 'settings-inline-btn settings-providers-remove', 'Remove');
    removeBtn.type = 'button';
    removeBtn.dataset.providerRemove = provider.id;
    removeBtn.setAttribute('aria-label', `Remove ${provider.label}`);
    head.append(removeBtn);
  }

  row.append(head);

  const detail = el('div', 'settings-providers-detail');
  detail.append(el('p', 'settings-field-hint', provider.baseUrl));
  detail.append(
    el(
      'p',
      'settings-field-hint',
      `${resolved.modelsPath} · ${resolved.chatCompletionsPath}`,
    ),
  );
  const kindLine = el(
    'p',
    'settings-field-hint',
    `API: ${provider.apiKind}${provider.hasApiKey ? ' · API key set' : ''}`,
  );
  detail.append(kindLine);
  row.append(detail);

  const editPanel = document.createElement('details');
  editPanel.className = 'settings-providers-edit-panel';
  const editSummary = el('summary', 'settings-providers-edit-summary', 'Edit provider');
  editPanel.append(editSummary);
  editPanel.append(buildProviderEditForm(provider));
  row.append(editPanel);

  return row;
}

function clearProvidersAddForm(): void {
  const form = document.getElementById('settingsProvidersAddForm') as HTMLFormElement | null;
  form?.reset();
  const enabled = document.getElementById('settingsProvidersAddEnabled') as HTMLInputElement | null;
  if (enabled) enabled.checked = true;
  const apiKind = document.getElementById('settingsProvidersAddApiKind') as HTMLSelectElement | null;
  if (apiKind) apiKind.value = 'lm-studio-v0';
  const authStyle = document.getElementById('settingsProvidersAddAuthStyle') as HTMLSelectElement | null;
  if (authStyle) authStyle.value = 'bearer';
  if (form) fillPathInputs(form, 'lm-studio-v0');
  if (apiKind) apiKind.dataset.prevApiKind = 'lm-studio-v0';
  const err = document.getElementById('settingsProvidersAddError');
  err?.classList.add('hidden');
  if (err) err.textContent = '';
}

let providersAddFormBound = false;
let providersListActionsBound = false;

/** Wire add-provider form submit once. */
function bindProvidersAddForm(): void {
  if (providersAddFormBound) return;
  providersAddFormBound = true;

  const form = document.getElementById('settingsProvidersAddForm') as HTMLFormElement | null;
  const errEl = document.getElementById('settingsProvidersAddError');
  const resetBtn = document.getElementById('settingsProvidersAddReset');
  const apiKindInput = document.getElementById('settingsProvidersAddApiKind') as HTMLSelectElement | null;

  if (form && apiKindInput) {
    fillPathInputs(form, parseApiKind(apiKindInput));
    wirePathSyncOnApiKindChange(form, apiKindInput);
  }

  resetBtn?.addEventListener('click', () => clearProvidersAddForm());

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const idInput = document.getElementById('settingsProvidersAddId') as HTMLInputElement | null;
      const labelInput = document.getElementById('settingsProvidersAddLabel') as HTMLInputElement | null;
      const baseUrlInput = document.getElementById('settingsProvidersAddBaseUrl') as HTMLInputElement | null;
      const apiKindSel = document.getElementById('settingsProvidersAddApiKind') as HTMLSelectElement | null;
      const authStyleInput = document.getElementById('settingsProvidersAddAuthStyle') as HTMLSelectElement | null;
      const apiKeyInput = document.getElementById('settingsProvidersAddApiKey') as HTMLInputElement | null;
      const enabledInput = document.getElementById('settingsProvidersAddEnabled') as HTMLInputElement | null;

      const id = idInput?.value.trim().toLowerCase() ?? '';
      const label = labelInput?.value.trim() ?? '';
      const baseUrl = baseUrlInput?.value.trim() ?? '';
      if (!id || !label || !baseUrl) {
        if (errEl) {
          errEl.textContent = 'Provider id, display name, and base URL are required.';
          errEl.classList.remove('hidden');
        }
        return;
      }

      const paths = form ? parsePathFields(form) : { error: 'Form not found' };
      if ('error' in paths) {
        if (errEl) {
          errEl.textContent = paths.error;
          errEl.classList.remove('hidden');
        }
        return;
      }

      const result = await createProvider({
        id,
        label,
        baseUrl,
        apiKind: parseApiKind(apiKindSel),
        authStyle: parseAuthStyle(authStyleInput),
        enabled: enabledInput?.checked !== false,
        modelsPath: paths.modelsPath,
        chatCompletionsPath: paths.chatCompletionsPath,
      });

      if (result.ok === false) {
        if (errEl) {
          errEl.textContent = result.error;
          errEl.classList.remove('hidden');
        }
        setStatus('err', result.error);
        return;
      }

      const secretResult = await saveApiKeyIfProvided(id, apiKeyInput?.value.trim() ?? '');
      if (secretResult.ok === false) {
        if (errEl) {
          errEl.textContent = `Provider added but API key failed: ${secretResult.error}`;
          errEl.classList.remove('hidden');
        }
        setStatus('err', secretResult.error);
        await renderProvidersSettingsSection();
        return;
      }

      if (errEl) errEl.classList.add('hidden');
      clearProvidersAddForm();
      setStatus('ok', `Added provider ${result.provider.label}`);
      await loadProviderSelect();
      await renderProvidersSettingsSection();

      void import('../providers/model-capabilities').then(({ runCapabilityProbeForProvider }) =>
        runCapabilityProbeForProvider(id),
      );
    })();
  });
}

/** Handle edit form submit for a single provider row. */
async function handleProviderEditSubmit(form: HTMLFormElement): Promise<void> {
  const id = form.dataset.providerId ?? '';
  const errEl = form.querySelector<HTMLElement>(`[data-provider-edit-error="${id}"]`);

  const labelInput = form.querySelector<HTMLInputElement>('input[name="label"]');
  const baseUrlInput = form.querySelector<HTMLInputElement>('input[name="baseUrl"]');
  const apiKindInput = form.querySelector<HTMLSelectElement>('select[name="apiKind"]');
  const authStyleInput = form.querySelector<HTMLSelectElement>('select[name="authStyle"]');
  const apiKeyInput = form.querySelector<HTMLInputElement>('input[name="apiKey"]');
  const enabledInput = form.querySelector<HTMLInputElement>('input[name="enabled"]');

  const label = labelInput?.value.trim() ?? '';
  const baseUrl = baseUrlInput?.value.trim() ?? '';
  if (!label || !baseUrl) {
    if (errEl) {
      errEl.textContent = 'Display name and base URL are required.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  const paths = parsePathFields(form);
  if ('error' in paths) {
    if (errEl) {
      errEl.textContent = paths.error;
      errEl.classList.remove('hidden');
    }
    return;
  }

  const result = await updateProvider(id, {
    label,
    baseUrl,
    apiKind: parseApiKind(apiKindInput),
    authStyle: parseAuthStyle(authStyleInput),
    enabled: enabledInput?.checked === true,
    modelsPath: paths.modelsPath,
    chatCompletionsPath: paths.chatCompletionsPath,
  });

  if (result.ok === false) {
    if (errEl) {
      errEl.textContent = result.error;
      errEl.classList.remove('hidden');
    }
    setStatus('err', result.error);
    return;
  }

  const secretResult = await saveApiKeyIfProvided(id, apiKeyInput?.value.trim() ?? '');
  if (secretResult.ok === false) {
    if (errEl) {
      errEl.textContent = `Saved profile but API key failed: ${secretResult.error}`;
      errEl.classList.remove('hidden');
    }
    setStatus('err', secretResult.error);
    await loadProviderSelect();
    await renderProvidersSettingsSection();
    return;
  }

  if (errEl) errEl.classList.add('hidden');
  setStatus('ok', `Updated provider ${result.provider.label}`);
  await loadProviderSelect();
  await renderProvidersSettingsSection();
}

/** Delegate set-active, remove, and edit-form submit on the provider list. */
function bindProvidersListActions(listEl: HTMLElement): void {
  if (providersListActionsBound) return;
  providersListActionsBound = true;

  listEl.addEventListener('submit', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) return;
    if (!target.classList.contains('settings-providers-edit-form')) return;
    event.preventDefault();
    void handleProviderEditSubmit(target);
  });

  listEl.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const activeId = target.dataset.providerSetActive;
    if (activeId) {
      void (async () => {
        try {
          await setActiveProvider(activeId);
          await loadProviderSelect();
          setStatus('ok', `Active provider: ${activeId}`);
          await renderProvidersSettingsSection();
        } catch {
          setStatus('err', 'Could not switch provider');
        }
      })();
      return;
    }

    const removeId = target.dataset.providerRemove;
    if (!removeId) return;

    void (async () => {
      if (!confirm(`Remove provider "${removeId}"? This deletes ~/.minnow/providers/${removeId}/.`)) {
        return;
      }
      const result = await deleteProvider(removeId);
      if (result.ok === false) {
        setStatus('err', result.error);
        return;
      }
      setStatus('ok', `Removed provider ${removeId}`);
      await loadProviderSelect();
      await renderProvidersSettingsSection();
    })();
  });
}

/** Refresh Settings → Providers list and offline/add panel visibility. */
export async function renderProvidersSettingsSection(): Promise<void> {
  const listEl = document.getElementById('settingsProvidersList');
  const offlineEl = document.getElementById('settingsProvidersOffline');
  const addPanel = document.getElementById('settingsProvidersAddPanel');
  if (!listEl) return;

  bindProvidersAddForm();
  bindProvidersListActions(listEl);
  listEl.replaceChildren();

  const online = isServerStorageMode() && isProvidersApiAvailable();
  offlineEl?.classList.toggle('hidden', online);
  addPanel?.classList.toggle('hidden', !online);

  if (!online) {
    listEl.appendChild(
      el(
        'p',
        'settings-section-note',
        'Start with npm start to register OpenAI-compatible and LM Studio backends.',
      ),
    );
    return;
  }

  const { providers, activeProviderId } = await listProviders();
  const canRemove = providers.length > 1;

  if (providers.length === 0) {
    listEl.appendChild(el('p', 'settings-section-note', 'No providers in ~/.minnow/providers/.'));
    return;
  }

  for (const provider of providers) {
    listEl.appendChild(createProviderSettingsRow(provider, activeProviderId, canRemove));
  }
}
