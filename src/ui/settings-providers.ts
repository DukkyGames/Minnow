/**
 * Settings → Providers: list, set active, add, and remove LLM backends.
 */

import { isServerStorageMode } from '../config/storage-mode';
import type { ProviderPublic } from '../providers/types';
import {
  createProvider,
  deleteProvider,
  isProvidersApiAvailable,
  listProviders,
  setActiveProvider,
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

/** Build one provider row in the settings list. */
function createProviderSettingsRow(
  provider: ProviderPublic,
  activeProviderId: string,
  canRemove: boolean,
): HTMLElement {
  const row = el('article', 'settings-providers-row');
  row.setAttribute('role', 'listitem');
  row.dataset.providerId = provider.id;

  const head = el('div', 'settings-providers-row-head');
  const title = el('span', 'settings-providers-name');
  title.textContent = provider.label;
  head.append(title);

  const idMeta = el('span', 'settings-providers-id', provider.id);
  head.append(idMeta);

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
  const kindLine = el(
    'p',
    'settings-field-hint',
    `API: ${provider.apiKind}${provider.hasApiKey ? ' · API key set' : ''}`,
  );
  detail.append(kindLine);
  row.append(detail);

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

  resetBtn?.addEventListener('click', () => clearProvidersAddForm());

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const idInput = document.getElementById('settingsProvidersAddId') as HTMLInputElement | null;
      const labelInput = document.getElementById('settingsProvidersAddLabel') as HTMLInputElement | null;
      const baseUrlInput = document.getElementById('settingsProvidersAddBaseUrl') as HTMLInputElement | null;
      const apiKindInput = document.getElementById('settingsProvidersAddApiKind') as HTMLSelectElement | null;
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

      const result = await createProvider({
        id,
        label,
        baseUrl,
        apiKind: apiKindInput?.value === 'openai-v1' ? 'openai-v1' : 'lm-studio-v0',
        authStyle:
          authStyleInput?.value === 'api-key'
            ? 'api-key'
            : authStyleInput?.value === 'x-api-key'
              ? 'x-api-key'
              : 'bearer',
        enabled: enabledInput?.checked !== false,
      });

      if (result.ok === false) {
        if (errEl) {
          errEl.textContent = result.error;
          errEl.classList.remove('hidden');
        }
        setStatus('err', result.error);
        return;
      }

      const apiKey = apiKeyInput?.value.trim() ?? '';
      if (apiKey) {
        const secretResult = await updateProviderSecrets(id, { apiKey });
        if (secretResult.ok === false) {
          if (errEl) {
            errEl.textContent = `Provider added but API key failed: ${secretResult.error}`;
            errEl.classList.remove('hidden');
          }
          setStatus('err', secretResult.error);
          await renderProvidersSettingsSection();
          return;
        }
      }

      if (errEl) errEl.classList.add('hidden');
      clearProvidersAddForm();
      setStatus('ok', `Added provider ${result.provider.label}`);
      await loadProviderSelect();
      await renderProvidersSettingsSection();
    })();
  });
}

/** Delegate set-active and remove clicks on the provider list. */
function bindProvidersListActions(listEl: HTMLElement): void {
  if (providersListActionsBound) return;
  providersListActionsBound = true;

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
