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
import { renderAgentPacksSettingsSection } from './settings-agent-packs';
import { renderSkillsSettingsSection } from './settings-skills';
import { renderSupervisorSettingsSection } from './settings-supervisor';
import {
  fillToolsSection,
  refreshProvidersBanner,
  registerToolHandlers,
} from './settings';
import { mountToolApprovalRulesSection } from './tool-approval-settings';
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
import { appendSettingsGroup, linkToSettingsSection } from './settings-layout';
import {
  createSettingsSwitch,
  createSettingsToggleRow,
} from './settings-switch';
import { appendThemeControls } from './settings-theme';
import {
  mountPromptFileEditor,
  mountSubAgentTypeEditor,
  mountWorkAgentEditor,
  renderEntityEditorList,
} from './settings-entity-editor';
import { mountReefWidgetLlmSettings } from './reef-widget-settings';
import { renderModelRoutingSection } from './settings-model-routing';
import { renderSamplerSettingsSection } from './settings-sampler';
import { renderThinkingSettingsSection } from './settings-thinking';
import {
  loadTerminalMeta,
  saveTerminalMeta,
} from '../config/terminal-meta';
import {
  clampGenerationIdleTimeoutMs,
  clampGenerationMaxDurationMs,
  clampMaxToolTurns,
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
      'Agent and sub-agent shell commands run in the background. The terminal panel stays closed unless you open it; the Terminal button pulses while a command is running.',
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
    },
  );
  mount.appendChild(constrainedRow);
  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'When enabled and the provider supports structured output, Minnow attaches a JSON Schema so local models emit valid tool arguments. Use Probe structured output (and optionally Probe models) under Settings → Providers.',
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

  const appearance = appendSettingsGroup(
    mount,
    'Appearance',
    'Palette family, light/dark mode, and follow-system behavior.',
  );
  appendThemeControls(appearance);

  const chat = appendSettingsGroup(
    mount,
    'Chat & terminal',
    'How the main thread and background shells behave.',
  );
  await appendTerminalControls(chat);

  const { providers } = await listProviders();
  const enabled = providers.filter((p) => p.enabled !== false);
  const activeChat = getActiveChat();
  const chatProv =
    enabled.find((p) => p.id === activeChat.providerId?.trim()) ?? null;

  const connection = appendSettingsGroup(
    mount,
    'Connection summary',
    'Registered LLM backends. Choose a model and provider in the top bar; edit profiles under Providers.',
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
    linkToSettingsSection('Model routing', 'model-routing'),
    linkToSettingsSection('Tools', 'tools'),
  );
  connection.appendChild(cross);

  const drawerHint = appendSettingsGroup(
    mount,
    'Quick drawer',
    'Temperature and max tokens remain in the gear drawer on the chat screen for now.',
  );
  drawerHint.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Open the drawer from the top bar while chatting to adjust sampling without leaving the thread.',
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
    { value: 'large', label: 'Large — one task per feature or module' },
    { value: 'medium', label: 'Medium — one task per component or function group (default)' },
    { value: 'small', label: 'Small — every function and config key as its own task' },
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

  const serverReady = isServerStorageMode();

  if (!serverReady) {
    mount.appendChild(
      serverBanner('Mode prompt editing requires <code>npm start</code>.'),
    );
  } else {
    mount.appendChild(
      el(
        'p',
        'settings-field-hint',
        'Expand a mode to edit Full and Lite system prompts. Overrides are saved under ~/.minnow/prompts/modes/.',
      ),
    );
  }

  renderEntityEditorList(
    mount,
    listModes().map((mode) => ({
      id: mode.id,
      label: mode.label,
      hint: `${mode.description} · Tool policy: ${mode.toolPolicy.default}`,
    })),
    (id, body) => {
      if (id === 'plan') {
        void mountPlanGranularityField(body);
      }
      if (id === 'reef') {
        mountReefWidgetLlmSettings(body);
      }
      if (id === 'research') {
        // Hint: parallel Research worker runs share the global sub-agent concurrency cap.
        body.appendChild(
          el(
            'p',
            'settings-field-hint',
            'Parallel research workers: Settings → Sub-agents → Research worker → Max concurrent (raising Global max concurrent may be needed to avoid queuing).',
          ),
        );
      }
      if (serverReady) {
        mountPromptFileEditor(body, { family: 'modes', entityId: id });
      }
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

  const labLink = document.createElement('button');
  labLink.type = 'button';
  labLink.className = 'settings-action-btn';
  labLink.textContent = 'Open Expert Lab';
  labLink.addEventListener('click', () => {
    void import('./expert-lab-page').then((m) => m.openExpertLabFromTopbar());
  });
  mount.appendChild(labLink);

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

  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Set provider and model per work agent; edit Full/Lite prompts. Binding is stored in ~/.minnow/work-agents.json. See Settings → Model routing and Sampler for consolidated overrides.',
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
        initialMaxInputTokens: agent.maxInputTokens ?? null,
        initialContextPolicy: agent.contextEnforcementPolicy ?? 'slide',
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

  mount.appendChild(summary);
  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Check-in nudge: while a sub-agent is still running, the parent gets one gentle reminder after this interval (Build/General/Research; not Orchestrate). Set 0 to disable.',
    ),
  );

  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Expand a sub-agent type to edit its system prompt and model binding. See Settings → Model routing and Sampler for consolidated overrides.',
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

/** Main and sub-agent tool-loop caps (Settings → Tools). */
async function appendToolTurnLimitsSection(mount: HTMLElement): Promise<void> {
  await Promise.all([loadChatMeta(), loadSubAgentConfig()]);
  const subConfig = await loadSubAgentConfig();

  const section = appendSettingsGroup(
    mount,
    'Tool turn limits',
    'Maximum assistant → tool → assistant rounds per run. Applies to the main composer and all sub-agents (including eval runs).',
  );

  const mainRow = el('label', 'settings-toggle-row');
  mainRow.appendChild(el('span', '', 'Main agents'));
  const mainInput = document.createElement('input');
  mainInput.type = 'number';
  mainInput.className = 'settings-select';
  mainInput.min = '1';
  mainInput.max = '64';
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
  subInput.max = '64';
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
    'Server-side limits while streaming from the model (main chat and sub-agents). Idle timeout resets when new tokens arrive. Restart is not required — applies to the next generation.',
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

  const providerRow = el('div', 'settings-tool-key-row field');
  const providerLabel = document.createElement('label');
  providerLabel.htmlFor = 'settingsWebSearchProvider';
  providerLabel.textContent = 'Web search provider';
  const providerSelect = document.createElement('select');
  providerSelect.id = 'settingsWebSearchProvider';
  providerSelect.setAttribute('aria-label', 'Web search provider');
  for (const [value, label] of [
    ['duckduckgo', 'DuckDuckGo (local server)'],
    ['brave', 'Brave Search API'],
    ['tavily', 'Tavily API'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    providerSelect.appendChild(option);
  }
  providerRow.appendChild(providerLabel);
  providerRow.appendChild(providerSelect);
  providerRow.appendChild(
    el(
      'p',
      'settings-field-hint settings-tool-key-hint',
      'Preferred provider and API keys control web_search. No silent fallback when the selected provider cannot run.',
    ),
  );

  const braveKeyRow = el('div', 'settings-tool-key-row field');
  const braveKeyLabel = document.createElement('label');
  braveKeyLabel.htmlFor = 'settingsBraveApiKey';
  braveKeyLabel.textContent = 'Brave Search API key';
  const braveKeyInput = document.createElement('input');
  braveKeyInput.type = 'password';
  braveKeyInput.id = 'settingsBraveApiKey';
  braveKeyInput.autocomplete = 'off';
  braveKeyInput.spellcheck = false;
  braveKeyInput.placeholder = 'Required when Brave is selected';
  braveKeyRow.appendChild(braveKeyLabel);
  braveKeyRow.appendChild(braveKeyInput);

  const tavilyKeyRow = el('div', 'settings-tool-key-row field');
  const tavilyKeyLabel = document.createElement('label');
  tavilyKeyLabel.htmlFor = 'settingsTavilyApiKey';
  tavilyKeyLabel.textContent = 'Tavily API key';
  const tavilyKeyInput = document.createElement('input');
  tavilyKeyInput.type = 'password';
  tavilyKeyInput.id = 'settingsTavilyApiKey';
  tavilyKeyInput.autocomplete = 'off';
  tavilyKeyInput.spellcheck = false;
  tavilyKeyInput.placeholder = 'Required when Tavily is selected';
  tavilyKeyRow.appendChild(tavilyKeyLabel);
  tavilyKeyRow.appendChild(tavilyKeyInput);
  const tavilyHint = document.createElement('p');
  tavilyHint.className = 'settings-field-hint settings-tool-key-hint';
  const tavilyLink = document.createElement('a');
  tavilyLink.href = 'https://docs.tavily.com/welcome';
  tavilyLink.target = '_blank';
  tavilyLink.rel = 'noopener noreferrer';
  tavilyLink.textContent = 'Get a Tavily API key';
  tavilyHint.append('Keys are stored in ~/.minnow/tools.json when npm start is running. ', tavilyLink, '.');
  tavilyKeyRow.appendChild(tavilyHint);

  /** One hairline-framed block for the permission list and web search keys. */
  const catalog = appendSettingsGroup(
    mount,
    'Tool catalog',
    'Toggle and set permission per built-in tool. Plugin tools appear when installed.',
  );

  const toolsPanel = el('div', 'settings-tools-panel');
  toolsPanel.appendChild(list);
  toolsPanel.appendChild(providerRow);
  toolsPanel.appendChild(braveKeyRow);
  toolsPanel.appendChild(tavilyKeyRow);
  catalog.appendChild(toolsPanel);

  mountToolApprovalRulesSection(catalog);

  fillToolsSection('settingsToolsList');
  const { appendPluginToolsToList } = await import('./settings-plugins');
  await appendPluginToolsToList('settingsToolsList');

  allFullBtn.addEventListener('click', () => {
    const ok = window.confirm(
      'Grant full permission to all tools?\n\nEvery built-in tool will run without the approval prompt for all agents (main, work agents, and sub-agents). General mode still shows an approval strip before each tool. Paths outside the workspace still prompt when filesystem access is workspace-only.\n\nThis does not change “Filesystem access” below (workspace vs full disk). Only use this if you accept that risk.',
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
      'Reset all tool permissions to defaults?\n\nBuilt-in tools will return to factory on/off and ask settings. Your web search provider and API keys will be kept.',
    );
    if (!ok) return;
    void (async () => {
      try {
        await resetBuiltInToolPermissionsToDefaults(list);
        braveKeyInput.value = getToolConfig().keys.braveApiKey;
        tavilyKeyInput.value = getToolConfig().keys.tavilyApiKey;
        providerSelect.value = getToolConfig().webSearchProvider;
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

  // Re-bind every time this section mounts: clearMount removes the previous input node,
  // so listeners must not be one-shot behind toolsSectionInitialized.
  const persistWebSearchSettings = (): void => {
    const config = getToolConfig();
    config.keys.braveApiKey = braveKeyInput.value.trim();
    config.keys.tavilyApiKey = tavilyKeyInput.value.trim();
    const provider = providerSelect.value;
    if (provider === 'brave' || provider === 'tavily' || provider === 'duckduckgo') {
      config.webSearchProvider = provider;
    }
    saveToolConfig(config);
  };
  providerSelect.addEventListener('change', persistWebSearchSettings);
  braveKeyInput.addEventListener('input', persistWebSearchSettings);
  braveKeyInput.addEventListener('change', persistWebSearchSettings);
  tavilyKeyInput.addEventListener('input', persistWebSearchSettings);
  tavilyKeyInput.addEventListener('change', persistWebSearchSettings);

  const persistToolCache = (): void => {
    const config = getToolConfig();
    config.toolCache = { enabled: cacheCheckbox.checked };
    saveToolConfig(config);
  };
  cacheCheckbox.addEventListener('change', persistToolCache);

  if (generation !== toolsSectionRenderGeneration) return;

  const config = getToolConfig();
  cacheCheckbox.checked = config.toolCache?.enabled !== false;
  braveKeyInput.value = config.keys.braveApiKey;
  tavilyKeyInput.value = config.keys.tavilyApiKey;
  providerSelect.value = config.webSearchProvider;
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
  await renderAgentPacksSettingsSection(mount);
}

async function renderSkillsSection(): Promise<void> {
  const mount = clearMount('settingsSkillsBody');
  if (!mount) return;
  await renderSkillsSettingsSection(mount);
}

async function renderEvalsSection(): Promise<void> {
  const mount = clearMount('settingsEvalsBody');
  if (!mount) return;
  const { renderEvalsSettingsSection } = await import('./settings-evals');
  await renderEvalsSettingsSection(mount);
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

async function renderMemorySection(): Promise<void> {
  const countEl = document.getElementById('settingsMemoryEntryCount');
  const hintEl = document.getElementById('settingsMemoryServerHint');
  const listEl = document.getElementById('settingsMemoryList');
  const offlineEl = document.getElementById('settingsMemoryOffline');
  const addPanel = document.getElementById('settingsMemoryAddPanel');
  if (!countEl || !hintEl || !listEl) return;

  listEl.replaceChildren();
  bindMemoryListActions(listEl);
  bindMemoryAddForm();

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
  await renderSupervisorSettingsSection();
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
    case 'editor':
      await renderEditorSection();
      break;
    case 'skills':
      await renderSkillsSection();
      break;
    case 'evals':
      await renderEvalsSection();
      break;
    default:
      break;
  }
}
