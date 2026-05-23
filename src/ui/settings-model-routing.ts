/**
 * Settings → Model routing — consolidated per-role provider/model bindings.
 */

import { patchWorkAgentOverride } from '../agents/work-agent-prompt-api';
import { saveSubAgentConfigToServer, loadSubAgentConfig } from '../agents/sub-agent-config';
import { saveUiDesignerConfig } from '../agents/ui-designer/config';
import { saveTitlesConfig } from '../config/titles-meta';
import { isServerStorageMode } from '../config/storage-mode';
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
import { setStatus } from './status';

const GROUP_LABELS: Record<ModelRoutingGroup, string> = {
  'work-agents': 'Work agents',
  'sub-agents': 'Sub-agent types',
  background: 'Background jobs',
  reef: 'Reef (active chat)',
};

const GROUP_ORDER: ModelRoutingGroup[] = [
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
}

let mountedRows: RowControls[] = [];
let lastCatalogChatId: string | null = null;

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
    return `Effective: ${row.effectiveModelId || '(chat default)'} on ${row.effectiveProviderId || '—'}`;
  }
  if (row.persistKind === 'ui-designer' && row.fallbackToChatModel && row.usesChatDefault) {
    return `Effective: chat default (${row.effectiveModelId || '—'})`;
  }
  return `Effective: ${row.effectiveModelId || '—'} on ${row.effectiveProviderId || '—'}`;
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

async function saveRow(controls: RowControls): Promise<void> {
  const { row, providerSelect, modelSelect, fallbackCb, enabledCb } = controls;
  const providerId = providerSelect.value.trim();
  const modelId = modelSelect.value.trim();

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
            providerId: providerId || existing.providerId,
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

  const labelCell = el('td', 'settings-routing-row__label');
  const title = el('div', 'settings-routing-row__title', row.label);
  labelCell.appendChild(title);
  if (row.description) {
    labelCell.appendChild(el('p', 'settings-field-hint', row.description));
  }
  if (row.disabled) {
    labelCell.appendChild(el('span', 'settings-badge', 'disabled'));
  }
  if (row.group === 'reef' && row.activeChatName) {
    labelCell.appendChild(
      el('p', 'settings-field-hint', `Active chat: ${row.activeChatName}`),
    );
  }
  tr.appendChild(labelCell);

  const bindingCell = el('td', 'settings-routing-row__binding');
  bindingCell.appendChild(bindingHost);

  if (row.persistKind === 'ui-designer' && controls.fallbackCb) {
    const fallbackRow = el('label', 'settings-toggle-row');
    fallbackRow.appendChild(controls.fallbackCb);
    fallbackRow.appendChild(el('span', '', 'Fallback to chat model when unset'));
    bindingCell.appendChild(fallbackRow);
  }
  if (row.persistKind === 'titles' && controls.enabledCb) {
    const enabledRow = el('label', 'settings-toggle-row');
    enabledRow.appendChild(controls.enabledCb);
    enabledRow.appendChild(el('span', '', 'Enable automatic title generation'));
    bindingCell.appendChild(enabledRow);
  }

  bindingCell.appendChild(el('p', 'settings-field-hint', formatEffective(row)));
  tr.appendChild(bindingCell);

  const actionsCell = el('td', 'settings-routing-row__actions');
  const saveBtn = el('button', 'settings-action-btn', 'Save');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void saveRow(controls);
  });
  actionsCell.appendChild(saveBtn);

  const advancedLink = el('a', 'settings-inline-link', 'Advanced…');
  advancedLink.href = row.advancedSettingsHash;
  advancedLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.hash = row.advancedSettingsHash;
  });
  actionsCell.appendChild(advancedLink);
  tr.appendChild(actionsCell);

  tableBody.appendChild(tr);
}

function renderGroup(
  mount: HTMLElement,
  group: ModelRoutingGroup,
  rows: ModelRoutingRow[],
): void {
  const section = el('section', 'settings-routing-group');
  section.appendChild(el('h3', 'settings-routing-group__title', GROUP_LABELS[group]));

  if (group === 'reef') {
    section.appendChild(
      el(
        'p',
        'settings-field-hint',
        'Reef widget LLM is stored per chat. Values below apply to the sidebar active chat only.',
      ),
    );
  }

  const table = el('table', 'settings-routing-table');
  table.appendChild(
    Object.assign(el('thead'), {
      innerHTML:
        '<tr><th scope="col">Role</th><th scope="col">Binding</th><th scope="col">Actions</th></tr>',
    }),
  );
  const tbody = el('tbody');
  table.appendChild(tbody);

  for (const row of rows) {
    const ids = {
      provider: `modelRouting-${row.id}-provider`,
      model: `modelRouting-${row.id}-model`,
    };
    const bindingHost = el('div', 'settings-routing-row__selects');
    const { providerSelect, modelSelect } = appendProviderModelFields(bindingHost, ids);
    const controls: RowControls = { row, providerSelect, modelSelect };

    if (row.persistKind === 'ui-designer') {
      const fallbackCb = document.createElement('input');
      fallbackCb.type = 'checkbox';
      fallbackCb.checked = row.fallbackToChatModel !== false;
      controls.fallbackCb = fallbackCb;
    }
    if (row.persistKind === 'titles') {
      const enabledCb = document.createElement('input');
      enabledCb.type = 'checkbox';
      enabledCb.checked = row.titlesEnabled !== false;
      controls.enabledCb = enabledCb;
    }

    mountedRows.push(controls);
    appendRoutingRow(tbody, controls, bindingHost);
    void wireProviderModelSelects(
      controls,
      row.persistKind === 'reef-chat' || row.persistKind === 'titles',
    );
  }

  section.appendChild(table);
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
    const nameEl = document.querySelector(
      '[data-routing-id="reef-widget"] .settings-field-hint',
    );
    if (nameEl) {
      nameEl.textContent = `Active chat: ${chat.name?.trim() || 'Untitled chat'}`;
    }
  })();
}

/** Render the model routing settings section into #settingsModelRoutingBody. */
export async function renderModelRoutingSection(mount: HTMLElement): Promise<void> {
  mountedRows = [];
  mount.replaceChildren();

  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Main chat default is the top-bar model picker. This page lists per-role overrides for work agents, sub-agents, background jobs, and Reef.',
    ),
  );

  if (!isServerStorageMode()) {
    mount.appendChild(
      el(
        'p',
        'settings-server-banner',
        'Model routing saves require npm start (config server). Values below are read-only until the server is up.',
      ),
    );
  }

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
        'Start with npm start to load bindings from ~/.minnow.',
      ),
    );
    return;
  }

  for (const group of GROUP_ORDER) {
    const groupRows = catalog.rows.filter((r) => r.group === group);
    if (groupRows.length === 0) continue;
    renderGroup(mount, group, groupRows);
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
  syncModelRoutingReefFromActiveChat();
}
