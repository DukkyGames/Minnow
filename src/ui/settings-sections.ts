/**
 * Populate full settings page sections from Step 02–18 APIs (no placeholder stubs).
 */

import { fetchWorkAgentsList } from '../agents/work-agent-prompt-api';
import { loadSubAgentConfig, saveSubAgentConfigToServer } from '../agents/sub-agent-config';
import type { SubAgentTypeConfig } from '../agents/types';
import { PART_ORDER } from '../chat/prompts/prompt-composer';
import { loadPromptById } from '../chat/prompts/prompt-loader';
import {
  deletePromptConfig,
  duplicatePromptConfig,
  listPromptConfigs,
  loadPromptConfig,
  savePromptConfig,
} from '../chat/prompts/prompt-configs';
import type {
  PromptConfig,
  PromptConfigPartSettings,
  PromptPartId,
  PromptProfile,
} from '../chat/prompts/types';
import { listExperts } from '../chat/experts/registry';
import { listModes } from '../chat/modes/registry';
import {
  loadPromptMetaSettings,
  savePromptMetaSettings,
} from '../config/prompt-meta';
import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import {
  isProvidersApiAvailable,
  listProviders,
  setActiveProvider,
} from '../providers/store';
import {
  deleteMemoryEntry,
  fetchMemoryEntries,
  fetchMemoryStatus,
} from '../memory/client';
import type { MemoryEntryWithBody } from '../memory/types';
import { renderSkillsSettingsSection } from './settings-skills';
import {
  fillToolsSection,
  loadProviderSelect,
  refreshProvidersBanner,
  registerToolHandlers,
} from './settings';
import {
  createMcpServer,
  deleteMcpServer,
  fetchMcpServers,
  setMcpServerEnabled,
  type McpServerSummary,
} from '../mcp/client';
import {
  getToolConfig,
  isLocalServerAvailable,
  loadToolConfigFromStorage,
  loadToolConfigIntoDrawer,
  saveToolConfig,
} from '../tools/config';
import { renderLspSection } from './lsp-settings';
import { setStatus } from './status';
import type { SettingsSectionId } from './settings-page';
import {
  mountPromptFileEditor,
  mountSubAgentTypeEditor,
  mountWorkAgentEditor,
  renderEntityEditorList,
} from './settings-entity-editor';

const PART_LABELS: Record<PromptPartId, string> = {
  base: 'Base',
  mode: 'Mode',
  expert: 'Expert',
  'tool-usage': 'Tool usage',
  info: 'Info',
  memory: 'Memory',
  'work-agent': 'Work agent',
  skill: 'Skill',
};

const DEFAULT_PART_SETTINGS: PromptConfigPartSettings = {
  enabled: true,
  contentOverride: null,
};

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

function clearMount(id: string): HTMLElement | null {
  const mount = document.getElementById(id);
  if (!mount) return null;
  mount.replaceChildren();
  return mount;
}

function serverBanner(message: string): HTMLElement {
  const p = el('p', 'settings-server-banner');
  p.setAttribute('role', 'status');
  p.innerHTML = message;
  return p;
}

async function renderGeneralSection(): Promise<void> {
  const mount = clearMount('settingsGeneralBody');
  if (!mount) return;

  const serverUp = await detectConfigServer();
  if (!serverUp) {
    mount.appendChild(
      serverBanner(
        'File-backed settings require <code>npm start</code>. Values below use browser storage until then.',
      ),
    );
  }

  const { providers, activeProviderId } = await listProviders();
  const active = providers.find((p) => p.id === activeProviderId) ?? providers[0];

  const summary = el('dl', 'settings-kv');
  const addRow = (term: string, value: string) => {
    const dt = el('dt', 'settings-kv__term', term);
    const dd = el('dd', 'settings-kv__value', value);
    summary.appendChild(dt);
    summary.appendChild(dd);
  };

  addRow('Active provider', active?.label ?? '—');
  addRow('Base URL', active?.baseUrl ?? '—');
  addRow('Storage', serverUp ? '~/.minnow' : 'Browser (localStorage)');

  mount.appendChild(summary);

  const hint = el(
    'p',
    'settings-field-hint',
    'Temperature and max tokens stay in the quick settings drawer until migrated here.',
  );
  mount.appendChild(hint);
}

async function renderProvidersSection(): Promise<void> {
  const mount = clearMount('settingsProvidersBody');
  if (!mount) return;

  if (!isServerStorageMode() || !isProvidersApiAvailable()) {
    mount.appendChild(
      serverBanner('Provider registry requires <code>npm start</code>.'),
    );
    return;
  }

  const { providers, activeProviderId } = await listProviders();
  const list = el('ul', 'settings-entity-list');

  for (const p of providers) {
    const item = el('li', 'settings-entity-list__item');
    const head = el('span', 'settings-entity-list__head');
    head.textContent = `${p.label} (${p.id})`;
    item.appendChild(head);

    const meta = el('p', 'settings-field-hint', p.baseUrl);
    item.appendChild(meta);

    if (p.id === activeProviderId) {
      const badge = el('span', 'settings-badge', 'Active');
      item.appendChild(badge);
    } else if (p.enabled !== false) {
      const btn = el('button', 'settings-inline-btn', 'Set active');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        void (async () => {
          try {
            await setActiveProvider(p.id);
            await loadProviderSelect();
            setStatus('ok', `Active provider: ${p.label}`);
            await renderProvidersSection();
          } catch {
            setStatus('err', 'Could not switch provider');
          }
        })();
      });
      item.appendChild(btn);
    }

    list.appendChild(item);
  }

  mount.appendChild(list);
}

function defaultCustomConfig(id: string, label: string): PromptConfig {
  const parts: PromptConfig['parts'] = {};
  for (const partId of PART_ORDER) {
    parts[partId] = { ...DEFAULT_PART_SETTINGS };
  }
  return {
    id,
    label,
    profile: 'custom',
    parts,
    meta: { createdAt: new Date().toISOString() },
  };
}

let promptingUiBound = false;
let activeCustomConfig: PromptConfig | null = null;

async function renderPromptPartsPanel(
  profile: PromptProfile,
  configId: string | null,
): Promise<void> {
  const mount = clearMount('settingsPromptParts');
  if (!mount) return;

  if (profile === 'custom') {
    if (!configId) {
      mount.appendChild(
        el('p', 'settings-field-hint', 'Select or create a custom configuration.'),
      );
      return;
    }
    const loaded = await loadPromptConfig(configId);
    if (loaded instanceof Error) {
      mount.appendChild(el('p', 'settings-field-hint', loaded.message));
      return;
    }
    activeCustomConfig = loaded;
    renderCustomPartEditors(mount, loaded);
    return;
  }

  activeCustomConfig = null;
  const list = el('div', 'settings-parts-preview');
  for (const partId of PART_ORDER) {
    const kind =
      partId === 'work-agent'
        ? 'work-agent'
        : partId === 'tool-usage'
          ? 'tool-usage'
          : partId;
    const promptId =
      partId === 'base'
        ? 'default'
        : partId === 'mode'
          ? 'build'
          : partId === 'expert'
            ? 'general'
            : partId === 'info'
              ? 'general-assistant'
              : partId === 'tool-usage'
                ? 'default'
                : partId === 'work-agent'
                  ? 'default'
                  : null;

    if (!promptId) {
      const row = el('details', 'settings-part-block');
      row.appendChild(el('summary', '', PART_LABELS[partId]));
      row.appendChild(
        el(
          'p',
          'settings-field-hint',
          'Resolved at send time from session context (memory, skills).',
        ),
      );
      list.appendChild(row);
      continue;
    }

    const body = loadPromptById(kind as 'base', promptId, profile);
    const row = el('details', 'settings-part-block');
    row.open = partId === 'base';
    row.appendChild(el('summary', '', PART_LABELS[partId]));
    const pre = el('pre', 'settings-part-preview');
    pre.textContent = body?.body?.trim() || '(empty)';
    row.appendChild(pre);
    list.appendChild(row);
  }
  mount.appendChild(list);
}

function renderCustomPartEditors(mount: HTMLElement, config: PromptConfig): void {
  for (const partId of PART_ORDER) {
    const settings = config.parts[partId] ?? { ...DEFAULT_PART_SETTINGS };
    const block = el('details', 'settings-part-block');
    block.open = partId === 'base';

    const summary = el('summary', '');
    const enable = document.createElement('input');
    enable.type = 'checkbox';
    enable.checked = settings.enabled !== false;
    enable.addEventListener('click', (e) => e.stopPropagation());
    enable.addEventListener('change', () => {
      if (!activeCustomConfig) return;
      activeCustomConfig.parts[partId] = {
        ...(activeCustomConfig.parts[partId] ?? DEFAULT_PART_SETTINGS),
        enabled: enable.checked,
      };
    });
    summary.appendChild(enable);
    summary.appendChild(document.createTextNode(` ${PART_LABELS[partId]}`));
    block.appendChild(summary);

    const ta = document.createElement('textarea');
    ta.className = 'settings-part-editor';
    ta.rows = 6;
    ta.value = settings.contentOverride ?? '';
    ta.placeholder = 'Leave empty to use shipped default at send time';
    ta.addEventListener('input', () => {
      if (!activeCustomConfig) return;
      const trimmed = ta.value.trim();
      activeCustomConfig.parts[partId] = {
        enabled: enable.checked,
        contentOverride: trimmed ? ta.value : null,
      };
    });
    block.appendChild(ta);
    mount.appendChild(block);
  }
}

async function refreshCustomConfigSelect(): Promise<void> {
  const select = document.getElementById(
    'settingsCustomConfigSelect',
  ) as HTMLSelectElement | null;
  if (!select) return;

  const meta = await loadPromptMetaSettings();
  const configs = await listPromptConfigs();
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = configs.length ? '— Select configuration —' : '— No saved configs —';
  select.appendChild(empty);

  for (const item of configs) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.label;
    select.appendChild(opt);
  }

  if (meta.activePromptConfigId) {
    select.value = meta.activePromptConfigId;
  }
}

async function bindPromptingToolbar(): Promise<void> {
  if (promptingUiBound) return;
  promptingUiBound = true;

  const customBar = document.getElementById('settingsCustomConfigBar');
  const select = document.getElementById(
    'settingsCustomConfigSelect',
  ) as HTMLSelectElement | null;

  const syncCustomBarVisibility = async () => {
    const meta = await loadPromptMetaSettings();
    customBar?.classList.toggle('hidden', meta.activePromptProfile !== 'custom');
    await renderPromptPartsPanel(meta.activePromptProfile, meta.activePromptConfigId);
  };

  select?.addEventListener('change', () => {
    void (async () => {
      const id = select.value || null;
      await savePromptMetaSettings({ activePromptConfigId: id });
      await renderPromptPartsPanel('custom', id);
    })();
  });

  document.getElementById('settingsCustomConfigNew')?.addEventListener('click', () => {
    void (async () => {
      const label = prompt('Configuration label:', 'My setup');
      if (!label?.trim()) return;
      const id = label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
      if (!id) return;
      const config = defaultCustomConfig(id, label.trim());
      const saved = await savePromptConfig(config);
      if (saved instanceof Error) {
        setStatus('err', saved.message);
        return;
      }
      await savePromptMetaSettings({
        activePromptProfile: 'custom',
        activePromptConfigId: id,
      });
      await refreshCustomConfigSelect();
      select!.value = id;
      await syncCustomBarVisibility();
      setStatus('ok', `Created ${label}`);
    })();
  });

  document.getElementById('settingsCustomConfigSave')?.addEventListener('click', () => {
    void (async () => {
      if (!activeCustomConfig) {
        setStatus('err', 'No configuration loaded');
        return;
      }
      activeCustomConfig.meta = {
        ...activeCustomConfig.meta,
        updatedAt: new Date().toISOString(),
      };
      const saved = await savePromptConfig(activeCustomConfig);
      setStatus(saved instanceof Error ? 'err' : 'ok', saved instanceof Error ? saved.message : 'Configuration saved');
    })();
  });

  document.getElementById('settingsCustomConfigDuplicate')?.addEventListener('click', () => {
    void (async () => {
      const meta = await loadPromptMetaSettings();
      if (!meta.activePromptConfigId) return;
      const newLabel = prompt('Duplicate as:', 'Copy');
      if (!newLabel?.trim()) return;
      const newId = `${meta.activePromptConfigId}-copy`
        .slice(0, 48)
        .replace(/[^a-z0-9-]/g, '-');
      const result = await duplicatePromptConfig(
        meta.activePromptConfigId,
        newId,
        newLabel.trim(),
      );
      if (result instanceof Error) {
        setStatus('err', result.message);
        return;
      }
      await refreshCustomConfigSelect();
      await savePromptMetaSettings({ activePromptConfigId: newId });
      select!.value = newId;
      await syncCustomBarVisibility();
      setStatus('ok', 'Configuration duplicated');
    })();
  });

  document.getElementById('settingsCustomConfigDelete')?.addEventListener('click', () => {
    void (async () => {
      const meta = await loadPromptMetaSettings();
      if (!meta.activePromptConfigId) return;
      if (!confirm(`Delete "${meta.activePromptConfigId}"?`)) return;
      const result = await deletePromptConfig(meta.activePromptConfigId);
      if (result instanceof Error) {
        setStatus('err', result.message);
        return;
      }
      await savePromptMetaSettings({ activePromptConfigId: null });
      await refreshCustomConfigSelect();
      await syncCustomBarVisibility();
      setStatus('ok', 'Configuration deleted');
    })();
  });

  document.querySelectorAll('[data-profile-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      void syncCustomBarVisibility();
    });
  });

  await syncCustomBarVisibility();
}

async function renderPromptingSection(): Promise<void> {
  await refreshCustomConfigSelect();
  await bindPromptingToolbar();
  const meta = await loadPromptMetaSettings();
  await renderPromptPartsPanel(meta.activePromptProfile, meta.activePromptConfigId);
}

async function renderModesSection(): Promise<void> {
  const mount = clearMount('settingsModesBody');
  if (!mount) return;

  if (!isServerStorageMode()) {
    mount.appendChild(
      serverBanner('Mode prompt editing requires <code>npm start</code>.'),
    );
    return;
  }

  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Expand a mode to edit Full and Lite system prompts. Overrides are saved under ~/.minnow/prompts/modes/.',
    ),
  );

  renderEntityEditorList(
    mount,
    listModes().map((mode) => ({
      id: mode.id,
      label: mode.label,
      hint: `${mode.description} · Tool policy: ${mode.toolPolicy.default}`,
    })),
    (id, body) => {
      mountPromptFileEditor(body, { family: 'modes', entityId: id });
    },
  );
}

async function renderExpertsSection(): Promise<void> {
  const mount = clearMount('settingsExpertsBody');
  if (!mount) return;

  if (!isServerStorageMode()) {
    mount.appendChild(
      serverBanner('Expert prompt editing requires <code>npm start</code>.'),
    );
    return;
  }

  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Edit persona prompts per expert. Overrides live in ~/.minnow/prompts/experts/.',
    ),
  );

  renderEntityEditorList(
    mount,
    listExperts().map((expert) => ({
      id: expert.meta.id,
      label: expert.meta.label,
      hint: expert.meta.description ?? '',
    })),
    (id, body) => {
      mountPromptFileEditor(body, { family: 'experts', entityId: id });
    },
  );
}

async function renderWorkAgentsSection(): Promise<void> {
  const mount = clearMount('settingsWorkAgentsBody');
  if (!mount) return;

  if (!isServerStorageMode()) {
    mount.appendChild(
      serverBanner('Work agent editing requires <code>npm start</code>.'),
    );
    return;
  }

  const remote = await fetchWorkAgentsList();
  const agents = remote?.agents ?? [];

  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Set provider and model per work agent; edit Full/Lite prompts. Binding is stored in ~/.minnow/work-agents.json.',
    ),
  );

  renderEntityEditorList(
    mount,
    agents.map((agent) => ({
      id: agent.id,
      label: `${agent.label}${agent.disabled ? ' (disabled)' : ''}`,
      hint: agent.defaultForModes?.length
        ? `Default for modes: ${agent.defaultForModes.join(', ')}`
        : agent.description,
    })),
    (id, body) => {
      const agent = agents.find((a) => a.id === id);
      if (!agent) return;
      mountWorkAgentEditor(body, {
        agentId: id,
        initialProviderId: agent.providerId,
        initialModelId: agent.modelId,
        initialDisabled: agent.disabled === true,
        onModelSaved: () => {
          void renderWorkAgentsSection();
        },
      });
    },
  );
}

async function renderSubAgentsSection(): Promise<void> {
  const mount = clearMount('settingsSubAgentsBody');
  if (!mount) return;

  const config = await loadSubAgentConfig();

  const summary = el('dl', 'settings-kv');
  const addRow = (term: string, value: string) => {
    summary.appendChild(el('dt', 'settings-kv__term', term));
    summary.appendChild(el('dd', 'settings-kv__value', value));
  };
  addRow('Enabled', config.enabled !== false ? 'Yes' : 'No');
  addRow('Max concurrent', String(config.globalMaxConcurrent));
  addRow('Default timeout', `${config.defaultTimeoutMs} ms`);
  mount.appendChild(summary);

  const enableWrap = el('label', 'settings-toggle-row');
  const enableCb = document.createElement('input');
  enableCb.type = 'checkbox';
  enableCb.checked = config.enabled !== false;
  enableWrap.appendChild(enableCb);
  enableWrap.appendChild(el('span', '', 'Enable sub-agents'));
  mount.appendChild(enableWrap);

  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Expand a sub-agent type to edit its system prompt and model binding.',
    ),
  );

  const saveTypePatch = async (
    typeId: string,
    patch: Partial<SubAgentTypeConfig>,
  ): Promise<boolean> => {
    const fresh = await loadSubAgentConfig();
    const types = { ...fresh.types };
    types[typeId] = { ...types[typeId], ...patch };
    return saveSubAgentConfigToServer({ types });
  };

  renderEntityEditorList(
    mount,
    Object.entries(config.types).map(([id, type]) => ({
      id,
      label: type.label ?? id.replace(/([A-Z])/g, ' $1').trim(),
      hint: `Provider ${type.providerId ?? '—'} · model ${type.modelId || '(chat default)'}`,
    })),
    (id, body) => {
      const type = config.types[id];
      if (!type) return;
      mountSubAgentTypeEditor(
        body,
        id,
        id,
        {
          providerId: type.providerId ?? '',
          modelId: type.modelId ?? '',
          enabled: type.enabled !== false,
          maxConcurrent: type.maxConcurrent,
        },
        (patch) => saveTypePatch(id, patch),
      );
    },
  );

  enableCb.addEventListener('change', () => {
    void (async () => {
      const fresh = await loadSubAgentConfig();
      const ok = await saveSubAgentConfigToServer({
        ...fresh,
        enabled: enableCb.checked,
      });
      setStatus(ok ? 'ok' : 'err', ok ? 'Sub-agents updated' : 'Save failed — use npm start');
    })();
  });
}

let toolsSectionInitialized = false;

async function renderToolsSection(): Promise<void> {
  const mount = clearMount('settingsToolsBody');
  if (!mount) return;

  await loadToolConfigFromStorage();

  const banner = document.createElement('p');
  banner.id = 'settingsToolsServerBanner';
  banner.className = 'settings-server-banner hidden';
  banner.setAttribute('role', 'status');
  banner.textContent = 'Server tools need npm start (not npm run dev).';
  mount.appendChild(banner);

  mount.appendChild(
    el(
      'p',
      'field-hint settings-tools-hint',
      'Enable function calling per tool. Use Enable all or category All to toggle a group. Server tools need npm start.',
    ),
  );

  const list = document.createElement('div');
  list.id = 'settingsToolsList';
  list.className = 'tools-list settings-tools-list';
  mount.appendChild(list);

  const keyRow = el('div', 'tool-key-row field settings-tool-key-row');
  const keyLabel = document.createElement('label');
  keyLabel.htmlFor = 'settingsBraveApiKey';
  keyLabel.textContent = 'Brave Search API key';
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.id = 'settingsBraveApiKey';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  keyInput.placeholder = 'Optional — for web_search';
  keyRow.appendChild(keyLabel);
  keyRow.appendChild(keyInput);
  keyRow.appendChild(
    el('p', 'settings-field-hint', 'Stored in ~/.minnow/tools.json when npm start is running.'),
  );
  mount.appendChild(keyRow);

  fillToolsSection('settingsToolsList');

  if (!toolsSectionInitialized) {
    toolsSectionInitialized = true;
    registerToolHandlers();
    keyInput.addEventListener('input', () => {
      const config = getToolConfig();
      config.keys.braveApiKey = keyInput.value.trim();
      saveToolConfig(config);
    });
  }

  const config = getToolConfig();
  keyInput.value = config.keys.braveApiKey;
  loadToolConfigIntoDrawer(list);

  banner.classList.toggle('hidden', isLocalServerAvailable());
}

/** Test fixture server — hidden from settings UI. */
const MCP_SETTINGS_HIDDEN_IDS = new Set(['fixture']);

function sortMcpServersForDisplay(
  servers: McpServerSummary[],
): McpServerSummary[] {
  return [...servers]
    .filter((s) => !MCP_SETTINGS_HIDDEN_IDS.has(s.id))
    .sort((a, b) => {
      if (a.id === 'context7') return -1;
      if (b.id === 'context7') return 1;
      return a.label.localeCompare(b.label);
    });
}

function createMcpSettingsRow(server: McpServerSummary): HTMLElement {
  const row = document.createElement('article');
  row.className = 'settings-mcp-row';
  row.setAttribute('role', 'listitem');
  row.dataset.serverId = server.id;

  const head = document.createElement('div');
  head.className = 'settings-mcp-row-head';

  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = server.enabled;
  checkbox.dataset.mcpToggle = server.id;
  checkbox.setAttribute(
    'aria-label',
    `${server.enabled ? 'Disable' : 'Enable'} ${server.label}`,
  );

  const title = document.createElement('span');
  title.textContent = server.label;
  label.append(checkbox, title);
  head.append(label);

  if (server.builtin) {
    const badge = document.createElement('span');
    badge.className = 'settings-mcp-badge settings-mcp-badge--builtin';
    badge.textContent = 'Built-in';
    head.append(badge);
  } else {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'settings-inline-btn settings-mcp-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove ${server.label}`);
    removeBtn.dataset.mcpRemove = server.id;
    head.append(removeBtn);
  }

  row.append(head);

  const meta = document.createElement('div');
  meta.className = 'settings-mcp-meta';

  if (server.description) {
    const desc = document.createElement('span');
    desc.className = 'settings-mcp-description';
    desc.textContent = server.description;
    meta.append(desc);
  }

  const status = document.createElement('span');
  status.className = `settings-mcp-badge ${
    server.connected
      ? 'settings-mcp-badge--connected'
      : 'settings-mcp-badge--idle'
  }`;
  status.textContent = server.connected ? 'Connected' : 'Not connected';
  meta.append(status);

  if (server.id === 'context7') {
    const keyHint = document.createElement('span');
    keyHint.className = 'settings-mcp-key-hint';
    keyHint.textContent =
      'Set CONTEXT7_API_KEY or context7ApiKey in provider secrets for live docs.';
    meta.append(keyHint);
  }

  row.append(meta);
  return row;
}

let mcpToggleHandlerBound = false;
let mcpAddFormBound = false;

/** Split textarea lines into trimmed non-empty strings. */
function parseMultilineField(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Parse KEY=value lines into an env map (ignores malformed lines). */
function parseEnvLines(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of parseMultilineField(raw)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

function clearMcpAddForm(): void {
  const form = document.getElementById('settingsMcpAddForm') as HTMLFormElement | null;
  form?.reset();
  const enabled = document.getElementById('settingsMcpAddEnabled') as HTMLInputElement | null;
  if (enabled) enabled.checked = true;
  const err = document.getElementById('settingsMcpAddError');
  err?.classList.add('hidden');
  if (err) err.textContent = '';
}

function bindMcpAddForm(): void {
  if (mcpAddFormBound) return;
  mcpAddFormBound = true;

  const form = document.getElementById('settingsMcpAddForm') as HTMLFormElement | null;
  const errEl = document.getElementById('settingsMcpAddError');
  const resetBtn = document.getElementById('settingsMcpAddReset');

  resetBtn?.addEventListener('click', () => clearMcpAddForm());

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const idInput = document.getElementById('settingsMcpAddId') as HTMLInputElement | null;
      const labelInput = document.getElementById('settingsMcpAddLabel') as HTMLInputElement | null;
      const descInput = document.getElementById('settingsMcpAddDescription') as HTMLInputElement | null;
      const cmdInput = document.getElementById('settingsMcpAddCommand') as HTMLInputElement | null;
      const argsInput = document.getElementById('settingsMcpAddArgs') as HTMLTextAreaElement | null;
      const envInput = document.getElementById('settingsMcpAddEnv') as HTMLTextAreaElement | null;
      const enabledInput = document.getElementById('settingsMcpAddEnabled') as HTMLInputElement | null;

      const id = idInput?.value.trim().toLowerCase() ?? '';
      const label = labelInput?.value.trim() ?? '';
      const command = cmdInput?.value.trim() ?? '';
      if (!id || !label || !command) {
        if (errEl) {
          errEl.textContent = 'Server id, display name, and command are required.';
          errEl.classList.remove('hidden');
        }
        return;
      }

      const env = parseEnvLines(envInput?.value ?? '');
      const result = await createMcpServer({
        id,
        label,
        description: descInput?.value.trim() ?? '',
        enabled: enabledInput?.checked !== false,
        transport: {
          type: 'stdio',
          command,
          args: parseMultilineField(argsInput?.value ?? ''),
          ...(Object.keys(env).length ? { env } : {}),
        },
      });

      if (result.ok === false) {
        const errMsg = result.error;
        if (errEl) {
          errEl.textContent = errMsg;
          errEl.classList.remove('hidden');
        }
        setStatus('err', errMsg);
        return;
      }

      if (errEl) errEl.classList.add('hidden');
      clearMcpAddForm();
      setStatus('ok', `Added MCP server ${result.server.label}`);
      await renderMcpSection();
    })();
  });
}

async function renderMcpSection(): Promise<void> {
  const listEl = document.getElementById('settingsMcpServerList');
  const offlineEl = document.getElementById('settingsMcpOffline');
  const addPanel = document.getElementById('settingsMcpAddPanel');
  if (!listEl) return;

  bindMcpAddForm();

  const online = isLocalServerAvailable();
  offlineEl?.classList.toggle('hidden', online);
  addPanel?.classList.toggle('hidden', !online);

  if (!online) {
    listEl.replaceChildren();
    return;
  }

  const servers = await fetchMcpServers();
  if (servers === null) {
    listEl.replaceChildren();
    listEl.appendChild(
      el('p', 'settings-field-hint', 'Could not load MCP servers.'),
    );
    return;
  }

  const visible = sortMcpServersForDisplay(servers);
  listEl.replaceChildren();
  if (visible.length === 0) {
    listEl.appendChild(
      el('p', 'settings-field-hint', 'No MCP servers in ~/.minnow/mcp.json.'),
    );
    return;
  }

  for (const server of visible) {
    listEl.appendChild(createMcpSettingsRow(server));
  }

  if (!mcpToggleHandlerBound) {
    mcpToggleHandlerBound = true;
    listEl.addEventListener('change', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const serverId = target.dataset.mcpToggle;
      if (!serverId) return;

      const ok = await setMcpServerEnabled(serverId, target.checked);
      if (ok) {
        setStatus(
          'ok',
          target.checked ? `${serverId} enabled` : `${serverId} disabled`,
        );
        await renderMcpSection();
        return;
      }
      target.checked = !target.checked;
      setStatus('err', 'MCP toggle failed — use npm start');
    });

    listEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const serverId = target.dataset.mcpRemove;
      if (!serverId) return;

      void (async () => {
        if (!confirm(`Remove MCP server "${serverId}"?`)) return;
        const ok = await deleteMcpServer(serverId);
        if (ok) {
          setStatus('ok', `Removed ${serverId}`);
          await renderMcpSection();
          return;
        }
        setStatus('err', 'Could not remove MCP server');
      })();
    });
  }
}

async function renderSkillsSection(): Promise<void> {
  const mount = clearMount('settingsSkillsBody');
  if (!mount) return;
  await renderSkillsSettingsSection(mount);
}

let memoryListBindingsDone = false;

/** Sort pinned first, then most recently updated. */
function sortMemoryEntries(entries: MemoryEntryWithBody[]): MemoryEntryWithBody[] {
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

function formatMemoryTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function renderMemoryEntryRow(entry: MemoryEntryWithBody): HTMLElement {
  const row = document.createElement('article');
  row.className = 'settings-memory-row';
  row.setAttribute('role', 'listitem');
  row.dataset.memoryId = entry.id;

  const head = document.createElement('div');
  head.className = 'settings-memory-row-head';

  const title = document.createElement('h3');
  title.className = 'settings-memory-title';
  title.textContent = entry.title || 'Untitled';
  head.append(title);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'settings-inline-btn settings-memory-remove';
  removeBtn.textContent = 'Delete';
  removeBtn.setAttribute('aria-label', `Delete memory ${entry.title}`);
  removeBtn.dataset.memoryRemove = entry.id;
  head.append(removeBtn);

  row.append(head);

  const meta = document.createElement('div');
  meta.className = 'settings-memory-meta';

  if (entry.pinned) {
    const pin = document.createElement('span');
    pin.className = 'settings-memory-badge settings-memory-badge--pinned';
    pin.textContent = 'Pinned';
    meta.append(pin);
  }

  const source = document.createElement('span');
  source.className = 'settings-memory-badge';
  source.textContent = entry.source;
  meta.append(source);

  const updated = document.createElement('span');
  updated.className = 'settings-memory-updated';
  updated.textContent = `Updated ${formatMemoryTimestamp(entry.updatedAt)}`;
  meta.append(updated);

  if (entry.tags.length) {
    const tags = document.createElement('span');
    tags.className = 'settings-memory-tags';
    tags.textContent = entry.tags.join(', ');
    meta.append(tags);
  }

  row.append(meta);

  const body = document.createElement('pre');
  body.className = 'settings-memory-body';
  body.textContent = entry.body?.trim() ? entry.body : '(empty)';
  row.append(body);

  return row;
}

function bindMemoryListActions(listEl: HTMLElement): void {
  if (memoryListBindingsDone) return;
  memoryListBindingsDone = true;

  listEl.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest(
      '[data-memory-remove]',
    ) as HTMLButtonElement | null;
    if (!target?.dataset.memoryRemove) return;

    const id = target.dataset.memoryRemove;
    void (async () => {
      if (!confirm('Delete this memory entry?')) return;
      const ok = await deleteMemoryEntry(id);
      if (ok) {
        setStatus('ok', 'Memory entry deleted');
        await renderMemorySection();
        return;
      }
      setStatus('err', 'Delete failed — use npm start');
    })();
  });
}

async function renderMemorySection(): Promise<void> {
  const countEl = document.getElementById('settingsMemoryEntryCount');
  const hintEl = document.getElementById('settingsMemoryServerHint');
  const listEl = document.getElementById('settingsMemoryList');
  if (!countEl || !hintEl || !listEl) return;

  listEl.replaceChildren();
  bindMemoryListActions(listEl);

  const status = await fetchMemoryStatus();
  if (!status) {
    countEl.textContent = 'Entries: —';
    hintEl.textContent = 'Start npm start for memory API';
    const offline = document.createElement('p');
    offline.className = 'settings-section-note';
    offline.textContent =
      'Start npm start to view and manage stored memories.';
    listEl.append(offline);
    return;
  }

  countEl.textContent = `Entries: ${status.entryCount}`;
  hintEl.textContent = status.home ? `Store: ${status.home}` : 'Server connected';

  const entries = await fetchMemoryEntries(true);
  if (!entries) {
    const err = document.createElement('p');
    err.className = 'settings-section-note';
    err.textContent = 'Could not load memory entries.';
    listEl.append(err);
    return;
  }

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'settings-section-note';
    empty.textContent = 'No memory entries yet.';
    listEl.append(empty);
    return;
  }

  const sorted = sortMemoryEntries(entries);
  for (const entry of sorted) {
    listEl.append(renderMemoryEntryRow(entry));
  }
}

async function renderFeaturesSection(): Promise<void> {
  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (!res.ok) return;
    const config = await res.json();
    const features = config.features ?? {};
    const memoryInj = document.getElementById(
      'settingsFeatureMemoryInjection',
    ) as HTMLInputElement | null;
    if (memoryInj && typeof features.memoryInjection === 'boolean') {
      memoryInj.checked = features.memoryInjection;
    }
  } catch {
    /* offline */
  }
}

/** Load or refresh one settings section from live APIs. */
export async function refreshSettingsSection(
  section: SettingsSectionId,
): Promise<void> {
  switch (section) {
    case 'general':
      await renderGeneralSection();
      break;
    case 'providers':
      refreshProvidersBanner();
      await renderProvidersSection();
      break;
    case 'prompting':
      await renderPromptingSection();
      break;
    case 'modes':
      await renderModesSection();
      break;
    case 'experts':
      await renderExpertsSection();
      break;
    case 'work-agents':
      await renderWorkAgentsSection();
      break;
    case 'sub-agents':
      await renderSubAgentsSection();
      break;
    case 'memory':
      await renderMemorySection();
      break;
    case 'features':
      await renderFeaturesSection();
      break;
    case 'tools':
      await renderToolsSection();
      break;
    case 'mcp':
      await renderMcpSection();
      break;
    case 'lsp':
      await renderLspSection();
      break;
    case 'skills':
      await renderSkillsSection();
      break;
    default:
      break;
  }
}
