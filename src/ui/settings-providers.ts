/**
 * Settings → Providers: list, set active, add, edit, and remove LLM backends.
 */

import { isServerStorageMode } from '../config/storage-mode';
import { getDefaultPaths, pathsForProvider } from '../providers/paths';
import type { ApiKind, AuthStyle, ProviderPublic } from '../providers/types';
import {
  probeProviderCapabilities,
  readProviderCapabilities,
  structuredOutputBadge,
  type ProviderCapabilities,
} from '../providers/capability-probe';
import {
  createProvider,
  deleteProvider,
  isProvidersApiAvailable,
  listProviders,
  setActiveProvider,
  updateProvider,
  updateProviderSecrets,
} from '../providers/store';
import { normalizeModelPricingRates, normalizeProviderPricing } from '../usage/pricing';
import type { ProviderPricing } from '../usage/types';
import { loadProviderSelect } from './settings';
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

/** Optional per-model API pricing fields on provider edit form. */
function appendPricingFields(form: HTMLElement, pricing?: ProviderPricing): void {
  const details = document.createElement('details');
  details.className = 'settings-providers-pricing-panel';
  const summary = document.createElement('summary');
  summary.textContent = 'Model pricing (optional)';
  details.append(summary);

  const hint = el(
    'p',
    'field-hint',
    'USD per 1M tokens. Used for Usage & cost estimates; local providers can leave zeros.',
  );
  details.append(hint);

  const row = el('div', 'field-row');
  const inField = el('div', 'field');
  inField.append(el('label', undefined, 'Default input / 1M'));
  const inInput = document.createElement('input');
  inInput.type = 'number';
  inInput.min = '0';
  inInput.step = 'any';
  inInput.className = 'settings-input';
  inInput.name = 'pricingDefaultInput';
  inInput.value = String(pricing?.default?.inputPer1M ?? 0);
  inField.append(inInput);
  row.append(inField);

  const outField = el('div', 'field');
  outField.append(el('label', undefined, 'Default output / 1M'));
  const outInput = document.createElement('input');
  outInput.type = 'number';
  outInput.min = '0';
  outInput.step = 'any';
  outInput.className = 'settings-input';
  outInput.name = 'pricingDefaultOutput';
  outInput.value = String(pricing?.default?.outputPer1M ?? 0);
  outField.append(outInput);
  row.append(outField);
  details.append(row);

  const modelsField = el('div', 'field');
  modelsField.append(el('label', undefined, 'Per-model overrides (JSON)'));
  const modelsArea = document.createElement('textarea');
  modelsArea.className = 'settings-input settings-providers-pricing-json';
  modelsArea.name = 'pricingModelsJson';
  modelsArea.rows = 5;
  modelsArea.spellcheck = false;
  modelsArea.placeholder = '{"gpt-4o-mini":{"inputPer1M":0.15,"outputPer1M":0.6},"*":{"inputPer1M":1,"outputPer1M":3}}';
  if (pricing?.models && Object.keys(pricing.models).length > 0) {
    modelsArea.value = JSON.stringify(pricing.models, null, 2);
  }
  modelsField.append(modelsArea);
  details.append(modelsField);

  form.append(details);
}

function parsePricingFromForm(form: ParentNode): ProviderPricing | null | { error: string } {
  const inRaw = form.querySelector<HTMLInputElement>('input[name="pricingDefaultInput"]')?.value;
  const outRaw = form.querySelector<HTMLInputElement>('input[name="pricingDefaultOutput"]')?.value;
  const jsonRaw =
    form.querySelector<HTMLTextAreaElement>('textarea[name="pricingModelsJson"]')?.value.trim() ??
    '';

  const inputPer1M = Number(inRaw);
  const outputPer1M = Number(outRaw);
  if (!Number.isFinite(inputPer1M) || !Number.isFinite(outputPer1M)) {
    return { error: 'Default pricing must be valid numbers.' };
  }
  if (inputPer1M < 0 || outputPer1M < 0) {
    return { error: 'Default pricing cannot be negative.' };
  }

  let models: Record<string, { inputPer1M: number; outputPer1M: number }> | undefined;
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'Per-model pricing must be a JSON object.' };
      }
      models = {};
      for (const [key, value] of Object.entries(parsed)) {
        const rates = normalizeModelPricingRates(value);
        if (!rates) {
          return { error: `Invalid rates for model "${key}".` };
        }
        models[key] = rates;
      }
    } catch {
      return { error: 'Per-model pricing JSON is invalid.' };
    }
  }

  const hasDefault = inputPer1M > 0 || outputPer1M > 0;
  const hasModels = models && Object.keys(models).length > 0;
  if (!hasDefault && !hasModels) {
    return null;
  }

  const normalized = normalizeProviderPricing({
    currency: 'USD',
    default: { inputPer1M, outputPer1M },
    ...(hasModels ? { models } : {}),
  });
  if (!normalized) {
    return { error: 'Could not normalize pricing.' };
  }
  return normalized;
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

  const { row: enabledLabel, input: enabledInput } = createSettingsToggleRow('Enabled', {
    name: 'enabled',
    checked: provider.enabled !== false,
  });
  form.append(enabledLabel);

  const constrainedField = el('div', 'field');
  constrainedField.append(el('label', undefined, 'Constrained tool calls'));
  const constrainedSel = document.createElement('select');
  constrainedSel.className = 'settings-select';
  constrainedSel.name = 'constrainedToolCalls';
  for (const opt of [
    { value: 'inherit', label: 'Use global default' },
    { value: 'on', label: 'Enabled' },
    { value: 'off', label: 'Disabled' },
  ]) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    constrainedSel.appendChild(o);
  }
  if (provider.constrainedToolCalls === true) {
    constrainedSel.value = 'on';
  } else if (provider.constrainedToolCalls === false) {
    constrainedSel.value = 'off';
  } else {
    constrainedSel.value = 'inherit';
  }
  constrainedField.append(constrainedSel);
  constrainedField.append(
    el(
      'p',
      'field-hint',
      'Attach JSON Schema response_format on tool turns when the provider probe reports structured output support.',
    ),
  );
  form.append(constrainedField);

  appendPricingFields(form, provider.pricing);

  const probeRow = el('div', 'settings-providers-form-actions');
  const probeBtn = el('button', 'settings-inline-btn', 'Probe capabilities');
  probeBtn.type = 'button';
  probeBtn.dataset.providerProbe = provider.id;
  probeRow.append(probeBtn);
  form.append(
    el(
      'p',
      'field-hint',
      'Runs model capability checks (vision, tools, streaming) and structured-output detection. Not run automatically on refresh.',
    ),
  );
  form.append(probeRow);

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

function formatStructuredOutputBadge(caps: ProviderCapabilities | null): string {
  const badge = structuredOutputBadge(caps);
  if (badge === 'yes') return 'Structured output: yes';
  if (badge === 'no') return 'Structured output: no';
  return 'Structured output: unknown';
}

/** Build one provider row in the settings list. */
function createProviderSettingsRow(
  provider: ProviderPublic,
  activeProviderId: string,
  canRemove: boolean,
  capabilities: ProviderCapabilities | null,
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

  head.append(
    el(
      'span',
      'settings-badge settings-badge--muted',
      formatStructuredOutputBadge(capabilities),
    ),
  );

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

  const pricingParsed = parsePricingFromForm(form);
  if (pricingParsed && 'error' in pricingParsed) {
    if (errEl) {
      errEl.textContent = pricingParsed.error;
      errEl.classList.remove('hidden');
    }
    return;
  }

  const constrainedSel = form.querySelector<HTMLSelectElement>(
    'select[name="constrainedToolCalls"]',
  );
  let constrainedToolCalls: boolean | null = null;
  if (constrainedSel?.value === 'on') constrainedToolCalls = true;
  else if (constrainedSel?.value === 'off') constrainedToolCalls = false;

  const result = await updateProvider(id, {
    label,
    baseUrl,
    apiKind: parseApiKind(apiKindInput),
    authStyle: parseAuthStyle(authStyleInput),
    enabled: enabledInput?.checked === true,
    modelsPath: paths.modelsPath,
    chatCompletionsPath: paths.chatCompletionsPath,
    constrainedToolCalls,
    pricing:
      pricingParsed === null
        ? null
        : (pricingParsed as ProviderPricing),
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

    const probeId = target.dataset.providerProbe;
    if (probeId) {
      void (async () => {
        try {
          setStatus('spin', `Probing capabilities for ${probeId}…`);
          const { runCapabilityProbeForProvider } = await import(
            '../providers/model-capabilities'
          );
          await runCapabilityProbeForProvider(probeId);
          await probeProviderCapabilities(probeId);
          setStatus('ok', `Capabilities probed for ${probeId}`);
          await renderProvidersSettingsSection();
          const { syncModelSelectPicker } = await import('./model-select-picker');
          syncModelSelectPicker();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatus('err', msg);
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
    const caps = await readProviderCapabilities(provider.id);
    listEl.appendChild(
      createProviderSettingsRow(provider, activeProviderId, canRemove, caps),
    );
  }
}
