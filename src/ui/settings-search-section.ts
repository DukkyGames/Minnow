/**
 * Settings → Search — provider, SearXNG URL, API keys, fallback chain, result count.
 */

import {
  DEFAULT_SEARCH_CONFIG,
  loadSearchConfig,
  saveSearchConfig,
  type SearchConfig,
  type SearchFallbackProvider,
  type SearchProvider,
} from '../config/search-config';
import {
  fetchManagedServers,
  getManagedSearxngActiveUrl,
} from '../servers/client';
import {
  appendSettingsCrosslinks,
  appendSettingsGroup,
  linkToSettingsSection,
} from './settings-layout';
import { setStatus } from './status';
import { isLocalServerAvailable } from '../tools/config';

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

const PROVIDER_OPTIONS: { value: SearchProvider; label: string }[] = [
  { value: 'searxng', label: 'SearXNG (local instance)' },
  { value: 'tavily', label: 'Tavily API' },
  { value: 'brave', label: 'Brave Search API' },
  { value: 'duckduckgo', label: 'DuckDuckGo (local server)' },
  { value: 'disabled', label: 'Disabled' },
];

const FALLBACK_OPTIONS: { value: SearchFallbackProvider; label: string }[] = [
  { value: 'tavily', label: 'Tavily' },
  { value: 'brave', label: 'Brave' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
];

/** Render Settings → Search into the section mount. */
export async function renderSearchSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();

  const providerGroup = appendSettingsGroup(
    mount,
    'Provider',
    'Preferred backend for web_search. No silent fallback when the selected provider cannot run.',
  );

  const providerField = el('div', 'settings-field');
  const providerLabel = el('label', 'settings-field-label', 'Search provider');
  providerLabel.htmlFor = 'settingsSearchProvider';
  const providerSelect = document.createElement('select');
  providerSelect.id = 'settingsSearchProvider';
  providerSelect.className = 'settings-select';
  for (const opt of PROVIDER_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    providerSelect.appendChild(option);
  }
  providerField.append(providerLabel, providerSelect);
  providerGroup.appendChild(providerField);

  const searxngField = el('div', 'settings-field settings-search-url-field');

  const searxngEditable = el('div', 'settings-search-url-editable');
  const searxngLabel = el('label', 'settings-field-label', 'SearXNG base URL');
  searxngLabel.htmlFor = 'settingsSearxngUrl';
  const searxngInput = document.createElement('input');
  searxngInput.type = 'url';
  searxngInput.id = 'settingsSearxngUrl';
  searxngInput.className = 'settings-input';
  searxngInput.placeholder = 'http://localhost:8080';
  searxngInput.autocomplete = 'off';
  searxngEditable.append(searxngLabel, searxngInput);

  const searxngManaged = el('div', 'settings-search-url-managed hidden');
  const managedHead = el('div', 'settings-search-url-managed__head');
  managedHead.append(
    el('span', 'settings-field-label', 'SearXNG base URL'),
    el('span', 'settings-mcp-badge settings-mcp-badge--builtin', 'Managed'),
  );
  const managedUrlPanel = el('div', 'settings-search-managed-url');
  managedUrlPanel.setAttribute('role', 'status');
  const managedStatus = el('span', 'settings-mcp-status settings-mcp-status--ok');
  managedStatus.append(
    el('span', 'settings-mcp-status-dot'),
    el('span', 'settings-mcp-status-text', 'Running'),
  );
  const managedEndpoint = el('code', 'settings-search-managed-url__endpoint');
  managedUrlPanel.append(managedStatus, managedEndpoint);
  const managedHint = el('p', 'settings-field-hint');
  managedHint.append(
    document.createTextNode(
      'Search and Deep Research use the loopback instance from ',
    ),
    linkToSettingsSection('Settings → Servers', 'servers'),
    document.createTextNode('. Saved URL in search.json applies when managed SearXNG stops.'),
  );
  searxngManaged.append(managedHead, managedUrlPanel, managedHint);

  searxngField.append(searxngEditable, searxngManaged);
  providerGroup.appendChild(searxngField);

  const keysGroup = appendSettingsGroup(
    mount,
    'API keys',
    'Brave and Tavily keys are stored in search.json (tools.json keys remain as a read fallback).',
  );

  const braveField = el('div', 'settings-field');
  const braveLabel = el('label', 'settings-field-label', 'Brave Search API key');
  braveLabel.htmlFor = 'settingsSearchBraveApiKey';
  const braveInput = document.createElement('input');
  braveInput.type = 'password';
  braveInput.id = 'settingsSearchBraveApiKey';
  braveInput.className = 'settings-input';
  braveInput.autocomplete = 'off';
  braveField.append(braveLabel, braveInput);
  keysGroup.appendChild(braveField);

  const tavilyField = el('div', 'settings-field');
  const tavilyLabel = el('label', 'settings-field-label', 'Tavily API key');
  tavilyLabel.htmlFor = 'settingsSearchTavilyApiKey';
  const tavilyInput = document.createElement('input');
  tavilyInput.type = 'password';
  tavilyInput.id = 'settingsSearchTavilyApiKey';
  tavilyInput.className = 'settings-input';
  tavilyInput.autocomplete = 'off';
  tavilyField.append(tavilyLabel, tavilyInput);
  keysGroup.appendChild(tavilyField);

  const chainGroup = appendSettingsGroup(
    mount,
    'Research fallback chain',
    'If the primary search provider fails, Deep Research tries these providers in order. Check each provider to include it.',
  );
  const chainList = el('div', 'settings-search-fallback-list');
  const chainCheckboxes = new Map<SearchFallbackProvider, HTMLInputElement>();
  for (const opt of FALLBACK_OPTIONS) {
    const row = el('label', 'settings-inline-checkbox');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = opt.value;
    cb.dataset.fallbackProvider = opt.value;
    chainCheckboxes.set(opt.value, cb);
    row.append(cb, document.createTextNode(` ${opt.label}`));
    chainList.appendChild(row);
  }
  chainGroup.appendChild(chainList);

  const limitsGroup = appendSettingsGroup(
    mount,
    'Results',
    'Maximum structured results per query (1–50).',
  );
  const countField = el('div', 'settings-field');
  const countLabel = el('label', 'settings-field-label', 'Result count');
  countLabel.htmlFor = 'settingsSearchResultCount';
  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.id = 'settingsSearchResultCount';
  countInput.className = 'settings-input';
  countInput.min = '1';
  countInput.max = '50';
  countField.append(countLabel, countInput);
  limitsGroup.appendChild(countField);

  const saveBtn = el('button', 'settings-action-btn', 'Save search settings');
  saveBtn.type = 'button';
  mount.appendChild(saveBtn);

  let current: SearchConfig = { ...DEFAULT_SEARCH_CONFIG };
  /** search.json URL (unchanged when managed SearXNG overrides display). */
  let configuredSearxngUrl = DEFAULT_SEARCH_CONFIG.searxngUrl;
  try {
    current = await loadSearchConfig();
    configuredSearxngUrl = current.searxngUrl;
  } catch {
    setStatus('err', 'Could not load search settings — use npm start');
  }

  const applyToForm = (config: SearchConfig): void => {
    providerSelect.value = config.provider;
    configuredSearxngUrl = config.searxngUrl;
    searxngInput.value = config.searxngUrl;
    braveInput.value = config.keys.braveApiKey;
    tavilyInput.value = config.keys.tavilyApiKey;
    countInput.value = String(config.resultCount);
    const chainSet = new Set(config.fallbackChain);
    for (const [id, cb] of chainCheckboxes) {
      cb.checked = chainSet.has(id);
    }
  };
  applyToForm(current);

  const setSearxngManagedMode = (managedUrl: string | null): void => {
    const managed = Boolean(managedUrl);
    searxngEditable.classList.toggle('hidden', managed);
    searxngManaged.classList.toggle('hidden', !managed);
    if (managedUrl) {
      managedEndpoint.textContent = managedUrl;
    }
  };

  if (isLocalServerAvailable()) {
    const servers = await fetchManagedServers();
    const managedUrl = servers ? getManagedSearxngActiveUrl(servers) : null;
    setSearxngManagedMode(managedUrl);
  }

  const readForm = (): SearchConfig => {
    const fallbackChain: SearchFallbackProvider[] = [];
    for (const opt of FALLBACK_OPTIONS) {
      const cb = chainCheckboxes.get(opt.value);
      if (cb?.checked) fallbackChain.push(opt.value);
    }
    const provider = providerSelect.value as SearchProvider;
    return {
      provider: PROVIDER_OPTIONS.some((o) => o.value === provider)
        ? provider
        : DEFAULT_SEARCH_CONFIG.provider,
      fallbackChain:
        fallbackChain.length > 0 ? fallbackChain : [...DEFAULT_SEARCH_CONFIG.fallbackChain],
      searxngUrl:
        searxngManaged.classList.contains('hidden')
          ? searxngInput.value.trim() || DEFAULT_SEARCH_CONFIG.searxngUrl
          : configuredSearxngUrl,
      keys: {
        braveApiKey: braveInput.value.trim(),
        tavilyApiKey: tavilyInput.value.trim(),
      },
      resultCount: Number(countInput.value) || DEFAULT_SEARCH_CONFIG.resultCount,
    };
  };

  saveBtn.addEventListener('click', () => {
    void (async () => {
      try {
        const saved = await saveSearchConfig(readForm());
        applyToForm(saved);
        setStatus('ok', 'Search settings saved');
      } catch {
        setStatus('err', 'Could not save search settings — use npm start');
      }
    })();
  });

  appendSettingsCrosslinks(mount, [
    { label: 'Managed servers (SearXNG)', sectionId: 'servers' },
    { label: 'Deep Research engine', sectionId: 'deep-research' },
    { label: 'Tool permissions', sectionId: 'tools' },
  ]);
}
