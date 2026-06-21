/**
 * Populate full settings page sections from Step 02–18 APIs (no placeholder stubs).
 */

import { fetchWorkAgentsList } from '../agents/work-agent-prompt-api';
import {
  clampSubAgentMaxToolTurns,
  getSubAgentsMaxToolTurns,
  loadSubAgentConfig,
  saveSubAgentConfigToServer,
} from '../agents/sub-agent-config';
import type { SubAgentTypeConfig } from '../agents/types';
import { PART_ORDER } from '../chat/prompts/prompt-composer';
import { schedulePromptTokenEstimateRefresh } from './settings-prompt-estimate';
import { mountSetupProfilesPanel } from './settings-profiles';
import { loadPromptById } from '../chat/prompts/prompt-loader';
import {
  customPartBaselineProfileHint,
  isPromptPartDiffSupported,
  resolveBuiltinPromptBaselineForPart,
} from '../chat/prompts/prompt-baseline';
import { mountPromptDiffControls } from './prompt-diff-panel';
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
import {
  loadUserRules,
  MAX_USER_RULES_BYTES,
  saveUserRules,
} from '../config/user-rules';
import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import {
  loadAutopilotMeta,
  saveAutopilotMeta,
  type AutopilotExecutionMode,
  type AutopilotIsolationMode,
} from '../config/autopilot-meta';
import { listProviders } from '../providers/store';
import { getActiveChat } from '../state/sessions';
import { renderProvidersSettingsSection } from './settings-providers';
import { renderUsageSettingsSection } from './settings-usage';
import {
  createMemoryEntry,
  deleteMemoryEntry,
  fetchMemoryEntries,
  fetchMemoryStatus,
} from '../memory/client';
import { parseMemoryTagsInput } from '../memory/parse-tags';
import type { MemoryEntryWithBody } from '../memory/types';
import { mountMemoryEmbeddingsPanel } from './settings-memory-embeddings';
import { mountMemorySynthesisSettingsPanel } from './settings-memory-synthesis';
import { renderAudioSettingsSection } from './settings-audio';
import { renderNotificationsSettingsSection } from './settings-notifications';
import { mountMemoryProposalsPanel } from './memory-proposals-panel';
import { renderAgentPacksSettingsSection } from './settings-agent-packs';
import { renderSkillsSettingsSection } from './settings-skills';
import {
  fillToolsSection,
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
  isToolConfigReadyForSettingsUi,
  loadToolConfigForSettingsUi,
  loadToolConfigIntoDrawer,
  resetBuiltInToolPermissionsToDefaults,
  saveToolConfig,
  setAllBuiltInToolPermissions,
} from '../tools/config';
import type { ToolSecurityMeta } from '../config/tool-security-meta';
import {
  getToolSecurityMetaCached,
  isToolSecurityMetaLoaded,
  loadToolSecurityMeta,
  saveToolSecurityMeta,
} from '../config/tool-security-meta';
import { loadBrowserMeta } from '../config/browser-meta';
import { renderBrowserAllowlistSettings } from './settings-browser';
import { renderLspSection } from './lsp-settings';
import { renderEditorSection } from './settings-editor';
import { setStatus } from './status';
import type { SettingsSectionId } from './settings-page-types';
import { appendSettingsCrosslinks, appendSettingsGroup, linkToSettingsSection } from './settings-layout';
import { renderAppearanceSettingsSection } from './settings-appearance';
import { renderPromptsHubPanel } from './settings-prompts-hub';
import {
  createSettingsSwitch,
  createSettingsToggleRow,
} from './settings-switch';
import {
  mountSubAgentTypeEditor,
  mountWorkAgentConfigEditor,
  renderEntityEditorList,
} from './settings-entity-editor';
import { mountReefWidgetLlmSettings } from './reef-widget-settings';
import { renderModelRoutingSection } from './settings-model-routing';
import {
  appendProviderModelFields,
  fillModelSelect,
  fillProviderSelect,
} from './settings-model-binding';
import { renderSearchSettingsSection } from './settings-search-section';
import { renderServersSettingsSection } from './settings-servers-section';
import { renderDeepResearchSettingsSection } from './settings-research-section';
import { renderSamplerSettingsSection } from './settings-sampler';
import { renderThinkingSettingsSection } from './settings-thinking';
import { renderWebhooksSettingsSection } from './settings-webhooks';
import { renderOAuthSettingsSection } from './settings-oauth';
import {
  loadTerminalMeta,
  saveTerminalMeta,
} from '../config/terminal-meta';
import {
  clampGenerationIdleTimeoutMs,
  clampGenerationMaxDurationMs,
  clampMaxToolTurns,
  MAX_CHAT_MAX_TOOL_TURNS,
  generationTimeoutMinutesToMs,
  generationTimeoutMsToMinutes,
  getChatMetaSync,
  loadChatMeta,
  saveChatMeta,
} from '../config/chat-meta';
import {
  getToolCallsMetaSync,
  loadToolCallsMeta,
  saveToolCallsMeta,
} from '../config/tool-calls-meta';

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


/** Terminal panel note (agent runs do not auto-open the dock). */
async function appendTerminalControls(mount: HTMLElement): Promise<void> {
  void (await loadTerminalMeta());
  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Agent and sub-agent shell commands run in the background. Open the terminal panel yourself; the Terminal button pulses while a command is running.',
    ),
  );
}

/** Constrained decoding default (persisted in config.json `toolCalls`). */
async function appendToolCallDefaults(mount: HTMLElement): Promise<void> {
  await loadToolCallsMeta();

  const { row: constrainedRow, input: constrainedCb } = createSettingsToggleRow(
    'Constrained tool calls (global default)',
    {
      checked: getToolCallsMetaSync().useConstrainedDecoding,
      ariaLabel: 'Constrained tool calls global default',
      searchKey: 'general.toolCalls.constrained',
    },
  );
  mount.appendChild(constrainedRow);
  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'When your provider supports structured output, Minnow validates tool arguments with JSON Schema. If local models return malformed tool calls, enable structured-output probing under Providers.',
    ),
  );
  const probeLink = linkToSettingsSection('Open Providers →', 'providers');
  const probeWrap = el('p', 'settings-field-hint');
  probeWrap.append('Configure probes under ', probeLink, '.');
  mount.appendChild(probeWrap);

  constrainedCb.addEventListener('change', () => {
    void (async () => {
      try {
        await saveToolCallsMeta({ useConstrainedDecoding: constrainedCb.checked });
        setStatus('ok', 'Constrained tool calls setting updated');
      } catch {
        setStatus('err', 'Could not save constrained tool calls setting');
      }
    })();
  });
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

  const chat = appendSettingsGroup(
    mount,
    'Chat & terminal',
    'How the main thread and background shells behave.',
    'general.chat.terminal',
  );
  await appendTerminalControls(chat);

  const notifications = appendSettingsGroup(
    mount,
    'Notifications',
    'Menubar bell alerts when something finishes or fails in the background.',
    'general.notifications',
  );
  renderNotificationsSettingsSection(notifications);

  const crossAppearance = el('div', 'settings-crosslinks');
  crossAppearance.appendChild(el('span', 'settings-crosslinks__label', 'Related'));
  crossAppearance.append(linkToSettingsSection('Appearance', 'appearance'));
  mount.appendChild(crossAppearance);

  const { providers } = await listProviders();
  const enabled = providers.filter((p) => p.enabled !== false);
  const activeChat = getActiveChat();
  const chatProv =
    enabled.find((p) => p.id === activeChat.providerId?.trim()) ?? null;

  const connection = appendSettingsGroup(
    mount,
    'Connection summary',
    'Registered LLM backends. Pick provider and model in the top bar; edit profiles under Providers.',
  );

  const summary = el('dl', 'settings-kv');
  const addRow = (term: string, value: string) => {
    const dt = el('dt', 'settings-kv__term', term);
    const dd = el('dd', 'settings-kv__value', value);
    summary.appendChild(dt);
    summary.appendChild(dd);
  };

  addRow('Enabled providers', String(enabled.length));
  addRow(
    'This chat’s provider',
    chatProv ? `${chatProv.label} (${chatProv.id})` : '—',
  );
  addRow('Storage', serverUp ? '~/.minnow' : 'Browser (localStorage)');
  connection.appendChild(summary);

  const cross = el('div', 'settings-crosslinks');
  cross.appendChild(el('span', 'settings-crosslinks__label', 'Related'));
  cross.append(
    linkToSettingsSection('Providers', 'providers'),
    linkToSettingsSection('Models', 'model-routing'),
    linkToSettingsSection('Tools', 'tools'),
  );
  connection.appendChild(cross);

  const drawerHint = appendSettingsGroup(
    mount,
    'Quick drawer',
    'Temperature and max tokens are still in the chat gear drawer for now.',
  );
  drawerHint.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Open the gear icon in the top bar while chatting to adjust sampling without leaving the thread.',
    ),
  );
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
  void (async () => {
    const profileHint = await customPartBaselineProfileHint();

    for (const partId of PART_ORDER) {
      const settings = config.parts[partId] ?? { ...DEFAULT_PART_SETTINGS };
      const block = el('details', 'settings-part-block');
      block.open = partId === 'base';

      const summary = el('summary', '');
      const { root: enableSwitch, input: enable } = createSettingsSwitch({
        checked: settings.enabled !== false,
        ariaLabel: `Enable ${PART_LABELS[partId]} part`,
      });
      enable.addEventListener('click', (e) => e.stopPropagation());
      enable.addEventListener('change', () => {
        if (!activeCustomConfig) return;
        activeCustomConfig.parts[partId] = {
          ...(activeCustomConfig.parts[partId] ?? DEFAULT_PART_SETTINGS),
          enabled: enable.checked,
        };
        schedulePromptTokenEstimateRefresh();
      });
      summary.appendChild(enableSwitch);
      summary.appendChild(document.createTextNode(` ${PART_LABELS[partId]}`));
      block.appendChild(summary);

      const ta = document.createElement('textarea');
      ta.className = 'settings-part-editor';
      ta.rows = 6;
      ta.value = settings.contentOverride ?? '';
      ta.placeholder = 'Leave empty to use shipped default at send time';

      let lastSavedOverride: string | null = settings.contentOverride;
      let builtinBaseline = '';

      const applyPartToConfig = () => {
        if (!activeCustomConfig) return;
        const trimmed = ta.value.trim();
        activeCustomConfig.parts[partId] = {
          enabled: enable.checked,
          contentOverride: trimmed ? ta.value : null,
        };
        schedulePromptTokenEstimateRefresh();
      };

      ta.addEventListener('input', () => {
        applyPartToConfig();
        if (diffControls) diffControls.refresh();
      });

      block.appendChild(ta);

      let diffControls: ReturnType<typeof mountPromptDiffControls> | null = null;

      if (isPromptPartDiffSupported(partId)) {
        const baseline = await resolveBuiltinPromptBaselineForPart(partId);
        builtinBaseline = baseline;
        diffControls = mountPromptDiffControls(block, {
          getBaseline: () => builtinBaseline,
          getCurrent: () => {
            const trimmed = ta.value.trim();
            return trimmed ? ta.value : builtinBaseline;
          },
          showOfflineHint: true,
          profileHint,
          resetPartLabel: 'Reset part to default',
          onResetPart: async () => {
            const hasUnsaved =
              (ta.value.trim() ? ta.value : null) !== lastSavedOverride;
            if (hasUnsaved && !confirm('Discard unsaved edits and reset this part to shipped default?')) {
              return;
            }
            if (!activeCustomConfig) return;
            activeCustomConfig.parts[partId] = {
              enabled: enable.checked,
              contentOverride: null,
            };
            ta.value = '';
            lastSavedOverride = null;
            const saved = await savePromptConfig(activeCustomConfig);
            if (saved instanceof Error) {
              setStatus('err', saved.message);
              return;
            }
            schedulePromptTokenEstimateRefresh();
            setStatus('ok', `${PART_LABELS[partId]} reset to shipped default`);
          },
        });
        diffControls.setBaseline(builtinBaseline);
      } else {
        const hint = el(
          'p',
          'settings-field-hint',
          'Diff not available — this part is resolved from the active chat at send time.',
        );
        block.appendChild(hint);
      }

      mount.appendChild(block);
    }
  })();
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
      schedulePromptTokenEstimateRefresh();
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
      if (!(saved instanceof Error)) schedulePromptTokenEstimateRefresh();
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
      void syncCustomBarVisibility().then(() => schedulePromptTokenEstimateRefresh());
    });
  });

  await syncCustomBarVisibility();
}

async function renderPromptingSection(): Promise<void> {
  const profilesMount = document.getElementById('settingsSetupProfilesMount');
  if (profilesMount) {
    mountSetupProfilesPanel(profilesMount, setStatus);
  }
  await refreshCustomConfigSelect();
  await bindPromptingToolbar();
  const meta = await loadPromptMetaSettings();
  await renderPromptPartsPanel(meta.activePromptProfile, meta.activePromptConfigId);
  schedulePromptTokenEstimateRefresh();

  const hubMount = document.getElementById('settingsPromptsHubMount');
  if (hubMount) {
    const hubGen = beginAsyncSectionRender('prompting');
    await renderPromptsHubPanel(hubMount);
    if (isAsyncSectionRenderStale('prompting', hubGen)) return;
  }
}

/** Plan granularity control inside Modes → Plan expandable row. */
async function mountPlanGranularityField(container: HTMLElement): Promise<void> {
  const field = el('div', 'settings-field');
  const label = el('label', 'settings-field-label', 'Plan granularity');
  label.htmlFor = 'settingsPlanGranularity';

  const select = document.createElement('select');
  select.id = 'settingsPlanGranularity';
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

  field.appendChild(label);
  field.appendChild(select);
  field.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Controls how finely the Planner breaks work into tasks. The user can override this per session.',
    ),
  );
  container.appendChild(field);

  const meta = await loadPromptMetaSettings();
  select.value = meta.planGranularity ?? 'medium';
  select.onchange = async () => {
    const value = select.value as 'large' | 'medium' | 'small';
    await savePromptMetaSettings({ planGranularity: value });
    schedulePromptTokenEstimateRefresh();
  };
}

async function renderModesSection(): Promise<void> {
  const mount = clearMount('settingsModesBody');
  if (!mount) return;

  appendSettingsCrosslinks(mount, [{ label: 'Edit prompts in Prompts', sectionId: 'prompting' }]);

  const listBody = appendSettingsGroup(
    mount,
    'Mode options',
    'Tool policy and mode-specific settings. System prompts are edited in Prompts.',
  );

  renderEntityEditorList(
    listBody,
    listModes().map((mode) => ({
      id: mode.id,
      label: mode.label,
      hint: `${mode.description} · Tool policy: ${mode.toolPolicy.default}`,
      searchKey: `modes.${mode.id}`,
    })),
    (id, body) => {
      if (id === 'plan') {
        void mountPlanGranularityField(body);
      }
      if (id === 'reef') {
        mountReefWidgetLlmSettings(body);
      }
    },
  );
}

async function renderExpertsSection(): Promise<void> {
  const mount = clearMount('settingsExpertsBody');
  if (!mount) return;

  appendSettingsCrosslinks(mount, [{ label: 'Edit prompts in Prompts', sectionId: 'prompting' }]);

  const labBody = appendSettingsGroup(mount, 'Expert Lab', 'Try personas outside the main composer.');
  const labLink = document.createElement('button');
  labLink.type = 'button';
  labLink.className = 'settings-action-btn';
  labLink.textContent = 'Open Expert Lab';
  labLink.addEventListener('click', () => {
    void import('./experts/experts-hub').then((m) => m.openExpertLabFromTopbar());
  });
  labBody.appendChild(labLink);

  const rosterBody = appendSettingsGroup(
    mount,
    'Roster',
    `${listExperts().length} built-in personas. Prompt overrides live in ~/.minnow/prompts/experts/.`,
  );
  const list = el('ul', 'settings-entity-list');
  for (const expert of listExperts()) {
    const item = el('li', 'settings-entity-list__item settings-entity-list__item--flat');
    item.dataset.settingsSearchKey = `experts.${expert.meta.id}`;
    item.textContent = `${expert.meta.label}${expert.meta.description ? `: ${expert.meta.description}` : ''}`;
    list.appendChild(item);
  }
  rosterBody.appendChild(list);
}

async function renderModelRoutingSettingsSection(): Promise<void> {
  const mount = clearMount('settingsModelRoutingBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('model-routing');
  await renderModelRoutingSection(mount);
  if (isAsyncSectionRenderStale('model-routing', generation)) return;
}

async function renderThinkingSettingsSectionWrapper(): Promise<void> {
  const mount = document.getElementById('settingsThinkingBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('thinking');
  await renderThinkingSettingsSection(mount);
  if (isAsyncSectionRenderStale('thinking', generation)) return;
}

async function renderSamplerSettingsSectionWrapper(): Promise<void> {
  const mount = clearMount('settingsSamplerBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('sampler');
  await renderSamplerSettingsSection(mount);
  if (isAsyncSectionRenderStale('sampler', generation)) return;
}

async function renderSearchSettingsSectionWrapper(): Promise<void> {
  const mount = clearMount('settingsSearchBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('search');
  await renderSearchSettingsSection(mount);
  if (isAsyncSectionRenderStale('search', generation)) return;
}

async function renderDeepResearchSettingsSectionWrapper(): Promise<void> {
  const mount = clearMount('settingsDeepResearchBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('deep-research');
  await renderDeepResearchSettingsSection(mount);
  if (isAsyncSectionRenderStale('deep-research', generation)) return;
}

async function renderServersSettingsSectionWrapper(): Promise<void> {
  const mount = clearMount('settingsServersBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('servers');
  await renderServersSettingsSection(mount);
  if (isAsyncSectionRenderStale('servers', generation)) return;
}

async function renderWorkAgentsSection(): Promise<void> {
  const mount = clearMount('settingsWorkAgentsBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('work-agents');

  if (!isServerStorageMode()) {
    mount.appendChild(
      serverBanner('Work agent editing requires <code>npm start</code>.'),
    );
    return;
  }

  const remote = await fetchWorkAgentsList();
  if (isAsyncSectionRenderStale('work-agents', generation)) return;
  const agents = remote?.agents ?? [];

  appendSettingsCrosslinks(mount, [
    { label: 'Edit prompts in Prompts', sectionId: 'prompting' },
    { label: 'Set model in Models', sectionId: 'model-routing' },
  ]);

  const listBody = appendSettingsGroup(
    mount,
    'Work agents',
    'Enable flags and context budget per agent. Prompts and model bindings live in Prompts and Models.',
  );

  renderEntityEditorList(
    listBody,
    agents.map((agent) => ({
      id: agent.id,
      label: `${agent.label}${agent.disabled ? ' (disabled)' : ''}`,
      hint: agent.defaultForModes?.length
        ? `Default for modes: ${agent.defaultForModes.join(', ')}`
        : agent.description,
      searchKey: `work-agents.${agent.id}`,
    })),
    (id, body) => {
      const agent = agents.find((a) => a.id === id);
      if (!agent) return;
      mountWorkAgentConfigEditor(body, {
        agentId: id,
        initialProviderId: agent.providerId,
        initialModelId: agent.modelId,
        initialDisabled: agent.disabled === true,
        initialMaxInputTokens: agent.maxInputTokens ?? null,
        initialContextPolicy: agent.contextEnforcementPolicy ?? 'slide',
        initialArchive: agent.archive,
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
  const generation = beginAsyncSectionRender('sub-agents');

  const config = await loadSubAgentConfig();
  if (isAsyncSectionRenderStale('sub-agents', generation)) return;

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

  const summary = el('dl', 'settings-kv');
  const addTerm = (term: string): HTMLElement => {
    const dt = el('dt', 'settings-kv__term', term);
    summary.appendChild(dt);
    const dd = el('dd', 'settings-kv__value');
    summary.appendChild(dd);
    return dd;
  };

  const enabledDd = addTerm('Enabled');
  const { root: enabledSwitch, input: enabledCb } = createSettingsSwitch({
    checked: config.enabled !== false,
    ariaLabel: 'Enable sub-agents',
  });
  enabledDd.appendChild(enabledSwitch);

  const maxDd = addTerm('Max concurrent');
  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.className = 'settings-select settings-kv-input';
  maxInput.min = '1';
  maxInput.max = '16';
  maxInput.step = '1';
  maxInput.value = String(config.globalMaxConcurrent);
  maxInput.setAttribute('aria-label', 'Max concurrent sub-agents');
  maxDd.appendChild(maxInput);

  const timeoutDd = addTerm('Default timeout');
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
  timeoutDd.appendChild(timeoutWrap);

  const nudgeDd = addTerm('Check-in nudge');
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
  nudgeDd.appendChild(nudgeWrap);

  const globalBody = appendSettingsGroup(
    mount,
    'Global limits',
    'While a sub-agent runs, remind the parent agent once after this interval (Build, General, and Research only; not Orchestrate). Set 0 to turn off.',
  );
  globalBody.appendChild(summary);

  appendSettingsCrosslinks(mount, [
    { label: 'Edit prompts in Prompts', sectionId: 'prompting' },
    { label: 'Set model in Models', sectionId: 'model-routing' },
  ]);

  const typesBody = appendSettingsGroup(
    mount,
    'Sub-agent types',
    'Concurrency, timeouts, and tool policy per type.',
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
    typesBody,
    Object.entries(config.types).map(([id, type]) => ({
      id,
      label: type.label ?? id.replace(/([A-Z])/g, ' $1').trim(),
      hint: `Max concurrent ${type.maxConcurrent} · model ${type.modelId || '(chat default)'}`,
      searchKey: `sub-agents.${id}`,
    })),
    (id, body) => {
      const type = config.types[id];
      if (!type) return;
      mountSubAgentTypeEditor(
        body,
        id,
        type.label ?? id,
        {
          enabled: type.enabled !== false,
          maxConcurrent: type.maxConcurrent,
          maxInputTokens: type.maxInputTokens ?? null,
          contextEnforcementPolicy: type.contextEnforcementPolicy ?? 'slide',
          summarySchema: type.summarySchema ?? 'minnow.sub-agent.v1',
        },
        (patch) => saveTypePatch(id, patch),
      );
    },
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

}

async function renderAutopilotSection(): Promise<void> {
  const mount = clearMount('settingsAutopilotBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('autopilot');

  const meta = await loadAutopilotMeta();
  if (isAsyncSectionRenderStale('autopilot', generation)) return;

  const defaultsBody = appendSettingsGroup(
    mount,
    'Board defaults',
    'New orchestrate boards inherit these values. Per-board overrides stay on the board header.',
  );

  const modeField = el('div', 'settings-field');
  const modeLabel = el('label', 'settings-field-label', 'Default execution mode');
  modeLabel.htmlFor = 'settingsAutopilotExecMode';
  const modeSelect = document.createElement('select');
  modeSelect.id = 'settingsAutopilotExecMode';
  modeSelect.className = 'settings-select';
  for (const opt of [
    { value: 'manual', label: 'Manual' },
    { value: 'sequential', label: 'Sequential' },
    { value: 'auto', label: 'Auto' },
    { value: 'afk', label: 'AFK' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    modeSelect.appendChild(option);
  }
  modeSelect.value = meta.defaultExecutionMode;
  modeField.append(modeLabel, modeSelect);
  defaultsBody.appendChild(modeField);

  const isoField = el('div', 'settings-field');
  const isoLabel = el('label', 'settings-field-label', 'Default isolation mode');
  isoLabel.htmlFor = 'settingsAutopilotIsolation';
  const isoSelect = document.createElement('select');
  isoSelect.id = 'settingsAutopilotIsolation';
  isoSelect.className = 'settings-select';
  for (const opt of [
    { value: 'auto', label: 'Auto (derive from execution mode)' },
    { value: 'off', label: 'Off' },
    { value: 'per-task', label: 'Per-task' },
    { value: 'per-wave', label: 'Per-wave' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    isoSelect.appendChild(option);
  }
  isoSelect.value = meta.isolationMode;
  isoField.append(isoLabel, isoSelect);
  defaultsBody.appendChild(isoField);

  const concField = el('div', 'settings-field');
  const concLabel = el('label', 'settings-field-label', 'Max concurrent tasks');
  concLabel.htmlFor = 'settingsAutopilotConcurrency';
  const concInput = document.createElement('input');
  concInput.type = 'number';
  concInput.id = 'settingsAutopilotConcurrency';
  concInput.className = 'settings-input';
  concInput.min = '1';
  concInput.max = '20';
  concInput.step = '1';
  concInput.value = String(meta.maxConcurrentTasks);
  concField.append(
    concLabel,
    concInput,
    el('p', 'settings-field-hint', 'Applies in Auto and AFK modes (sequential always uses 1).'),
  );
  defaultsBody.appendChild(concField);

  const testsBody = appendSettingsGroup(
    mount,
    'Test retries',
    'Global thresholds for per-task test failures and final integration tests.',
  );

  const taskAttemptsField = el('div', 'settings-field');
  const taskAttemptsLabel = el('label', 'settings-field-label', 'Per-task test attempts');
  taskAttemptsLabel.htmlFor = 'settingsAutopilotTaskAttempts';
  const taskAttemptsInput = document.createElement('input');
  taskAttemptsInput.type = 'number';
  taskAttemptsInput.id = 'settingsAutopilotTaskAttempts';
  taskAttemptsInput.className = 'settings-input';
  taskAttemptsInput.min = '1';
  taskAttemptsInput.max = '10';
  taskAttemptsInput.value = String(meta.maxTestAttempts);
  taskAttemptsField.append(taskAttemptsLabel, taskAttemptsInput);
  testsBody.appendChild(taskAttemptsField);

  const finalAttemptsField = el('div', 'settings-field');
  const finalAttemptsLabel = el('label', 'settings-field-label', 'Final test attempts');
  finalAttemptsLabel.htmlFor = 'settingsAutopilotFinalAttempts';
  const finalAttemptsInput = document.createElement('input');
  finalAttemptsInput.type = 'number';
  finalAttemptsInput.id = 'settingsAutopilotFinalAttempts';
  finalAttemptsInput.className = 'settings-input';
  finalAttemptsInput.min = '1';
  finalAttemptsInput.max = '10';
  finalAttemptsInput.value = String(meta.maxFinalTestAttempts);
  finalAttemptsField.append(finalAttemptsLabel, finalAttemptsInput);
  testsBody.appendChild(finalAttemptsField);

  const heartbeatBody = appendSettingsGroup(
    mount,
    'Heartbeat & stall',
    'Supervision thresholds for orchestrate task chats (build, test, fix, final).',
  );

  const appendMsField = (
    container: HTMLElement,
    id: string,
    label: string,
    value: number,
    hint: string,
  ): HTMLInputElement => {
    const field = el('div', 'settings-field');
    const labelEl = el('label', 'settings-field-label', label);
    labelEl.htmlFor = id;
    const wrap = el('span', 'settings-kv-input-wrap');
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'settings-input';
    input.step = '1000';
    input.value = String(value);
    wrap.appendChild(input);
    wrap.appendChild(el('span', 'settings-kv-suffix', 'ms'));
    field.append(labelEl, wrap, el('p', 'settings-field-hint', hint));
    container.appendChild(field);
    return input;
  };

  const heartbeatInput = appendMsField(
    heartbeatBody,
    'settingsAutopilotHeartbeatInterval',
    'Heartbeat interval',
    meta.heartbeatIntervalMs,
    'How often the supervisor checks task chat progress.',
  );
  const stallInput = appendMsField(
    heartbeatBody,
    'settingsAutopilotProgressStall',
    'Progress stall',
    meta.progressStallMs,
    'Mark stalled when no progress for this long.',
  );
  const deadInput = appendMsField(
    heartbeatBody,
    'settingsAutopilotHeartbeatDead',
    'Heartbeat dead',
    meta.heartbeatDeadMs,
    'Treat heartbeat as dead after this silence.',
  );

  const plannerBody = appendSettingsGroup(
    mount,
    'Planner model fallback',
    'Task chats use the planner chat model when set; otherwise the composer model; then this default.',
  );
  const { providerSelect, modelSelect } = appendProviderModelFields(
    plannerBody,
    { provider: 'settingsAutopilotPlannerProvider', model: 'settingsAutopilotPlannerModel' },
    { provider: 'Provider', model: 'Model' },
  );
  await fillProviderSelect(providerSelect, meta.plannerProviderId || '', {
    includeEmptyOption: true,
  });
  await fillModelSelect(
    modelSelect,
    meta.plannerProviderId,
    meta.plannerModelId || '',
  );

  appendSettingsCrosslinks(mount, [
    { label: 'Per-board overrides on the orchestrate board', sectionId: 'modes' },
    { label: 'Configure models in Providers', sectionId: 'providers' },
  ]);

  const persist = async (patch: Parameters<typeof saveAutopilotMeta>[0]): Promise<void> => {
    try {
      await saveAutopilotMeta(patch);
      setStatus('ok', 'Autopilot settings saved');
    } catch {
      setStatus('err', 'Save failed — use npm start');
    }
  };

  modeSelect.addEventListener('change', () => {
    void persist({
      defaultExecutionMode: modeSelect.value as AutopilotExecutionMode,
    });
  });
  isoSelect.addEventListener('change', () => {
    void persist({
      isolationMode: isoSelect.value as AutopilotIsolationMode,
    });
  });
  concInput.addEventListener('change', () => {
    const value = Math.min(20, Math.max(1, Math.floor(Number(concInput.value) || 1)));
    concInput.value = String(value);
    void persist({ maxConcurrentTasks: value });
  });
  taskAttemptsInput.addEventListener('change', () => {
    const value = Math.min(10, Math.max(1, Math.floor(Number(taskAttemptsInput.value) || 1)));
    taskAttemptsInput.value = String(value);
    void persist({ maxTestAttempts: value });
  });
  finalAttemptsInput.addEventListener('change', () => {
    const value = Math.min(10, Math.max(1, Math.floor(Number(finalAttemptsInput.value) || 1)));
    finalAttemptsInput.value = String(value);
    void persist({ maxFinalTestAttempts: value });
  });
  heartbeatInput.addEventListener('change', () => {
    void persist({ heartbeatIntervalMs: Number(heartbeatInput.value) });
  });
  stallInput.addEventListener('change', () => {
    void persist({ progressStallMs: Number(stallInput.value) });
  });
  deadInput.addEventListener('change', () => {
    void persist({ heartbeatDeadMs: Number(deadInput.value) });
  });
  providerSelect.addEventListener('change', async () => {
    await fillModelSelect(modelSelect, providerSelect.value, modelSelect.value);
    void persist({
      plannerProviderId: providerSelect.value,
      plannerModelId: modelSelect.value,
    });
  });
  modelSelect.addEventListener('change', () => {
    void persist({
      plannerProviderId: providerSelect.value,
      plannerModelId: modelSelect.value,
    });
  });
}

/** Main and sub-agent tool-loop caps (Settings → Tools). */
async function appendToolTurnLimitsSection(mount: HTMLElement): Promise<void> {
  await Promise.all([loadChatMeta(), loadSubAgentConfig()]);
  const subConfig = await loadSubAgentConfig();

  const section = appendSettingsGroup(
    mount,
    'Tool turn limits',
    'Cap how many times the agent can call tools in one run (main composer and all sub-agents, including eval runs).',
  );

  const mainRow = el('label', 'settings-toggle-row');
  mainRow.appendChild(el('span', '', 'Main agents'));
  const mainInput = document.createElement('input');
  mainInput.type = 'number';
  mainInput.className = 'settings-select';
  mainInput.min = '1';
  mainInput.max = String(MAX_CHAT_MAX_TOOL_TURNS);
  mainInput.step = '1';
  mainInput.value = String(getChatMetaSync().maxToolTurns);
  mainInput.setAttribute('aria-label', 'Main agent maximum tool turns per send');
  mainRow.appendChild(mainInput);
  section.appendChild(mainRow);

  const subRow = el('label', 'settings-toggle-row');
  subRow.appendChild(el('span', '', 'Sub-agents'));
  const subInput = document.createElement('input');
  subInput.type = 'number';
  subInput.className = 'settings-select';
  subInput.min = '1';
  subInput.max = String(MAX_CHAT_MAX_TOOL_TURNS);
  subInput.step = '1';
  subInput.value = String(getSubAgentsMaxToolTurns(subConfig));
  subInput.setAttribute('aria-label', 'Sub-agent maximum tool turns per run');
  subRow.appendChild(subInput);
  section.appendChild(subRow);

  mainInput.addEventListener('change', () => {
    void (async () => {
      const value = clampMaxToolTurns(Number(mainInput.value));
      mainInput.value = String(value);
      try {
        await saveChatMeta({ maxToolTurns: value });
        setStatus('ok', 'Main agent tool turn limit updated');
      } catch {
        setStatus('err', 'Could not save main agent tool turn limit');
      }
    })();
  });

  subInput.addEventListener('change', () => {
    void (async () => {
      const value = clampSubAgentMaxToolTurns(Number(subInput.value));
      subInput.value = String(value);
      const fresh = await loadSubAgentConfig();
      const ok = await saveSubAgentConfigToServer({ ...fresh, maxToolTurns: value });
      setStatus(ok ? 'ok' : 'err', ok ? 'Sub-agent tool turn limit updated' : 'Save failed — use npm start');
    })();
  });

  const timeoutSection = appendSettingsGroup(
    mount,
    'Generation timeouts',
    'Server-side limits while streaming from the model. Idle timeout resets when new tokens arrive. Applies to the next generation; no restart needed.',
  );

  const idleRow = el('label', 'settings-toggle-row');
  idleRow.appendChild(el('span', '', 'Idle timeout (minutes)'));
  const idleInput = document.createElement('input');
  idleInput.type = 'number';
  idleInput.className = 'settings-select';
  idleInput.min = '1';
  idleInput.max = '30';
  idleInput.step = '1';
  idleInput.value = String(
    generationTimeoutMsToMinutes(getChatMetaSync().generationIdleTimeoutMs),
  );
  idleInput.setAttribute(
    'aria-label',
    'Minutes without model stream data before aborting',
  );
  idleRow.appendChild(idleInput);
  timeoutSection.appendChild(idleRow);

  const maxRow = el('label', 'settings-toggle-row');
  maxRow.appendChild(el('span', '', 'Max duration (minutes)'));
  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.className = 'settings-select';
  maxInput.min = '1';
  maxInput.max = '240';
  maxInput.step = '1';
  maxInput.value = String(
    generationTimeoutMsToMinutes(getChatMetaSync().generationMaxDurationMs),
  );
  maxInput.setAttribute('aria-label', 'Maximum wall-clock minutes per generation');
  maxRow.appendChild(maxInput);
  timeoutSection.appendChild(maxRow);

  idleInput.addEventListener('change', () => {
    void (async () => {
      const minutes = Math.min(30, Math.max(1, Math.floor(Number(idleInput.value) || 1)));
      idleInput.value = String(minutes);
      const ms = clampGenerationIdleTimeoutMs(generationTimeoutMinutesToMs(minutes));
      try {
        await saveChatMeta({ generationIdleTimeoutMs: ms });
        setStatus('ok', 'Generation idle timeout updated');
      } catch {
        setStatus('err', 'Could not save generation idle timeout');
      }
    })();
  });

  maxInput.addEventListener('change', () => {
    void (async () => {
      const minutes = Math.min(240, Math.max(1, Math.floor(Number(maxInput.value) || 1)));
      maxInput.value = String(minutes);
      const ms = clampGenerationMaxDurationMs(generationTimeoutMinutesToMs(minutes));
      try {
        await saveChatMeta({ generationMaxDurationMs: ms });
        setStatus('ok', 'Generation max duration updated');
      } catch {
        setStatus('err', 'Could not save generation max duration');
      }
    })();
  });

  mount.appendChild(section);
}

let toolsSectionInitialized = false;

/** Bumped on each render so stale async work cannot hydrate a replaced DOM. */
let toolsSectionRenderGeneration = 0;

const asyncSectionRenderGeneration: Partial<Record<SettingsSectionId, number>> =
  {};

function beginAsyncSectionRender(section: SettingsSectionId): number {
  const next = (asyncSectionRenderGeneration[section] ?? 0) + 1;
  asyncSectionRenderGeneration[section] = next;
  return next;
}

function isAsyncSectionRenderStale(
  section: SettingsSectionId,
  generation: number,
): boolean {
  return asyncSectionRenderGeneration[section] !== generation;
}

async function renderToolsSection(): Promise<void> {
  const mount = clearMount('settingsToolsBody');
  if (!mount) return;

  const generation = ++toolsSectionRenderGeneration;

  const toolDefaults = appendSettingsGroup(
    mount,
    'Structured tool arguments',
    'Optional JSON Schema on tool turns when the active provider supports it.',
  );
  await appendToolCallDefaults(toolDefaults);
  if (generation !== toolsSectionRenderGeneration) return;

  await appendToolTurnLimitsSection(mount);
  if (generation !== toolsSectionRenderGeneration) return;

  let toolSecurity: ToolSecurityMeta;
  if (isToolConfigReadyForSettingsUi() && isToolSecurityMetaLoaded()) {
    toolSecurity = getToolSecurityMetaCached();
  } else {
    const loaded = await Promise.all([
      loadToolSecurityMeta().catch(
        (): ToolSecurityMeta => ({ filesystemAccess: 'workspace' }),
      ),
      loadToolConfigForSettingsUi(),
      loadBrowserMeta().catch(() => undefined),
    ]);
    toolSecurity = loaded[0];
    if (generation !== toolsSectionRenderGeneration) return;
  }

  const banner = document.createElement('p');
  banner.id = 'settingsToolsServerBanner';
  banner.className = 'settings-server-banner hidden';
  banner.setAttribute('role', 'status');
  banner.textContent = 'Server tools need npm start (not npm run dev).';
  mount.appendChild(banner);

  const previewBanner = document.createElement('p');
  previewBanner.id = 'settingsToolsPreviewBanner';
  previewBanner.className = 'settings-server-banner hidden';
  previewBanner.setAttribute('role', 'status');
  previewBanner.textContent =
    'Browser tools only work in the Minnow desktop app window (from npm start), not in a separate browser tab.';
  mount.appendChild(previewBanner);

  const permissions = appendSettingsGroup(
    mount,
    'Permissions & cache',
    'Each tool can be off, ask before run, or full permission. File and git tools need npm start.',
  );

  const cacheRow = document.createElement('div');
  cacheRow.className = 'settings-tool-cache-row field';
  const { row: cacheToggle, input: cacheCheckbox } = createSettingsToggleRow(
    'Cache repeated read-only tool results in this session',
    { id: 'settingsToolCacheEnabled' },
  );
  cacheRow.appendChild(cacheToggle);
  cacheRow.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Speeds up duplicate read_file and similar calls until the workspace changes or a write invalidates the path. Cleared on workspace switch.',
    ),
  );
  permissions.appendChild(cacheRow);

  const bulkActions = document.createElement('div');
  bulkActions.className = 'settings-tools-bulk-actions';
  const allFullBtn = document.createElement('button');
  allFullBtn.type = 'button';
  allFullBtn.id = 'settingsToolsAllFull';
  allFullBtn.className = 'settings-inline-btn settings-tools-bulk-all-full';
  allFullBtn.textContent = 'All full permissions';
  const resetDefaultsBtn = document.createElement('button');
  resetDefaultsBtn.type = 'button';
  resetDefaultsBtn.id = 'settingsToolsResetDefaults';
  resetDefaultsBtn.className = 'settings-inline-btn settings-tools-bulk-reset';
  resetDefaultsBtn.textContent = 'Reset to defaults';
  bulkActions.append(allFullBtn, resetDefaultsBtn);
  permissions.appendChild(bulkActions);

  const fsGroup = appendSettingsGroup(
    mount,
    'Filesystem access',
    'When restricted, file tools cannot resolve paths outside the workspace. Full access is dangerous on untrusted models.',
  );
  const fsSection = document.createElement('div');
  fsSection.className = 'settings-tool-filesystem';
  const fsRadios = document.createElement('div');
  fsRadios.className = 'settings-filesystem-radios';
  const rWorkspace = document.createElement('input');
  rWorkspace.type = 'radio';
  rWorkspace.name = 'minnow-fs-access-settings';
  rWorkspace.value = 'workspace';
  rWorkspace.id = 'fsAccessWorkspaceSettings';
  const lWorkspace = document.createElement('label');
  lWorkspace.className = 'settings-radio-option';
  const spanWorkspace = document.createElement('span');
  spanWorkspace.className = 'settings-radio-option__text';
  spanWorkspace.textContent = 'Restrict to workspace (default)';
  lWorkspace.append(rWorkspace, spanWorkspace);
  const rFull = document.createElement('input');
  rFull.type = 'radio';
  rFull.name = 'minnow-fs-access-settings';
  rFull.value = 'full';
  rFull.id = 'fsAccessFullSettings';
  const lFull = document.createElement('label');
  lFull.className = 'settings-radio-option';
  const spanFull = document.createElement('span');
  spanFull.className = 'settings-radio-option__text';
  spanFull.textContent = 'Full filesystem access (dangerous)';
  lFull.append(rFull, spanFull);
  fsRadios.append(lWorkspace, lFull);
  fsSection.appendChild(fsRadios);
  fsGroup.appendChild(fsSection);

  const browserGroup = appendSettingsGroup(
    mount,
    'Browser automation',
    'Allowlisted origins for built-in preview browser tools when automation is enabled.',
  );
  const browserMount = el('div', 'settings-tool-browser-mount');
  browserGroup.appendChild(browserMount);
  await renderBrowserAllowlistSettings(browserMount);

  const applyFsRadios = (meta: ToolSecurityMeta = getToolSecurityMetaCached()): void => {
    const mode = meta.filesystemAccess;
    rWorkspace.checked = mode === 'workspace';
    rFull.checked = mode === 'full';
  };
  applyFsRadios(toolSecurity);

  const persistFs = async (): Promise<void> => {
    const next = rFull.checked ? 'full' : 'workspace';
    if (next === 'full') {
      const ok = window.confirm(
        'Enable full filesystem access?\n\nFile and git tools will be able to resolve paths outside your current workspace. A malicious or mistaken model could read or modify sensitive files anywhere on this computer.\n\nOnly continue if you understand and accept this risk.',
      );
      if (!ok) {
        applyFsRadios();
        return;
      }
    }
    try {
      await saveToolSecurityMeta({ filesystemAccess: next });
      setStatus('ok', 'Filesystem access setting saved');
    } catch {
      setStatus('err', 'Could not save — use npm start');
      applyFsRadios();
    }
  };

  rWorkspace.addEventListener('change', () => {
    if (rWorkspace.checked) void persistFs();
  });
  rFull.addEventListener('change', () => {
    if (rFull.checked) void persistFs();
  });

  const list = document.createElement('div');
  list.id = 'settingsToolsList';
  list.className = 'tools-list settings-tools-list';

  const catalog = appendSettingsGroup(
    mount,
    'Tool catalog',
    'Toggle and set permission per built-in tool. Web search provider and API keys live under Search.',
  );

  const toolsPanel = el('div', 'settings-tools-panel');
  toolsPanel.appendChild(list);
  catalog.appendChild(toolsPanel);

  fillToolsSection('settingsToolsList');
  const { appendPluginToolsToList } = await import('./settings-plugins');
  await appendPluginToolsToList('settingsToolsList');

  allFullBtn.addEventListener('click', () => {
    const ok = window.confirm(
      'Grant full permission to all tools?\n\nEvery built-in tool will run without the approval prompt. Paths outside the workspace still prompt when filesystem access is workspace-only.\n\nThis does not change “Filesystem access” below (workspace vs full disk). Only use this if you accept that risk.',
    );
    if (!ok) return;
    void (async () => {
      try {
        await setAllBuiltInToolPermissions('full', list);
        setStatus('ok', 'All tools set to full permission');
      } catch {
        setStatus('err', 'Could not save — use npm start');
      }
    })();
  });

  resetDefaultsBtn.addEventListener('click', () => {
    const ok = window.confirm(
      'Reset all tool permissions to defaults?\n\nBuilt-in tools will return to factory on/off and ask settings.',
    );
    if (!ok) return;
    void (async () => {
      try {
        await resetBuiltInToolPermissionsToDefaults(list);
        setStatus('ok', 'Tool permissions reset to defaults');
      } catch {
        setStatus('err', 'Could not save — use npm start');
      }
    })();
  });

  if (!toolsSectionInitialized) {
    toolsSectionInitialized = true;
    registerToolHandlers();
  }

  const persistToolCache = (): void => {
    const config = getToolConfig();
    config.toolCache = { enabled: cacheCheckbox.checked };
    saveToolConfig(config);
  };
  cacheCheckbox.addEventListener('change', persistToolCache);

  if (generation !== toolsSectionRenderGeneration) return;

  const config = getToolConfig();
  cacheCheckbox.checked = config.toolCache?.enabled !== false;
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

  // Top line: enable toggle + display name on the left, built-in badge or remove on the right.
  const head = document.createElement('div');
  head.className = 'settings-mcp-row-head';

  const label = document.createElement('div');
  label.className = 'settings-mcp-toggle';
  const { root: switchRoot, input: checkbox } = createSettingsSwitch({
    checked: server.enabled,
    ariaLabel: `${server.enabled ? 'Disable' : 'Enable'} ${server.label}`,
  });
  checkbox.dataset.mcpToggle = server.id;

  const title = document.createElement('span');
  title.className = 'settings-mcp-name';
  title.textContent = server.label;
  label.append(switchRoot, title);
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

  // Secondary block: description, then a compact status line (dot + label), then optional hints.
  const detail = document.createElement('div');
  detail.className = 'settings-mcp-detail';

  if (server.description) {
    const desc = document.createElement('p');
    desc.className = 'settings-mcp-desc';
    desc.textContent = server.description;
    detail.append(desc);
  }

  const status = document.createElement('span');
  status.className = `settings-mcp-status ${
    server.connected ? 'settings-mcp-status--ok' : 'settings-mcp-status--idle'
  }`;
  status.setAttribute(
    'aria-label',
    server.connected ? 'Server reachable' : 'Server not reachable',
  );
  const statusDot = document.createElement('span');
  statusDot.className = 'settings-mcp-status-dot';
  statusDot.setAttribute('aria-hidden', 'true');
  const statusText = document.createElement('span');
  statusText.className = 'settings-mcp-status-text';
  statusText.textContent = server.connected ? 'Connected' : 'Not connected';
  status.append(statusDot, statusText);
  detail.append(status);

  if (server.id === 'context7') {
    const keyHint = document.createElement('p');
    keyHint.className = 'settings-mcp-hint';
    keyHint.textContent =
      'Optional: set CONTEXT7_API_KEY or context7ApiKey in provider secrets for live docs.';
    detail.append(keyHint);
  }

  row.append(detail);
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

async function renderAgentPacksSection(): Promise<void> {
  const mount = clearMount('settingsAgentPacksBody');
  if (!mount) return;
  const body = appendSettingsGroup(
    mount,
    'Installed packs',
    'Enable bundled agent definitions for this workspace.',
  );
  await renderAgentPacksSettingsSection(body);
}

async function renderSkillsSection(): Promise<void> {
  const mount = clearMount('settingsSkillsBody');
  if (!mount) return;
  const body = appendSettingsGroup(
    mount,
    'Skills catalog',
    'Built-in and custom slash commands. Edit SKILL.md bodies from each row.',
  );
  await renderSkillsSettingsSection(body);
}

async function renderWebhooksSection(): Promise<void> {
  const mount = clearMount('settingsWebhooksBody');
  if (!mount) return;
  await renderWebhooksSettingsSection(mount);
}

async function renderOAuthSection(): Promise<void> {
  const mount = clearMount('settingsOAuthBody');
  if (!mount) return;
  await renderOAuthSettingsSection(mount);
}

async function renderEvalsSection(): Promise<void> {
  const mount = clearMount('settingsEvalsBody');
  if (!mount) return;
  mount.innerHTML =
    '<p class="settings-field-hint">Eval runs and custom task packs moved to the Benchmark app.</p>' +
    '<p><a href="#/app/bench/tests" class="settings-link">Open Benchmark → Tests</a></p>';
}

let memoryListBindingsDone = false;
let memoryAddFormBound = false;

const MEMORY_BODY_MAX_BYTES = 32 * 1024;

function clearMemoryAddForm(): void {
  const form = document.getElementById('settingsMemoryAddForm') as HTMLFormElement | null;
  form?.reset();
  const err = document.getElementById('settingsMemoryAddError');
  err?.classList.add('hidden');
  if (err) err.textContent = '';
}

function bindMemoryAddForm(): void {
  if (memoryAddFormBound) return;
  memoryAddFormBound = true;

  const form = document.getElementById('settingsMemoryAddForm') as HTMLFormElement | null;
  const errEl = document.getElementById('settingsMemoryAddError');
  const resetBtn = document.getElementById('settingsMemoryAddReset');

  resetBtn?.addEventListener('click', () => clearMemoryAddForm());

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const titleInput = document.getElementById('settingsMemoryAddTitle') as HTMLInputElement | null;
      const bodyInput = document.getElementById('settingsMemoryAddBody') as HTMLTextAreaElement | null;
      const tagsInput = document.getElementById('settingsMemoryAddTags') as HTMLInputElement | null;

      const title = titleInput?.value.trim() ?? '';
      const body = bodyInput?.value ?? '';
      const bodyTrimmed = body.trim();

      if (!title || !bodyTrimmed) {
        if (errEl) {
          errEl.textContent = 'Title and body are required.';
          errEl.classList.remove('hidden');
        }
        return;
      }

      const bodyBytes = new TextEncoder().encode(body).length;
      if (bodyBytes > MEMORY_BODY_MAX_BYTES) {
        if (errEl) {
          errEl.textContent = 'Body exceeds 32 KB. Shorten the text and try again.';
          errEl.classList.remove('hidden');
        }
        setStatus('err', 'Memory body too large (max 32 KB)');
        return;
      }

      const tags = parseMemoryTagsInput(tagsInput?.value ?? '');
      const entry = await createMemoryEntry({
        title,
        body,
        tags,
        source: 'user',
      });

      if (!entry) {
        if (errEl) {
          errEl.textContent = 'Save failed — start with npm start and try again.';
          errEl.classList.remove('hidden');
        }
        setStatus('err', 'Save failed — use npm start');
        return;
      }

      if (errEl) errEl.classList.add('hidden');
      clearMemoryAddForm();
      const panel = document.getElementById('settingsMemoryAddPanel') as HTMLDetailsElement | null;
      if (panel) panel.open = false;
      setStatus('ok', `Saved memory “${entry.title}”`);
      await renderMemorySection();
    })();
  });
}

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

async function refreshMemoryEntriesList(): Promise<void> {
  const countEl = document.getElementById('settingsMemoryEntryCount');
  const hintEl = document.getElementById('settingsMemoryServerHint');
  const listEl = document.getElementById('settingsMemoryList');
  const offlineEl = document.getElementById('settingsMemoryOffline');
  const addPanel = document.getElementById('settingsMemoryAddPanel');
  if (!countEl || !hintEl || !listEl) return;

  listEl.replaceChildren();
  bindMemoryListActions(listEl);

  const status = await fetchMemoryStatus();
  const online = !!status;
  offlineEl?.classList.toggle('hidden', online);
  addPanel?.classList.toggle('hidden', !online);

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

async function renderMemorySection(): Promise<void> {
  const countEl = document.getElementById('settingsMemoryEntryCount');
  const hintEl = document.getElementById('settingsMemoryServerHint');
  const listEl = document.getElementById('settingsMemoryList');
  const embeddingsPanel = document.getElementById('settingsMemoryEmbeddingsPanel');
  const synthesisPanel = document.getElementById('settingsMemorySynthesisPanel');
  const proposalsPanel = document.getElementById('settingsMemoryProposalsPanel');
  if (!countEl || !hintEl || !listEl) return;

  if (embeddingsPanel) {
    mountMemoryEmbeddingsPanel(embeddingsPanel, setStatus);
  }
  if (synthesisPanel) {
    mountMemorySynthesisSettingsPanel(synthesisPanel, setStatus);
  }
  if (proposalsPanel) {
    await mountMemoryProposalsPanel(proposalsPanel, setStatus, {
      onMemoryAccepted: refreshMemoryEntriesList,
    });
  }

  bindMemoryAddForm();
  await refreshMemoryEntriesList();
}

let rulesSectionBindingsDone = false;

function bindRulesSection(): void {
  if (rulesSectionBindingsDone) return;
  rulesSectionBindingsDone = true;

  const saveBtn = document.getElementById('settingsRulesSave');
  saveBtn?.addEventListener('click', () => {
    void (async () => {
      const enabledEl = document.getElementById('settingsRulesEnabled') as HTMLInputElement | null;
      const textEl = document.getElementById('settingsRulesText') as HTMLTextAreaElement | null;
      if (!enabledEl || !textEl) return;

      const text = textEl.value;
      const bytes = new TextEncoder().encode(text).length;
      if (bytes > MAX_USER_RULES_BYTES) {
        setStatus('err', `Rules text exceeds ${MAX_USER_RULES_BYTES} bytes`);
        return;
      }

      try {
        await saveUserRules({
          version: 1,
          enabled: enabledEl.checked,
          text,
        });
        const mode = await detectConfigServer();
        setStatus(
          'ok',
          mode === 'server'
            ? 'User rules saved'
            : 'Saved locally — start npm start to persist to disk',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Save failed';
        setStatus('err', message);
      }
    })();
  });
}

async function renderRulesSection(): Promise<void> {
  const enabledEl = document.getElementById('settingsRulesEnabled') as HTMLInputElement | null;
  const textEl = document.getElementById('settingsRulesText') as HTMLTextAreaElement | null;
  const offlineEl = document.getElementById('settingsRulesOffline');
  if (!enabledEl || !textEl) return;

  bindRulesSection();

  const rules = await loadUserRules();
  enabledEl.checked = rules.enabled;
  textEl.value = rules.text;

  const storageMode = await detectConfigServer();
  offlineEl?.classList.toggle('hidden', storageMode === 'server');
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

async function renderAppearanceSection(): Promise<void> {
  const mount = clearMount('settingsAppearanceBody');
  if (!mount) return;
  renderAppearanceSettingsSection(mount);
}

/** Load or refresh one settings section from live APIs. */
export async function refreshSettingsSection(
  section: SettingsSectionId,
): Promise<void> {
  switch (section) {
    case 'general':
      await renderGeneralSection();
      break;
    case 'appearance':
      await renderAppearanceSection();
      break;
    case 'audio':
      await renderAudioSettingsSection(setStatus);
      break;
    case 'providers':
      refreshProvidersBanner();
      await listProviders();
      await renderProvidersSettingsSection();
      break;
    case 'usage':
      await renderUsageSettingsSection();
      break;
    case 'model-routing':
      await renderModelRoutingSettingsSection();
      break;
    case 'sampler':
      await renderSamplerSettingsSectionWrapper();
      break;
    case 'thinking':
      await renderThinkingSettingsSectionWrapper();
      break;
    case 'prompting':
      await renderPromptingSection();
      break;
    case 'rules':
      await renderRulesSection();
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
    case 'agent-packs':
      await renderAgentPacksSection();
      break;
    case 'sub-agents':
      await renderSubAgentsSection();
      break;
    case 'autopilot':
      await renderAutopilotSection();
      break;
    case 'memory':
      await renderMemorySection();
      break;
    case 'features':
      await renderFeaturesSection();
      break;
    case 'search':
      await renderSearchSettingsSectionWrapper();
      break;
    case 'deep-research':
      await renderDeepResearchSettingsSectionWrapper();
      break;
    case 'servers':
      await renderServersSettingsSectionWrapper();
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
    case 'editor':
      await renderEditorSection();
      break;
    case 'skills':
      await renderSkillsSection();
      break;
    case 'webhooks':
      await renderWebhooksSection();
      break;
    case 'oauth':
      await renderOAuthSection();
      break;
    case 'evals':
      await renderEvalsSection();
      break;
    default:
      break;
  }
}
