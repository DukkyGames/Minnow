/**
 * Settings → Model routing — consolidated per-role provider/model bindings.
 */

import { patchWorkAgentOverride } from '../agents/work-agent-prompt-api';
import type { ThinkingTriState } from '../agents/thinking-types';
import { saveSubAgentConfigToServer, loadSubAgentConfig } from '../agents/sub-agent-config';
import { saveUiDesignerConfig } from '../agents/ui-designer/config';
import { saveTitlesConfig } from '../config/titles-meta';
import {
  getFallbackCandidatesForKey,
  getGlobalFallbackCandidates,
  GLOBAL_FALLBACK_CHAIN_KEY,
  loadFallbackChainsConfig,
  saveFallbackChainsConfig,
  type FallbackChainCandidate,
  type FallbackChainsConfig,
} from '../config/fallback-chains-meta';
import { saveSamplerMeta } from '../config/sampler-meta';
import {
  detectConfigServer,
  isConfigServerMode,
  refreshConfigStorageBanner,
} from '../config/storage-mode';
import {
  loadModelRoutingCatalog,
  type ModelRoutingGroup,
  type ModelRoutingRow,
} from '../settings/model-routing-catalog';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { listProviders } from '../providers/store';
import {
  appendProviderModelFields,
  fillModelSelect,
  fillProviderSelect,
} from './settings-model-binding';
import { buildSamplerFieldInputs } from './settings-sampler-fields';
import { createSettingsToggleRow } from './settings-switch';
import { setStatus } from './status';

const GROUP_LABELS: Record<ModelRoutingGroup, string> = {
  'main-chat': 'Main chat',
  'work-agents': 'Work agents',
  'sub-agents': 'Sub-agents',
  background: 'Background jobs',
  reef: 'Reef widgets',
};

const GROUP_ORDER: ModelRoutingGroup[] = [
  'main-chat',
  'work-agents',
  'sub-agents',
  'background',
  'reef',
];

interface RowControls {
  row: ModelRoutingRow;
  providerSelect: HTMLSelectElement;
  modelSelect: HTMLSelectElement;
  fallbackCb?: HTMLInputElement;
  enabledCb?: HTMLInputElement;
  effectiveEl?: HTMLElement;
  samplerFields?: ReturnType<typeof buildSamplerFieldInputs>;
  thinkingSelect?: HTMLSelectElement;
  fallbackEditor?: FallbackRowEditor;
}

interface FallbackRowEditor {
  rowId: string;
  list: HTMLElement;
  candidates: FallbackChainCandidate[];
}

let mountedRows: RowControls[] = [];
let lastCatalogChatId: string | null = null;
let loadedFallbackConfig: FallbackChainsConfig | null = null;
let globalFallbackEnabledInput: HTMLInputElement | null = null;
let globalFallbackCooldownInput: HTMLInputElement | null = null;
let globalFallbackEditor: FallbackRowEditor | null = null;

function supportsAdvancedPanel(row: ModelRoutingRow): boolean {
  return (
    row.persistKind === 'main-chat' ||
    row.persistKind === 'work-agent' ||
    row.persistKind === 'sub-agent'
  );
}

function buildThinkingSelect(initial: ThinkingTriState): HTMLSelectElement {
  const select = el('select', 'settings-select');
  for (const mode of ['inherit', 'on', 'off'] as const) {
    const opt = document.createElement('option');
    opt.value = mode;
    opt.textContent = mode === 'inherit' ? 'Inherit' : mode === 'on' ? 'On' : 'Off';
    select.appendChild(opt);
  }
  select.value = initial;
  return select;
}

async function saveAdvanced(controls: RowControls): Promise<void> {
  const { row, samplerFields, thinkingSelect } = controls;
  if (!samplerFields || !thinkingSelect) return;

  switch (row.persistKind) {
    case 'main-chat': {
      const patch = samplerFields.readPatch();
      if (patch) await saveSamplerMeta(patch);
      const chat = getActiveChat();
      const mode = thinkingSelect.value as ThinkingTriState;
      if (mode === 'inherit') delete chat.thinkingMode;
      else chat.thinkingMode = mode;
      touchChat(chat);
      scheduleSaveSessions();
      setStatus('ok', 'Main chat sampler and thinking saved');
      void refreshModelRoutingSectionMount();
      break;
    }
    case 'work-agent': {
      const agent = await patchWorkAgentOverride(row.id, {
        sampler: samplerFields.readPatch(),
        thinkingMode: thinkingSelect.value as ThinkingTriState,
      });
      setStatus(
        agent ? 'ok' : 'err',
        agent ? `${row.label} advanced settings saved` : 'Save failed',
      );
      if (agent) void refreshModelRoutingSectionMount();
      break;
    }
    case 'sub-agent': {
      const config = await loadSubAgentConfig();
      const existing = config.types[row.id];
      if (!existing) {
        setStatus('err', 'Unknown sub-agent type');
        return;
      }
      const ok = await saveSubAgentConfigToServer({
        types: {
          [row.id]: {
            ...existing,
            sampler: samplerFields.readPatch(),
            thinkingMode: thinkingSelect.value as ThinkingTriState,
          },
        },
      });
      setStatus(ok ? 'ok' : 'err', ok ? `${row.label} advanced settings saved` : 'Save failed');
      if (ok) void refreshModelRoutingSectionMount();
      break;
    }
    default:
      break;
  }
}

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

function formatEffective(row: ModelRoutingRow): string {
  if (row.usesChatDefault && row.persistKind !== 'ui-designer') {
    return `${row.effectiveModelId || '(chat default)'} · ${row.effectiveProviderId || '—'}`;
  }
  if (row.persistKind === 'ui-designer' && row.fallbackToChatModel && row.usesChatDefault) {
    return `chat default (${row.effectiveModelId || '—'})`;
  }
  return `${row.effectiveModelId || '—'} · ${row.effectiveProviderId || '—'}`;
}

function setEffectiveText(controls: RowControls): void {
  if (!controls.effectiveEl) return;
  controls.effectiveEl.textContent = formatEffective(controls.row);
}

async function wireProviderModelSelects(
  controls: RowControls,
  includeEmptyProvider: boolean,
): Promise<void> {
  const { row, providerSelect, modelSelect } = controls;
  await fillProviderSelect(providerSelect, row.providerId, {
    includeEmptyOption: includeEmptyProvider,
  });
  const providerId =
    row.providerId ||
    (includeEmptyProvider ? '' : providerSelect.value) ||
    row.effectiveProviderId;
  await fillModelSelect(modelSelect, providerId, row.modelId);

  providerSelect.addEventListener('change', () => {
    void fillModelSelect(modelSelect, providerSelect.value, '');
  });
}

async function saveRowFallbackChain(editor: FallbackRowEditor): Promise<void> {
  const candidates = editor.candidates
    .map((row) => ({
      providerId: row.providerId.trim(),
      modelId: row.modelId.trim(),
    }))
    .filter((row) => row.providerId);
  await saveFallbackChainsConfig({
    roles: { [editor.rowId]: candidates },
  });
}

async function saveRow(controls: RowControls): Promise<void> {
  const { row, providerSelect, modelSelect, fallbackCb, enabledCb, fallbackEditor } = controls;
  const providerId = providerSelect.value.trim();
  const modelId = modelSelect.value.trim();

  if (fallbackEditor) {
    await saveRowFallbackChain(fallbackEditor);
  }

  switch (row.persistKind) {
    case 'work-agent': {
      const agent = await patchWorkAgentOverride(row.id, {
        providerId: providerId || null,
        modelId: modelId || null,
      });
      if (!agent) {
        setStatus('err', 'Could not save work agent binding');
        return;
      }
      setStatus('ok', `${row.label} binding saved`);
      void refreshModelRoutingSectionMount();
      break;
    }
    case 'sub-agent': {
      const config = await loadSubAgentConfig();
      const existing = config.types[row.id];
      if (!existing) {
        setStatus('err', 'Unknown sub-agent type');
        return;
      }
      const ok = await saveSubAgentConfigToServer({
        types: {
          [row.id]: {
            ...existing,
            providerId,
            modelId,
          },
        },
      });
      setStatus(ok ? 'ok' : 'err', ok ? `${row.label} binding saved` : 'Save failed');
      if (ok) void refreshModelRoutingSectionMount();
      break;
    }
    case 'ui-designer': {
      await saveUiDesignerConfig({
        providerId,
        modelId,
        fallbackToChatModel: fallbackCb?.checked !== false,
      });
      setStatus('ok', 'UI Designer binding saved');
      void refreshModelRoutingSectionMount();
      break;
    }
    case 'titles': {
      await saveTitlesConfig({
        providerId,
        modelId,
        enabled: enabledCb?.checked !== false,
      });
      setStatus('ok', 'Title job binding saved');
      void refreshModelRoutingSectionMount();
      break;
    }
    case 'reef-chat': {
      const chat = getActiveChat();
      chat.reefWidgetProviderId = providerId || undefined;
      chat.reefWidgetModelId = modelId || undefined;
      if (!chat.reefWidgetProviderId) chat.reefWidgetProviderId = undefined;
      if (!chat.reefWidgetModelId) chat.reefWidgetModelId = undefined;
      touchChat(chat);
      scheduleSaveSessions();
      setStatus('ok', 'Reef widget binding saved for active chat');
      syncModelRoutingReefFromActiveChat();
      break;
    }
    case 'main-chat': {
      const chat = getActiveChat();
      chat.providerId = providerId || chat.providerId;
      chat.modelId = modelId || chat.modelId;
      touchChat(chat);
      scheduleSaveSessions();
      setStatus('ok', 'Main chat model saved for active session');
      void refreshModelRoutingSectionMount();
      break;
    }
    default:
      break;
  }
}

function appendRoutingRow(
  tableBody: HTMLElement,
  controls: RowControls,
  bindingHost: HTMLElement,
): void {
  const { row } = controls;
  const tr = el('tr', 'settings-routing-row');
  tr.dataset.routingId = row.id;
  tr.dataset.settingsSearchKey = `models.routing.${row.id}`;

  const labelCell = el('td', 'settings-routing-row__label');
  const title = el('div', 'settings-routing-row__title', row.label);
  labelCell.appendChild(title);
  if (row.description) {
    const desc = el('p', 'settings-routing-row__desc', row.description);
    labelCell.appendChild(desc);
  }
  const meta = el('div', 'settings-routing-row__meta');
  if (row.disabled) {
    meta.appendChild(el('span', 'settings-badge', 'disabled'));
  }
  if (row.group === 'reef' && row.activeChatName) {
    meta.appendChild(
      el('span', 'settings-routing-row__chat', `Chat: ${row.activeChatName}`),
    );
  }
  if (meta.childElementCount) labelCell.appendChild(meta);
  tr.appendChild(labelCell);

  const bindingCell = el('td', 'settings-routing-row__binding');
  bindingCell.appendChild(bindingHost);

  const extras = el('div', 'settings-routing-row__extras');
  if (row.persistKind === 'ui-designer') {
    const { row: fallbackRow, input: fallbackInput } = createSettingsToggleRow(
      'Use chat model when unset',
      { checked: row.fallbackToChatModel !== false },
    );
    fallbackRow.classList.add('settings-toggle-row--compact');
    controls.fallbackCb = fallbackInput;
    extras.appendChild(fallbackRow);
  }
  if (row.persistKind === 'titles') {
    const { row: enabledRow, input: enabledInput } = createSettingsToggleRow(
      'Enable automatic title generation',
      { checked: row.titlesEnabled !== false },
    );
    enabledRow.classList.add('settings-toggle-row--compact');
    controls.enabledCb = enabledInput;
    extras.appendChild(enabledRow);
  }
  if (extras.childElementCount) bindingCell.appendChild(extras);

  const effective = el('p', 'settings-routing-effective');
  effective.appendChild(el('span', 'settings-routing-effective__label', 'Effective'));
  const value = el('span', 'settings-routing-effective__value', formatEffective(row));
  effective.appendChild(document.createTextNode(' '));
  effective.appendChild(value);
  controls.effectiveEl = value;
  bindingCell.appendChild(effective);

  if (supportsAdvancedPanel(row)) {
    const advanced = document.createElement('details');
    advanced.className = 'settings-routing-advanced';
    const summary = document.createElement('summary');
    summary.className = 'settings-routing-advanced__summary';
    summary.textContent = 'Sampler and thinking';
    advanced.appendChild(summary);

    const panel = el('div', 'settings-routing-advanced__body');
    const samplerFields = buildSamplerFieldInputs(row.sampler ?? null, {
      includeMaxTokens: row.persistKind === 'main-chat' || row.persistKind === 'sub-agent',
      emptyPlaceholder: row.persistKind === 'main-chat' ? '' : 'Inherit',
    });
    samplerFields.setValues(row.sampler ?? null);
    controls.samplerFields = samplerFields;
    panel.appendChild(samplerFields.root);

    const thinkingRow = el('div', 'settings-field-row');
    thinkingRow.appendChild(el('label', 'settings-field-label', 'Thinking'));
    const thinkingInitial =
      row.persistKind === 'main-chat'
        ? (row.chatThinkingMode ?? 'inherit')
        : (row.thinkingMode ?? 'inherit');
    const thinkingSelect = buildThinkingSelect(thinkingInitial);
    controls.thinkingSelect = thinkingSelect;
    thinkingRow.appendChild(thinkingSelect);
    panel.appendChild(thinkingRow);

    const saveAdvancedBtn = el('button', 'settings-action-btn', 'Save advanced');
    saveAdvancedBtn.type = 'button';
    saveAdvancedBtn.addEventListener('click', () => {
      void saveAdvanced(controls);
    });
    panel.appendChild(saveAdvancedBtn);
    advanced.appendChild(panel);
    bindingCell.appendChild(advanced);
  }

  if (loadedFallbackConfig) {
    appendRowFallbackEditor(bindingCell, controls, loadedFallbackConfig);
  }

  tr.appendChild(bindingCell);

  const actionsCell = el('td', 'settings-routing-row__actions');
  const saveBtn = el('button', 'settings-action-btn settings-action-btn--primary', 'Save');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void saveRow(controls);
  });
  actionsCell.appendChild(saveBtn);
  tr.appendChild(actionsCell);

  tableBody.appendChild(tr);
}

function appendRowFallbackEditor(
  bindingCell: HTMLElement,
  controls: RowControls,
  config: FallbackChainsConfig,
): void {
  const details = el('details', 'settings-routing-fallback');
  const summary = document.createElement('summary');
  summary.className = 'settings-routing-fallback__summary';
  summary.textContent = 'Fallback chain';
  details.appendChild(summary);

  const panel = el('div', 'settings-routing-fallback__body');
  panel.appendChild(
    el(
      'p',
      'settings-routing-fallback__hint',
      'When fallback is on, Minnow tries the next provider/model only before the first token. Leave model blank to keep the request model.',
    ),
  );

  const list = el('div', 'settings-routing-fallback__list');
  const editor: FallbackRowEditor = {
    rowId: controls.row.id,
    list,
    candidates: getFallbackCandidatesForKey(config, controls.row.id).map((candidate) => ({
      ...candidate,
    })),
  };
  controls.fallbackEditor = editor;
  panel.appendChild(list);
  renderFallbackCandidateRows(editor);

  const addBtn = el('button', 'settings-action-btn', 'Add fallback');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    editor.candidates.push({ providerId: '', modelId: '' });
    renderFallbackCandidateRows(editor);
  });
  panel.appendChild(addBtn);
  details.appendChild(panel);
  bindingCell.appendChild(details);
}

async function renderGlobalFallbackBar(mount: HTMLElement): Promise<void> {
  const config = await loadFallbackChainsConfig();
  loadedFallbackConfig = config;
  globalFallbackEditor = null;

  const section = el('section', 'settings-routing-group settings-fallback-global');
  section.dataset.settingsSearchKey = 'models.routing.fallback';
  section.appendChild(el('h3', 'settings-routing-group__title', 'Fallback'));
  section.appendChild(
    el(
      'p',
      'settings-routing-group__lead',
      'Try alternate models when a host fails. Role chains run first; the global chain is the last resort.',
    ),
  );

  const { row: enabledRow, input: enabledInput } = createSettingsToggleRow(
    'Enable fallback chains',
    { checked: config.enabled },
  );
  enabledRow.classList.add('settings-toggle-row--compact');
  globalFallbackEnabledInput = enabledInput;
  section.appendChild(enabledRow);

  const cooldownRow = el('div', 'settings-field-row');
  cooldownRow.appendChild(el('label', 'settings-field-label', 'Cooldown after failure (seconds)'));
  const cooldownInput = el('input', 'settings-input settings-input--narrow') as HTMLInputElement;
  cooldownInput.type = 'number';
  cooldownInput.min = '10';
  cooldownInput.max = '3600';
  cooldownInput.step = '1';
  cooldownInput.value = String(config.cooldownSeconds);
  globalFallbackCooldownInput = cooldownInput;
  cooldownRow.appendChild(cooldownInput);
  section.appendChild(cooldownRow);

  const globalChainSection = el('div', 'settings-fallback-global-chain');
  globalChainSection.appendChild(
    el('h4', 'settings-fallback-global-chain__title', 'Global fallback chain'),
  );
  globalChainSection.appendChild(
    el(
      'p',
      'settings-fallback-global-chain__hint',
      'Used when a role has no chain or every candidate failed. Leave model blank to keep the request model.',
    ),
  );
  const globalList = el('div', 'settings-routing-fallback__list');
  const editor: FallbackRowEditor = {
    rowId: GLOBAL_FALLBACK_CHAIN_KEY,
    list: globalList,
    candidates: getGlobalFallbackCandidates(config).map((candidate) => ({ ...candidate })),
  };
  globalFallbackEditor = editor;
  globalChainSection.appendChild(globalList);
  renderFallbackCandidateRows(editor);
  const addGlobalBtn = el('button', 'settings-action-btn', 'Add global fallback');
  addGlobalBtn.type = 'button';
  addGlobalBtn.addEventListener('click', () => {
    editor.candidates.push({ providerId: '', modelId: '' });
    renderFallbackCandidateRows(editor);
  });
  globalChainSection.appendChild(addGlobalBtn);
  section.appendChild(globalChainSection);

  const healthHost = el('div', 'settings-fallback-health');
  section.appendChild(healthHost);
  void refreshHostHealthPanel(healthHost);

  const saveBtn = el(
    'button',
    'settings-action-btn settings-action-btn--primary',
    'Save fallback settings',
  );
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void (async () => {
      const rolesPatch: Record<string, FallbackChainCandidate[]> = {};
      if (globalFallbackEditor) {
        rolesPatch[GLOBAL_FALLBACK_CHAIN_KEY] = globalFallbackEditor.candidates
          .map((row) => ({
            providerId: row.providerId.trim(),
            modelId: row.modelId.trim(),
          }))
          .filter((row) => row.providerId);
      }
      await saveFallbackChainsConfig({
        enabled: globalFallbackEnabledInput?.checked === true,
        cooldownSeconds: Number(globalFallbackCooldownInput?.value ?? config.cooldownSeconds),
        roles: rolesPatch,
      });
      setStatus('ok', 'Fallback settings saved');
      void refreshHostHealthPanel(healthHost);
    })();
  });
  section.appendChild(saveBtn);

  mount.appendChild(section);
}

function renderFallbackCandidateRows(editor: FallbackRowEditor): void {
  editor.list.replaceChildren();
  editor.candidates.forEach((candidate, index) => {
    const row = el('div', 'settings-fallback-candidate');
    const ids = {
      provider: `fallback-${editor.rowId}-${index}-provider`,
      model: `fallback-${editor.rowId}-${index}-model`,
    };
    const bindingHost = el('div', 'settings-routing-row__selects');
    const { providerSelect, modelSelect } = appendProviderModelFields(
      bindingHost,
      ids,
      undefined,
      'inline',
    );
    void fillProviderSelect(providerSelect, candidate.providerId, { includeEmptyOption: true }).then(
      () => fillModelSelect(modelSelect, providerSelect.value || candidate.providerId, candidate.modelId),
    );
    providerSelect.addEventListener('change', () => {
      candidate.providerId = providerSelect.value;
      void fillModelSelect(modelSelect, providerSelect.value, candidate.modelId);
    });
    modelSelect.addEventListener('change', () => {
      candidate.modelId = modelSelect.value;
    });
    providerSelect.value = candidate.providerId;
    candidate.providerId = providerSelect.value;
    candidate.modelId = modelSelect.value;

    const removeBtn = el('button', 'settings-action-btn', 'Remove');
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', () => {
      editor.candidates.splice(index, 1);
      renderFallbackCandidateRows(editor);
    });

    row.appendChild(bindingHost);
    row.appendChild(removeBtn);
    editor.list.appendChild(row);
  });
}

async function refreshHostHealthPanel(host: HTMLElement): Promise<void> {
  host.replaceChildren();
  host.appendChild(el('h4', 'settings-fallback-health__title', 'Hosts in cooldown'));
  try {
    const res = await fetch('/api/system/host-health', { cache: 'no-store' });
    if (!res.ok) {
      host.appendChild(el('p', 'settings-fallback-health__empty', 'Cooldown list unavailable.'));
      return;
    }
    const payload = (await res.json()) as { hosts?: { origin: string; expiresAt: string }[] };
    const hosts = payload.hosts ?? [];
    if (hosts.length === 0) {
      host.appendChild(el('p', 'settings-fallback-health__empty', 'No hosts in cooldown.'));
      return;
    }
    const list = el('ul', 'settings-fallback-health__list');
    for (const row of hosts) {
      const item = el('li', '', `${row.origin} — retry after ${row.expiresAt}`);
      list.appendChild(item);
    }
    host.appendChild(list);
  } catch {
    host.appendChild(el('p', 'settings-fallback-health__empty', 'Host health unavailable.'));
  }
}

function renderGroup(
  mount: HTMLElement,
  group: ModelRoutingGroup,
  rows: ModelRoutingRow[],
): void {
  const section = el('section', 'settings-routing-group');
  section.appendChild(el('h3', 'settings-routing-group__title', GROUP_LABELS[group]));

  if (group === 'main-chat') {
    section.appendChild(
      el(
        'p',
        'settings-routing-group__lead',
        'Matches the top-bar picker for the active chat. Sampler fields here also update global defaults on save.',
      ),
    );
  }

  if (group === 'reef') {
    section.appendChild(
      el(
        'p',
        'settings-routing-group__lead',
        'Widget model for Reef mode in the active sidebar chat.',
      ),
    );
  }

  const tableWrap = el('div', 'settings-routing-table-wrap');
  const table = el('table', 'settings-routing-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Role', 'Provider & model', '']) {
    const th = el('th', '', label);
    if (!label) th.setAttribute('aria-label', 'Actions');
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  table.appendChild(tbody);

  for (const row of rows) {
    const ids = {
      provider: `modelRouting-${row.id}-provider`,
      model: `modelRouting-${row.id}-model`,
    };
    const bindingHost = el('div', 'settings-routing-row__selects');
    const { providerSelect, modelSelect } = appendProviderModelFields(
      bindingHost,
      ids,
      undefined,
      'inline',
    );
    const controls: RowControls = { row, providerSelect, modelSelect };

    mountedRows.push(controls);
    appendRoutingRow(tbody, controls, bindingHost);
    void wireProviderModelSelects(
      controls,
      row.persistKind === 'reef-chat' ||
        row.persistKind === 'titles' ||
        row.persistKind === 'main-chat' ||
        row.persistKind === 'work-agent' ||
        row.persistKind === 'sub-agent',
    );
  }

  tableWrap.appendChild(table);
  section.appendChild(tableWrap);
  mount.appendChild(section);
}

/** Refresh Reef row selects when the active chat changes while this section is open. */
export function syncModelRoutingReefFromActiveChat(): void {
  const reef = mountedRows.find((r) => r.row.persistKind === 'reef-chat');
  if (!reef) return;
  const chat = getActiveChat();
  lastCatalogChatId = chat.id;
  void (async () => {
    await fillProviderSelect(reef.providerSelect, chat.reefWidgetProviderId ?? '', {
      includeEmptyOption: true,
    });
    const providerId =
      chat.reefWidgetProviderId ?? chat.providerId ?? reef.providerSelect.value ?? '';
    await fillModelSelect(reef.modelSelect, providerId, chat.reefWidgetModelId ?? '');
    const chatEl = document.querySelector(
      '[data-routing-id="reef-widget"] .settings-routing-row__chat',
    );
    if (chatEl) {
      chatEl.textContent = `Chat: ${chat.name?.trim() || 'Untitled chat'}`;
    }
    setEffectiveText(reef);
  })();
}

/** Render the model routing settings section into #settingsModelRoutingBody. */
export async function renderModelRoutingSection(mount: HTMLElement): Promise<void> {
  mountedRows = [];
  mount.replaceChildren();
  mount.dataset.settingsSearchKey = 'models.routing';

  const storageMode = await detectConfigServer();
  refreshConfigStorageBanner();

  if (!isConfigServerMode(storageMode)) {
    mount.appendChild(
      el(
        'p',
        'settings-server-banner',
        'Model routing needs npm start. Values below are read-only until the server is running.',
      ),
    );
  }

  try {
    const { providers } = await listProviders();
    const activeProvider =
      providers.find((p) => p.enabled !== false)?.id ?? 'lm-studio-local';

    const catalog = await loadModelRoutingCatalog({
      providerId: activeProvider,
      modelId: '',
    });

    lastCatalogChatId = catalog.activeChat.id;

    if (catalog.offline) {
      mount.appendChild(
        el(
          'p',
          'settings-server-banner',
          'Run npm start to load bindings from ~/.minnow.',
        ),
      );
      return;
    }

    await renderGlobalFallbackBar(mount);

    for (const group of GROUP_ORDER) {
      const groupRows = catalog.rows.filter((r) => r.group === group);
      if (groupRows.length === 0) continue;
      renderGroup(mount, group, groupRows);
    }
  } catch (err) {
    console.error('[model-routing] render failed', err);
    mount.appendChild(
      el(
        'p',
        'settings-server-banner',
        'Could not load bindings. Switch tabs and back, or refresh the page.',
      ),
    );
  }
}

/** Re-render when catalog may be stale (after save). */
export async function refreshModelRoutingSectionMount(): Promise<void> {
  const mount = document.getElementById('settingsModelRoutingBody');
  if (!mount) return;
  await renderModelRoutingSection(mount);
}

/** Called on chat switch when model-routing panel may be visible. */
export function onModelRoutingActiveChatChanged(chatId: string): void {
  if (chatId === lastCatalogChatId) return;
  lastCatalogChatId = chatId;
  syncModelRoutingReefFromActiveChat();
  const mount = document.getElementById('settingsModelRoutingBody');
  if (mount?.childElementCount) void refreshModelRoutingSectionMount();
}
