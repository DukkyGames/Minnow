import { listExperts } from '../chat/experts/registry';
import { listModes } from '../chat/modes/registry';
import { isModeVisibleInSettingsSearch } from '../chat/modes/settings-visibility';
import { isDeveloperReleased } from '../os/app-registry';
import { loadSubAgentConfig } from '../agents/sub-agent-config';
import { fetchWorkAgentsList } from '../agents/work-agent-prompt-api';
import { isServerStorageMode } from '../config/storage-mode';
import { appendSettingsGroup, appendSettingsCrosslinks } from './settings-layout';
import { appendSettingsOfflineHint } from './settings-controls';
import {
  mountPromptFileEditor,
  mountWorkAgentPromptEditor,
  renderEntityEditorList,
  type EntityEditorRow,
} from './settings-entity-editor';

export type PromptHubFilter =
  | 'all'
  | 'modes'
  | 'experts'
  | 'work-agents'
  | 'sub-agents'
  | 'rules';

export interface PromptHubRow extends EntityEditorRow {
  filter: Exclude<PromptHubFilter, 'all' | 'rules'>;
  renderBody: (body: HTMLElement) => void;
}

// ── Load ─────────────────────────────────────────────────────────────────────

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

/** Collect every editable role prompt for the hub list. */
export async function loadPromptHubRows(): Promise<PromptHubRow[]> {
  const rows: PromptHubRow[] = [];

  for (const mode of listModes()) {
    if (!isModeVisibleInSettingsSearch(mode.id)) continue;
    rows.push({
      id: `mode:${mode.id}`,
      label: mode.label,
      hint: mode.description,
      badge: 'Mode',
      filter: 'modes',
      renderBody: (body) => {
        mountPromptFileEditor(body, { family: 'modes', entityId: mode.id });
      },
    });
  }

  if (isDeveloperReleased('experts')) {
    for (const expert of listExperts()) {
      rows.push({
        id: `expert:${expert.meta.id}`,
        label: expert.meta.label,
        hint: expert.meta.description ?? '',
        badge: 'Expert',
        filter: 'experts',
        renderBody: (body) => {
          mountPromptFileEditor(body, { family: 'experts', entityId: expert.meta.id });
        },
      });
    }
  }

  const remote = await fetchWorkAgentsList();
  for (const agent of remote?.agents ?? []) {
    rows.push({
      id: `work-agent:${agent.id}`,
      label: agent.label,
      hint: agent.description,
      badge: 'Work agent',
      filter: 'work-agents',
      renderBody: (body) => {
        mountWorkAgentPromptEditor(body, { agentId: agent.id });
      },
    });
  }

  const subConfig = await loadSubAgentConfig();
  for (const [typeId, type] of Object.entries(subConfig.types)) {
    rows.push({
      id: `sub-agent:${typeId}`,
      label: type.label ?? typeId,
      hint: type.workAgentId ? `Work agent: ${type.workAgentId}` : undefined,
      badge: 'Sub-agent',
      filter: 'sub-agents',
      renderBody: (body) => {
        mountPromptFileEditor(body, { family: 'sub-agents', entityId: typeId });
      },
    });
  }

  return rows;
}

// ── Row ──────────────────────────────────────────────────────────────────────

function mountRulesHubRow(body: HTMLElement): void {
  body.appendChild(
    el(
      'p',
      'settings-field-hint',
      'User rules are edited on the Rules page (global instructions after the composed system prompt).',
    ),
  );
  appendSettingsCrosslinks(body, [{ label: 'Open Rules', sectionId: 'rules' }]);
}

// ── Render ───────────────────────────────────────────────────────────────────

/** Render searchable "All role prompts" panel under base prompt parts. */
export async function renderPromptsHubPanel(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();

  const groupBody = appendSettingsGroup(
    mount,
    'All role prompts',
    'Search and filter every mode, expert, work agent, and sub-agent prompt. Overrides save under ~/.minnow/prompts/.',
  );

  if (!isServerStorageMode()) {
    appendSettingsOfflineHint(
      groupBody,
      'Role prompt editing requires Minnow running locally.',
    );
    return;
  }

  const toolbar = el('div', 'settings-prompts-hub__toolbar');
  const search = document.createElement('input');
  search.type = 'search';
  search.id = 'settingsPromptsHubSearch';
  search.className = 'settings-select settings-prompts-hub__search';
  search.placeholder = 'Search by name or description…';
  search.setAttribute('aria-label', 'Filter role prompts');
  toolbar.appendChild(search);

  const chips = el('div', 'settings-prompts-hub__filters');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Prompt type filter');

  const filterDefs: { id: PromptHubFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'modes', label: 'Modes' },
    ...(isDeveloperReleased('experts')
      ? [{ id: 'experts' as const, label: 'Experts' }]
      : []),
    { id: 'work-agents', label: 'Work agents' },
    { id: 'sub-agents', label: 'Sub-agents' },
    { id: 'rules', label: 'Rules' },
  ];

  let activeFilter: PromptHubFilter = 'all';
  const listHost = el('div', 'settings-prompts-hub__list');
  groupBody.appendChild(toolbar);
  groupBody.appendChild(chips);
  groupBody.appendChild(listHost);

  const allRows = await loadPromptHubRows();
  const rulesRow: EntityEditorRow = {
    id: 'rules:user',
    label: 'User rules',
    hint: 'Global instructions on every parent chat send',
    badge: 'Rules',
  };

  const applyFilter = (): void => {
    const query = search.value.trim().toLowerCase();
    const matchesQuery = (row: EntityEditorRow): boolean => {
      if (!query) return true;
      const hay = `${row.label} ${row.hint ?? ''} ${row.badge ?? ''}`.toLowerCase();
      return hay.includes(query);
    };

    listHost.replaceChildren();

    if (activeFilter === 'rules') {
      if (!matchesQuery(rulesRow)) return;
      renderEntityEditorList(listHost, [rulesRow], (_id, body) => {
        mountRulesHubRow(body);
      });
      return;
    }

    const filtered = allRows.filter((row) => {
      if (activeFilter !== 'all' && row.filter !== activeFilter) return false;
      return matchesQuery(row);
    });

    if (!filtered.length) {
      listHost.appendChild(
        el('p', 'settings-field-hint', 'No prompts match this search or filter.'),
      );
      return;
    }

    renderEntityEditorList(
      listHost,
      filtered,
      (id, body) => {
        const row = filtered.find((r) => r.id === id);
        row?.renderBody(body);
      },
    );
  };

  for (const def of filterDefs) {
    const chip = el('button', 'settings-prompts-hub__chip', def.label);
    chip.type = 'button';
    chip.dataset.filter = def.id;
    if (def.id === activeFilter) chip.classList.add('is-active');
    chip.addEventListener('click', () => {
      activeFilter = def.id;
      chips.querySelectorAll('.settings-prompts-hub__chip').forEach((node) => {
        node.classList.toggle(
          'is-active',
          (node as HTMLButtonElement).dataset.filter === activeFilter,
        );
      });
      applyFilter();
    });
    chips.appendChild(chip);
  }

  search.addEventListener('input', applyFilter);
  applyFilter();
}
