/**
 * Settings → Agents center — card grid for modes, work agents, and sub-agents.
 * Opens a lightbox with prompt, model binding, and entity-specific settings.
 */

import { fetchWorkAgentsList } from '../agents/work-agent-prompt-api';
import type { WorkAgentDefinition } from '../agents/work-agent-types';
import {
  clampSubAgentMaxToolTurns,
  getSubAgentsMaxToolTurns,
  loadSubAgentConfig,
  saveSubAgentConfigToServer,
} from '../agents/sub-agent-config';
import type { SubAgentTypeConfig } from '../agents/types';
import { listModes } from '../chat/modes/registry';
import { getActiveChat } from '../state/sessions';
import { isServerStorageMode } from '../config/storage-mode';
import { appendSettingsGroup } from './settings-layout';
import { appendSettingsOfflineHint, createSettingsKvList, createSettingsSelectRow } from './settings-controls';
import {
  mountPromptFileEditor,
  mountSubAgentTypeEditor,
  mountWorkAgentConfigEditor,
  mountWorkAgentPromptEditor,
} from './settings-entity-editor';
import { mountStandaloneRoutingEditor } from './settings-model-routing';
import {
  appendAgentCenterSection,
  openAgentCenterLightbox,
} from './settings-agent-center-lightbox';
import { mountReefWidgetLlmSettings } from './reef-widget-settings';
import {
  loadPromptMetaSettings,
  savePromptMetaSettings,
} from '../config/prompt-meta';
import { schedulePromptTokenEstimateRefresh } from './settings-prompt-estimate';
import { createSettingsSwitch } from './settings-switch';
import { setStatus } from './status';

export type AgentCenterSectionId = 'modes' | 'work-agents' | 'sub-agents';

export interface AgentCenterCard {
  id: string;
  kind: AgentCenterSectionId;
  title: string;
  description: string;
  meta?: string;
  searchKey: string;
  disabled?: boolean;
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

/** Collect cards for the agents center grid. */
export async function loadAgentCenterCards(): Promise<AgentCenterCard[]> {
  const cards: AgentCenterCard[] = [];

  for (const mode of listModes()) {
    if (mode.id === 'desktop') continue;
    cards.push({
      id: `mode:${mode.id}`,
      kind: 'modes',
      title: mode.label,
      description: mode.description,
      meta: `Tool policy: ${mode.toolPolicy.default}`,
      searchKey: `modes.${mode.id}`,
    });
  }

  const remote = await fetchWorkAgentsList();
  for (const agent of remote?.agents ?? []) {
    cards.push({
      id: `work-agent:${agent.id}`,
      kind: 'work-agents',
      title: agent.label,
      description: agent.description,
      meta: agent.defaultForModes?.length
        ? `Default for: ${agent.defaultForModes.join(', ')}`
        : undefined,
      searchKey: `work-agents.${agent.id}`,
      disabled: agent.disabled === true,
    });
  }

  const subConfig = await loadSubAgentConfig();
  for (const [typeId, type] of Object.entries(subConfig.types)) {
    cards.push({
      id: `sub-agent:${typeId}`,
      kind: 'sub-agents',
      title: type.label ?? typeId,
      description:
        type.workAgentId != null
          ? `Uses work agent ${type.workAgentId} for prompt composition.`
          : 'Background worker spawned from parent chats.',
      meta: `Max concurrent ${type.maxConcurrent}`,
      searchKey: `sub-agents.${typeId}`,
      disabled: type.enabled === false,
    });
  }

  return cards;
}

async function mountPlanGranularityField(container: HTMLElement): Promise<void> {
  const select = document.createElement('select');
  select.className = 'settings-select';
  const options: { value: string; label: string }[] = [
    { value: 'large', label: 'Large: one task per feature or module' },
    { value: 'medium', label: 'Medium: one task per component or function group (default)' },
    { value: 'small', label: 'Small: separate task for every function and config key' },
  ];
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }
  const { row } = createSettingsSelectRow('Plan granularity', {
    select,
    description:
      'Controls how finely the Planner breaks work into tasks. The user can override this per session.',
  });
  container.appendChild(row);
  const meta = await loadPromptMetaSettings();
  select.value = meta.planGranularity ?? 'medium';
  select.onchange = async () => {
    const value = select.value as 'large' | 'medium' | 'small';
    await savePromptMetaSettings({ planGranularity: value });
    schedulePromptTokenEstimateRefresh();
  };
}

function findDefaultWorkAgentForMode(
  modeId: string,
  agents: WorkAgentDefinition[],
): WorkAgentDefinition | null {
  for (const agent of agents) {
    if (agent.disabled || agent.id === 'default') continue;
    if (agent.defaultForModes?.includes(modeId)) return agent;
  }
  return null;
}

function openModeLightbox(modeId: string, agents: WorkAgentDefinition[]): void {
  const mode = listModes().find((m) => m.id === modeId);
  if (!mode) return;
  const defaultAgent = findDefaultWorkAgentForMode(modeId, agents);
  const chat = getActiveChat();

  openAgentCenterLightbox({
    title: mode.label,
    subtitle: mode.description,
    badge: 'Mode',
    render: (body) => {
      appendAgentCenterSection(body, 'Defaults', (panel) => {
        const list = document.createElement('dl');
        list.className = 'agent-center-kv';
        const workDt = document.createElement('dt');
        workDt.textContent = 'Default work agent';
        const workDd = document.createElement('dd');
        workDd.textContent = defaultAgent?.label ?? 'Passthrough (chat picker)';
        const modelDt = document.createElement('dt');
        modelDt.textContent = 'Chat model';
        const modelDd = document.createElement('dd');
        modelDd.textContent = `${chat.modelId || '(none)'} · ${chat.providerId || '(none)'}`;
        const policyDt = document.createElement('dt');
        policyDt.textContent = 'Tool policy';
        const policyDd = document.createElement('dd');
        policyDd.textContent = mode.toolPolicy.default;
        list.append(workDt, workDd, modelDt, modelDd, policyDt, policyDd);
        panel.appendChild(list);
        panel.appendChild(
          el(
            'p',
            'agent-center-section__lead',
            'Modes use the active chat model from the top-bar picker. Reef widget LLM is configured below when applicable.',
          ),
        );
      });

      if (modeId === 'plan' || modeId === 'reef') {
        appendAgentCenterSection(body, 'Mode options', (panel) => {
          if (modeId === 'plan') void mountPlanGranularityField(panel);
          if (modeId === 'reef') mountReefWidgetLlmSettings(panel);
        });
      }

      appendAgentCenterSection(body, 'System prompt', (panel) => {
        mountPromptFileEditor(panel, { family: 'modes', entityId: modeId });
      });
    },
  });
}

function openWorkAgentLightbox(agent: WorkAgentDefinition): void {
  openAgentCenterLightbox({
    title: agent.label,
    subtitle: agent.description,
    badge: 'Work agent',
    render: (body) => {
      appendAgentCenterSection(body, 'Model', (panel) => {
        void mountStandaloneRoutingEditor(panel, agent.id);
      });

      appendAgentCenterSection(body, 'Agent settings', (panel) => {
        mountWorkAgentConfigEditor(panel, {
          agentId: agent.id,
          initialProviderId: agent.providerId,
          initialModelId: agent.modelId,
          initialDisabled: agent.disabled === true,
          initialMaxInputTokens: agent.maxInputTokens ?? null,
          initialContextPolicy: agent.contextEnforcementPolicy ?? 'summarize',
          initialArchive: agent.archive,
        });
      });

      appendAgentCenterSection(body, 'System prompt', (panel) => {
        mountWorkAgentPromptEditor(panel, { agentId: agent.id });
      });
    },
  });
}

function openSubAgentLightbox(
  typeId: string,
  type: SubAgentTypeConfig,
  onRefresh: () => void,
): void {
  const label = type.label ?? typeId;
  openAgentCenterLightbox({
    title: label,
    subtitle: type.workAgentId
      ? `Prompt composed via work agent ${type.workAgentId}.`
      : 'Background worker with its own tool policy.',
    badge: 'Sub-agent',
    render: (body) => {
      appendAgentCenterSection(body, 'Model', (panel) => {
        void mountStandaloneRoutingEditor(panel, typeId);
      });

      appendAgentCenterSection(body, 'Type settings', (panel) => {
        mountSubAgentTypeEditor(
          panel,
          typeId,
          label,
          {
            enabled: type.enabled !== false,
            maxConcurrent: type.maxConcurrent,
            maxInputTokens: type.maxInputTokens ?? null,
            contextEnforcementPolicy: type.contextEnforcementPolicy ?? 'summarize',
            summarySchema: type.summarySchema ?? 'minnow.sub-agent.v1',
          },
          async (patch) => {
            const fresh = await loadSubAgentConfig();
            const types = { ...fresh.types };
            types[typeId] = { ...types[typeId], ...patch };
            const ok = await saveSubAgentConfigToServer({ types });
            if (ok) onRefresh();
            return ok;
          },
        );
      });

      appendAgentCenterSection(body, 'System prompt', (panel) => {
        mountPromptFileEditor(panel, { family: 'sub-agents', entityId: typeId });
      });
    },
  });
}

function renderCardButton(card: AgentCenterCard, agents: WorkAgentDefinition[]): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-agent-card';
  btn.dataset.settingsSearchKey = card.searchKey;

  const title = el('h3', 'settings-agent-card__title', card.title);
  const desc = el('p', 'settings-agent-card__desc', card.description);
  btn.append(title, desc);

  if (card.meta) {
    btn.appendChild(el('p', 'settings-agent-card__meta', card.meta));
  }
  if (card.disabled) {
    btn.appendChild(el('span', 'settings-badge', 'disabled'));
  }

  btn.addEventListener('click', () => {
    if (card.kind === 'modes') {
      openModeLightbox(card.id.replace(/^mode:/, ''), agents);
      return;
    }
    if (card.kind === 'work-agents') {
      const agentId = card.id.replace(/^work-agent:/, '');
      const agent = agents.find((a) => a.id === agentId);
      if (agent) openWorkAgentLightbox(agent);
      return;
    }
    if (card.kind === 'sub-agents') {
      const typeId = card.id.replace(/^sub-agent:/, '');
      void loadSubAgentConfig().then((config) => {
        const type = config.types[typeId];
        if (type) {
          openSubAgentLightbox(typeId, type, () => {
            void renderAgentCenterPanel(document.getElementById('settingsAgentCenterBody'));
          });
        }
      });
    }
  });

  return btn;
}

function createAgentCenterGrid(): HTMLUListElement {
  const grid = el('ul', 'settings-agent-center__grid');
  return grid;
}

function cardMatchesQuery(card: AgentCenterCard, query: string): boolean {
  if (!query) return true;
  const hay = `${card.title} ${card.description} ${card.meta ?? ''}`.toLowerCase();
  return hay.includes(query);
}

const AGENT_CENTER_SECTIONS: {
  id: AgentCenterSectionId;
  title: string;
  hint: string;
  searchKey: string;
}[] = [
  {
    id: 'modes',
    title: 'Modes',
    hint: 'Composer modes — system prompts, tool policy, and mode-specific options.',
    searchKey: 'agents.modes',
  },
  {
    id: 'work-agents',
    title: 'Work agents',
    hint: 'Reusable agent profiles with their own model binding and prompt.',
    searchKey: 'agents.workAgents',
  },
  {
    id: 'sub-agents',
    title: 'Sub-agents',
    hint: 'Background workers spawned from parent chats.',
    searchKey: 'agents.subAgents',
  },
];

async function mountGlobalSubAgentLimits(mount: HTMLElement): Promise<void> {
  const config = await loadSubAgentConfig();
  const groupBody = appendSettingsGroup(
    mount,
    'Sub-agent limits',
    'Global concurrency, timeouts, and check-in nudges for all sub-agent types.',
  );
  groupBody.classList.add('settings-agent-center__global');

  const persistGlobal = async (
    patch: Partial<
      Pick<
        typeof config,
        'enabled' | 'globalMaxConcurrent' | 'defaultTimeoutMs' | 'checkInNudgeMs'
      >
    >,
  ): Promise<void> => {
    const fresh = await loadSubAgentConfig();
    const ok = await saveSubAgentConfigToServer({ ...fresh, ...patch });
    setStatus(ok ? 'ok' : 'err', ok ? 'Sub-agents updated' : 'Save failed — use npm start');
  };

  const { root: enabledSwitch, input: enabledCb } = createSettingsSwitch({
    checked: config.enabled !== false,
    ariaLabel: 'Enable sub-agents',
  });

  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.className = 'settings-select settings-kv-input';
  maxInput.min = '1';
  maxInput.max = '16';
  maxInput.step = '1';
  maxInput.value = String(config.globalMaxConcurrent);
  maxInput.setAttribute('aria-label', 'Max concurrent sub-agents');

  const timeoutWrap = el('span', 'settings-kv-input-wrap');
  const timeoutInput = document.createElement('input');
  timeoutInput.type = 'number';
  timeoutInput.className = 'settings-select settings-kv-input';
  timeoutInput.min = '1000';
  timeoutInput.step = '1000';
  timeoutInput.value = String(config.defaultTimeoutMs);
  timeoutInput.setAttribute('aria-label', 'Default sub-agent timeout in milliseconds');
  timeoutWrap.appendChild(timeoutInput);
  timeoutWrap.appendChild(el('span', 'settings-kv-suffix', 'ms'));

  const nudgeWrap = el('span', 'settings-kv-input-wrap');
  const nudgeInput = document.createElement('input');
  nudgeInput.type = 'number';
  nudgeInput.className = 'settings-select settings-kv-input';
  nudgeInput.min = '0';
  nudgeInput.step = '1000';
  nudgeInput.value = String(config.checkInNudgeMs ?? 120_000);
  nudgeInput.setAttribute(
    'aria-label',
    'Sub-agent check-in nudge interval in milliseconds (0 disables)',
  );
  nudgeWrap.appendChild(nudgeInput);
  nudgeWrap.appendChild(el('span', 'settings-kv-suffix', 'ms'));

  groupBody.appendChild(
    createSettingsKvList([
      { term: 'Enabled', value: enabledSwitch },
      { term: 'Max concurrent', value: maxInput },
      { term: 'Default timeout', value: timeoutWrap },
      { term: 'Check-in nudge', value: nudgeWrap },
    ]),
  );

  enabledCb.addEventListener('change', () => {
    void persistGlobal({ enabled: enabledCb.checked });
  });
  maxInput.addEventListener('change', () => {
    const value = Math.min(16, Math.max(1, Math.floor(Number(maxInput.value) || 1)));
    maxInput.value = String(value);
    void persistGlobal({ globalMaxConcurrent: value });
  });
  timeoutInput.addEventListener('change', () => {
    const value = Math.max(1000, Math.floor(Number(timeoutInput.value) || 1000));
    timeoutInput.value = String(value);
    void persistGlobal({ defaultTimeoutMs: value });
  });
  nudgeInput.addEventListener('change', () => {
    const raw = Math.floor(Number(nudgeInput.value) || 0);
    const value = raw <= 0 ? 0 : Math.min(1_800_000, Math.max(10_000, raw));
    nudgeInput.value = String(value);
    void persistGlobal({ checkInNudgeMs: value });
  });

  const maxTurns = document.createElement('input');
  maxTurns.type = 'number';
  maxTurns.className = 'settings-select settings-kv-input';
  maxTurns.min = '1';
  maxTurns.max = '64';
  maxTurns.step = '1';
  maxTurns.value = String(getSubAgentsMaxToolTurns(config));
  maxTurns.setAttribute('aria-label', 'Sub-agent max tool turns');
  maxTurns.addEventListener('change', () => {
    const value = clampSubAgentMaxToolTurns(Number(maxTurns.value));
    maxTurns.value = String(value);
    void saveSubAgentConfigToServer({ maxToolTurns: value }).then((ok) => {
      setStatus(ok ? 'ok' : 'err', ok ? 'Max tool turns saved' : 'Save failed');
    });
  });
  groupBody.appendChild(
    createSettingsKvList([{ term: 'Max tool turns', value: maxTurns }]),
  );
}

/** Render the agents center card grid into the settings mount. */
export async function renderAgentCenterPanel(
  mount: HTMLElement | null,
): Promise<void> {
  if (!mount) return;
  mount.replaceChildren();

  if (!isServerStorageMode()) {
    appendSettingsOfflineHint(
      mount,
      'Agent editing requires <code>npm start</code>. Cards are read-only until the server is running.',
    );
  }

  const toolbar = el('div', 'settings-agent-center__toolbar');
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'settings-select settings-agent-center__search';
  search.placeholder = 'Search modes and agents…';
  search.setAttribute('aria-label', 'Filter agents center');
  toolbar.appendChild(search);
  mount.appendChild(toolbar);

  const sectionsHost = el('div', 'settings-agent-center__sections');
  mount.appendChild(sectionsHost);

  const remote = await fetchWorkAgentsList();
  const agents = remote?.agents ?? [];
  const allCards = await loadAgentCenterCards();

  const sectionGrids = new Map<AgentCenterSectionId, HTMLUListElement>();
  const sectionGroups = new Map<AgentCenterSectionId, HTMLElement>();

  for (const def of AGENT_CENTER_SECTIONS) {
    const groupBody = appendSettingsGroup(sectionsHost, def.title, def.hint, def.searchKey);
    groupBody.classList.add('settings-agent-center__section');

    if (def.id === 'sub-agents') {
      await mountGlobalSubAgentLimits(groupBody);
    }

    const grid = createAgentCenterGrid();
    groupBody.appendChild(grid);
    sectionGrids.set(def.id, grid);
    sectionGroups.set(def.id, groupBody.closest('.settings-group') as HTMLElement);
  }

  const applyFilter = (): void => {
    const query = search.value.trim().toLowerCase();

    for (const def of AGENT_CENTER_SECTIONS) {
      const grid = sectionGrids.get(def.id);
      const group = sectionGroups.get(def.id);
      if (!grid || !group) continue;

      grid.replaceChildren();
      const filtered = allCards.filter(
        (card) => card.kind === def.id && cardMatchesQuery(card, query),
      );

      const keepSectionVisible = def.id === 'sub-agents';

      if (!filtered.length) {
        if (keepSectionVisible) {
          group.hidden = false;
          if (query) {
            grid.appendChild(
              el('li', 'settings-field-hint', 'No sub-agent types match this search.'),
            );
          }
        } else {
          group.hidden = true;
        }
        continue;
      }

      group.hidden = false;
      for (const card of filtered) {
        const item = document.createElement('li');
        item.appendChild(renderCardButton(card, agents));
        grid.appendChild(item);
      }
    }
  };

  search.addEventListener('input', applyFilter);
  applyFilter();
}
