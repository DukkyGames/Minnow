import { appAlert, appConfirm, appPrompt } from './app-dialog';
/**
 * Populate full settings page sections from Step 02–18 APIs (no placeholder stubs).
 */

import { fetchWorkAgentsList } from '../agents/work-agent-prompt-api';
import {
  clampDuplicateToolCallThreshold,
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
import { listModes } from '../chat/modes/registry';
import {
  loadPromptMetaSettings,
  savePromptMetaSettings,
} from '../config/prompt-meta';
import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import { loadAutopilotMeta } from '../config/autopilot-meta';
import { listProviders } from '../providers/store';
import { renderProvidersSettingsSection } from './settings-providers';
import { renderUsageSettingsSection } from './settings-usage';
import { renderAudioSettingsSection } from './settings-audio';
import { renderNotificationsSettingsSection } from './settings-notifications';
import { renderNetworkAccessSettings } from './settings-network';
import { renderFilesystemAccessSettings } from './settings-filesystem';
import { renderAppUpdatesSettings } from './settings-updates';
import { renderDesktopShellSettings } from './settings-desktop-shell';
import { renderAgentPacksSettingsSection } from './settings-agent-packs';
import { renderAutopilotSettingsSection } from './settings-autopilot';
import { renderSkillsSettingsSection } from './settings-skills';
import { renderSkillsLibrarySettingsSection } from './settings-skills-library';
import {
  fillToolsSection,
  refreshProvidersBanner,
  registerToolHandlers,
} from './settings';
import {
  createMcpServer,
  deleteMcpServer,
  fetchMcpSecrets,
  fetchMcpServers,
  setMcpServerEnabled,
  updateMcpSecrets,
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
import { renderBrowserSettingsSection } from './settings-browser';
import { renderLspSection } from './lsp-settings';
import { renderEditorSection } from './settings-editor';
import { setStatus } from './status';
import type { SettingsSectionId } from './settings-page-types';
import {
  appendSettingsCrosslinks,
  appendSettingsGroup,
  linkToSettingsSection,
  linkToModelsSection,
} from './settings-layout';
import '../styles/settings-general.css';
import {
  appendSettingsOfflineHint,
  createSettingsActionsRow,
  createSettingsInputRow,
  createSettingsKvList,
  createSettingsSelectRow,
} from './settings-controls';
import { renderAboutSettingsSection } from './settings-about';
import { renderDiagnosticsSettingsSection } from './settings-diagnostics';
import { renderAppearanceSettingsSection } from './settings-appearance';
import { renderAppsSettingsSection } from './settings-apps';
import { renderAgentCenterPanel } from './settings-agent-center';
import { renderRulesSettingsSection } from './settings-rules';
import {
  createSettingsSwitch,
  createSettingsToggleRow,
} from './settings-switch';
import {
  mountSubAgentTypeEditor,
  mountWorkAgentConfigEditor,
  renderEntityEditorList,
} from './settings-entity-editor';
import { mountSuperPlanSettings } from './super-plan-settings';
import { renderModelRoutingSection } from './settings-model-routing';
import { renderSearchSettingsSection } from './settings-search-section';
import { renderServersSettingsSection } from './settings-servers-section';
import { renderDeepResearchSettingsSection } from './settings-research-section';
import { renderSamplerSettingsSection } from './settings-sampler';
import { renderThinkingSettingsSection } from './settings-thinking';
import { renderWebhooksSettingsSection } from './settings-webhooks';
import { renderIssuesSettingsSection } from './settings-issues';
import {
  getTerminalMetaCached,
  loadTerminalMeta,
  saveTerminalMeta,
} from '../config/terminal-meta';
import {
  clampGenerationIdleTimeoutMs,
  clampGenerationMaxDurationMs,
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

/** Terminal panel behavior when agents run shell commands (MIN-242). */
async function appendTerminalControls(mount: HTMLElement): Promise<void> {
  await loadTerminalMeta();
  const meta = getTerminalMetaCached();

  const { row: autoOpenRow, input: autoOpenCb } = createSettingsToggleRow(
    'Open terminal when agent runs a command',
    {
      checked: meta.autoOpenOnAgentRun,
      ariaLabel: 'Open terminal when agent runs a command',
      searchKey: 'general.chat.terminal.autoOpenOnAgentRun',
      description:
        'Raises the console when an agent runs execute_command. Off by default so your shell stays uninterrupted.',
    },
  );
  mount.appendChild(autoOpenRow);

  const { row: autoFollowRow, input: autoFollowCb } = createSettingsToggleRow(
    'Switch to Agent tab when agent runs a command',
    {
      checked: meta.autoFollowAgentTab,
      ariaLabel: 'Switch to Agent tab when agent runs a command',
      searchKey: 'general.chat.terminal.autoFollowAgentTab',
      description:
        'Jump to the Agent tab when the console is already open. Off by default; a pulse still signals activity on the Terminal button or Agent tab.',
    },
  );
  mount.appendChild(autoFollowRow);

  const saveTerminalSetting = async (
    patch: Parameters<typeof saveTerminalMeta>[0],
    okMessage: string,
  ): Promise<void> => {
    try {
      await saveTerminalMeta(patch);
      setStatus('ok', okMessage);
    } catch {
      setStatus('err', 'Could not save terminal setting');
    }
  };

  autoOpenCb.addEventListener('change', () => {
    void saveTerminalSetting(
      { autoOpenOnAgentRun: autoOpenCb.checked },
      'Terminal auto-open setting updated',
    );
  });

  autoFollowCb.addEventListener('change', () => {
    void saveTerminalSetting(
      { autoFollowAgentTab: autoFollowCb.checked },
      'Terminal auto-follow setting updated',
    );
  });
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

async function renderNotificationsSection(): Promise<void> {
  const mount = clearMount('settingsNotificationsBody');
  if (!mount) return;

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Menubar bell alerts when something finishes or fails in the background. Terminal and network options live under ',
    linkToSettingsSection('General', 'general'),
    '.',
  );
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);
  renderNotificationsSettingsSection(content);
}

async function renderAudioSection(): Promise<void> {
  const mount = clearMount('settingsAudioBody');
  if (!mount) return;

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Microphone and speaker for dictation and read-aloud. Speech-to-text and text-to-speech models are under ',
    linkToModelsSection('Models → Voice', 'voice'),
    '.',
  );
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);
  await renderAudioSettingsSection(content, setStatus);
}

function appendGeneralSectionLead(shell: HTMLElement): void {
  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Terminals, LAN access, and where settings are saved. For theme, open ',
    linkToSettingsSection('Appearance', 'appearance'),
    '. For alerts, open ',
    linkToSettingsSection('Notifications', 'notifications'),
    '.',
  );
  shell.appendChild(lead);
}

async function renderGeneralSection(): Promise<void> {
  const generation = beginAsyncSectionRender('general');
  const mount = clearMount('settingsGeneralBody');
  if (!mount) return;

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);
  appendGeneralSectionLead(shell);

  const serverUp = await detectConfigServer();
  if (isAsyncSectionRenderStale('general', generation)) return;
  if (!serverUp) {
    appendSettingsOfflineHint(
      shell,
      'File-backed settings require <code>npm start</code>. Values below use browser storage until then.',
    );
  }

  // App updates leads the section: it is about the installed shell, not chat behavior.
  const updates = appendSettingsGroup(
    shell,
    'App updates',
    'Stay on the latest build. Downloads run in the background; restart when you are ready.',
    'general.updates',
    { emphasis: true },
  );
  updates.id = 'settingsAppUpdates';
  renderAppUpdatesSettings(updates);

  const desktop = appendSettingsGroup(
    shell,
    'Desktop app',
    'System tray behavior and whether Minnow opens when you sign in.',
    'general.desktop',
    { emphasis: true },
  );
  desktop.id = 'settingsDesktopShell';
  await renderDesktopShellSettings(desktop);
  if (isAsyncSectionRenderStale('general', generation)) return;

  const chat = appendSettingsGroup(
    shell,
    'Chat & terminal',
    'How the main thread and background shells behave.',
    'general.chat.terminal',
    { emphasis: true },
  );
  await appendTerminalControls(chat);
  if (isAsyncSectionRenderStale('general', generation)) return;

  const filesystem = appendSettingsGroup(
    shell,
    'Filesystem access',
    'Choose whether file and git tools stay inside your open project or can reach anywhere on this computer.',
    'general.filesystem',
    { emphasis: true },
  );
  filesystem.id = 'settingsFilesystemAccess';
  await renderFilesystemAccessSettings(filesystem);
  if (isAsyncSectionRenderStale('general', generation)) return;

  const network = appendSettingsGroup(
    shell,
    'Network access',
    'Let other devices on your Wi‑Fi open Minnow in a browser while this PC runs npm start.',
    'general.network',
    { emphasis: true },
  );
  network.id = 'settingsNetworkAccess';
  await renderNetworkAccessSettings(network);
  if (isAsyncSectionRenderStale('general', generation)) return;

  const setup = appendSettingsGroup(
    shell,
    'Setup wizard',
    'Re-run the first-launch setup flow (theme, provider, permissions).',
    'general.onboarding',
    { emphasis: true },
  );
  setup.appendChild(
    createSettingsActionsRow(
      [
        {
          label: 'Run setup again',
          variant: 'primary',
          onClick: () => {
            void import('../onboarding').then((m) => m.rerunOnboardingFromSettings());
          },
        },
      ],
      { searchKey: 'general.onboarding' },
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

async function renderAgentCenterBasePrompts(): Promise<void> {
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

async function renderAgentCenterSection(): Promise<void> {
  const generation = beginAsyncSectionRender('agent-center');
  await renderAgentCenterPanel(document.getElementById('settingsAgentCenterBody'));
  if (isAsyncSectionRenderStale('agent-center', generation)) return;

  const basePromptPanel = document.getElementById('settingsBasePromptPanel');
  if (basePromptPanel instanceof HTMLDetailsElement && basePromptPanel.open) {
    await renderAgentCenterBasePrompts();
    if (isAsyncSectionRenderStale('agent-center', generation)) return;
  } else {
    ensureBasePromptPanelLazyLoad();
  }
}

let basePromptLazyLoadBound = false;

/** Load base prompt editors the first time the disclosure opens. */
function ensureBasePromptPanelLazyLoad(): void {
  if (basePromptLazyLoadBound) return;
  const panel = document.getElementById('settingsBasePromptPanel');
  if (!(panel instanceof HTMLDetailsElement)) return;
  basePromptLazyLoadBound = true;
  panel.addEventListener('toggle', () => {
    if (!panel.open) return;
    void renderAgentCenterBasePrompts();
  });
}

/** @deprecated Use renderAgentCenterSection — kept for legacy hash aliases. */
async function renderPromptingSection(): Promise<void> {
  await renderAgentCenterSection();
}

/** Plan granularity control inside Modes → Plan expandable row. */
async function mountPlanGranularityField(container: HTMLElement): Promise<void> {
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

async function renderModesSection(): Promise<void> {
  const mount = clearMount('settingsModesBody');
  if (!mount) return;

  appendSettingsCrosslinks(mount, [{ label: 'Edit prompts in Agents', sectionId: 'agent-center' }]);

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
      if (id === 'super-plan') {
        mountSuperPlanSettings(body);
      }
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
    appendSettingsOfflineHint(
      mount,
      'Work agent editing requires <code>npm start</code>.',
    );
    return;
  }

  const remote = await fetchWorkAgentsList();
  if (isAsyncSectionRenderStale('work-agents', generation)) return;
  const agents = remote?.agents ?? [];

  appendSettingsCrosslinks(mount, [
    { label: 'Edit prompts in Agents', sectionId: 'agent-center' },
    { label: 'Set model in Agents', sectionId: 'agent-center' },
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
        initialContextPolicy: agent.contextEnforcementPolicy ?? 'summarize',
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
        | 'enabled'
        | 'globalMaxConcurrent'
        | 'defaultTimeoutMs'
        | 'checkInNudgeMs'
        | 'duplicateToolCallThreshold'
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

  const duplicateToolInput = document.createElement('input');
  duplicateToolInput.type = 'number';
  duplicateToolInput.className = 'settings-select settings-kv-input';
  duplicateToolInput.min = '0';
  duplicateToolInput.max = '256';
  duplicateToolInput.step = '1';
  duplicateToolInput.value = String(
    config.duplicateToolCallThreshold ??
      clampDuplicateToolCallThreshold(undefined),
  );
  duplicateToolInput.setAttribute(
    'aria-label',
    'Identical tool calls before watchdog flags repetition (0 disables)',
  );

  const summary = createSettingsKvList([
    { term: 'Enabled', value: enabledSwitch },
    { term: 'Max concurrent', value: maxInput },
    { term: 'Default timeout', value: timeoutWrap },
    { term: 'Check-in nudge', value: nudgeWrap },
    { term: 'Duplicate tool limit', value: duplicateToolInput },
  ]);

  const globalBody = appendSettingsGroup(
    mount,
    'Global limits',
    'While a sub-agent runs, remind the parent agent once after the check-in interval (Build, General, and Research only; not Orchestrate). Set 0 to turn off. Duplicate tool limit is how many identical tool calls (same name and arguments) trigger watchdog repetition recovery; set 0 to disable.',
  );
  globalBody.appendChild(summary);

  appendSettingsCrosslinks(mount, [
    { label: 'Edit prompts in Agents', sectionId: 'agent-center' },
    { label: 'Set model in Agents', sectionId: 'agent-center' },
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
          contextEnforcementPolicy: type.contextEnforcementPolicy ?? 'summarize',
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

  duplicateToolInput.addEventListener('change', () => {
    const value = clampDuplicateToolCallThreshold(
      Number(duplicateToolInput.value),
    );
    duplicateToolInput.value = String(value);
    void persistGlobal({ duplicateToolCallThreshold: value });
  });

}

async function renderAutopilotSection(): Promise<void> {
  const mount = clearMount('settingsAutopilotBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('autopilot');
  await loadAutopilotMeta();
  if (isAsyncSectionRenderStale('autopilot', generation)) return;
  await renderAutopilotSettingsSection(mount);
}

/** Generation upstream timeouts (Settings → Agents → Watchdog). */
async function appendGenerationTimeoutsSection(
  mount: HTMLElement,
  options?: { emphasis?: boolean },
): Promise<void> {
  await loadChatMeta();

  const timeoutSection = appendSettingsGroup(
    mount,
    'Generation timeouts',
    'Server-side limits while streaming from the model. Idle timeout resets when new tokens arrive. Applies to the next generation; no restart needed.',
    'agents.watchdog.generation',
    options?.emphasis ? { emphasis: true } : undefined,
  );

  const idleInput = document.createElement('input');
  idleInput.type = 'number';
  idleInput.className = 'settings-input';
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
  timeoutSection.appendChild(
    createSettingsInputRow('Idle timeout (minutes)', { input: idleInput }).row,
  );

  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.className = 'settings-input';
  maxInput.min = '1';
  maxInput.max = '240';
  maxInput.step = '1';
  maxInput.value = String(
    generationTimeoutMsToMinutes(getChatMetaSync().generationMaxDurationMs),
  );
  maxInput.setAttribute('aria-label', 'Maximum wall-clock minutes per generation');
  timeoutSection.appendChild(
    createSettingsInputRow('Max duration (minutes)', { input: maxInput }).row,
  );

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
}

async function renderWatchdogSection(): Promise<void> {
  const mount = clearMount('settingsWatchdogBody');
  if (!mount) return;

  const shell = el('div', 'settings-general settings-general--wide');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.textContent =
    'Server-side limits while models and agents stream. Applies to the next generation; no restart needed.';
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  await appendGenerationTimeoutsSection(content, { emphasis: true });
}

let toolsSectionInitialized = false;

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
  const generation = beginAsyncSectionRender('tools');
  const mount = clearMount('settingsToolsBody');
  if (!mount) return;

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Built-in tool permissions and session cache. Browser automation lives under ',
    linkToSettingsSection('Browser', 'browser'),
    '. Slash commands live under ',
    linkToSettingsSection('Skills', 'skills'),
    '. Web search keys live under ',
    linkToSettingsSection('Search', 'search'),
    '.',
  );
  shell.appendChild(lead);

  appendSettingsOfflineHint(shell, 'Server tools need <code>npm start</code> (not npm run dev).', {
    id: 'settingsToolsServerBanner',
    hidden: true,
  });
  appendSettingsOfflineHint(
    shell,
    'Browser tools only work in the Minnow desktop app window (from npm start), not in a separate browser tab.',
    { id: 'settingsToolsPreviewBanner', hidden: true },
  );

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const structuredGroup = appendSettingsGroup(
    content,
    'Structured tool arguments',
    'Optional JSON Schema on tool turns when the active provider supports it.',
    'integrations.tools',
    { emphasis: true },
  );
  await appendToolCallDefaults(structuredGroup);
  if (isAsyncSectionRenderStale('tools', generation)) return;

  if (!isToolConfigReadyForSettingsUi()) {
    await loadToolConfigForSettingsUi();
    if (isAsyncSectionRenderStale('tools', generation)) return;
  }

  const cacheGroup = appendSettingsGroup(
    content,
    'Session cache',
    'Speed up repeated read-only tool calls for the current workspace session.',
    'integrations.tools.cache',
    { emphasis: true },
  );

  const { row: cacheToggle, input: cacheCheckbox } = createSettingsToggleRow(
    'Cache repeated read-only tool results in this session',
    {
      id: 'settingsToolCacheEnabled',
      searchKey: 'integrations.tools.cache',
    },
  );
  cacheGroup.appendChild(cacheToggle);
  cacheGroup.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Applies to duplicate read_file and similar calls until the workspace changes or a write invalidates the path. Cleared on workspace switch.',
    ),
  );

  const catalog = appendSettingsGroup(
    content,
    'Tool catalog',
    'Each tool can be off, ask before run, or full permission. File and git tools need npm start. Plugin tools appear at the bottom when the server is running.',
    'integrations.tools',
    { emphasis: true },
  );

  const list = document.createElement('div');
  list.id = 'settingsToolsList';
  list.className = 'tools-list settings-tools-list';

  catalog.appendChild(
    createSettingsActionsRow(
      [
        {
          id: 'settingsToolsAllFull',
          label: 'All full permissions',
          variant: 'danger',
          onClick: () => {
            void (async () => {
              const ok = await appConfirm(
                'Grant full permission to all tools?\n\nEvery built-in tool will run without the approval prompt. Paths outside the workspace stay blocked unless you enable full disk access under Settings → General → Filesystem access.\n\nOnly use this if you accept that risk.',
              );
              if (!ok) return;
              try {
                await setAllBuiltInToolPermissions('full', list);
                setStatus('ok', 'All tools set to full permission');
              } catch {
                setStatus('err', 'Could not save — use npm start');
              }
            })();
          },
        },
        {
          id: 'settingsToolsResetDefaults',
          label: 'Reset to defaults',
          onClick: () => {
            void (async () => {
              const ok = await appConfirm(
                'Reset all tool permissions to defaults?\n\nBuilt-in tools will return to factory on/off and ask settings.',
              );
              if (!ok) return;
              try {
                await resetBuiltInToolPermissionsToDefaults(list);
                setStatus('ok', 'Tool permissions reset to defaults');
              } catch {
                setStatus('err', 'Could not save — use npm start');
              }
            })();
          },
        },
      ],
      { searchKey: 'integrations.tools.bulk', className: 'settings-tools-toolbar' },
    ),
  );
  catalog.appendChild(list);

  fillToolsSection('settingsToolsList', { variant: 'settings' });
  const { appendPluginToolsToList } = await import('./settings-plugins');
  await appendPluginToolsToList('settingsToolsList');
  if (isAsyncSectionRenderStale('tools', generation)) return;

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

  const config = getToolConfig();
  cacheCheckbox.checked = config.toolCache?.enabled !== false;
  loadToolConfigIntoDrawer(list);

  document.getElementById('settingsToolsServerBanner')?.classList.toggle(
    'hidden',
    isLocalServerAvailable(),
  );

  appendSettingsCrosslinks(content, [
    { label: 'Browser automation', sectionId: 'browser' },
    { label: 'Skills catalog', sectionId: 'skills' },
    { label: 'Web search', sectionId: 'search' },
  ]);
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

function createMcpSettingsRow(
  server: McpServerSummary,
  options?: { hasContext7ApiKey?: boolean },
): HTMLElement {
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
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.id = 'settingsMcpContext7ApiKey';
    keyInput.className = 'settings-input';
    keyInput.autocomplete = 'off';
    keyInput.placeholder = options?.hasContext7ApiKey
      ? 'Leave blank to keep current key'
      : 'Optional — get one at context7.com';

    const keyHint = document.createElement('p');
    keyHint.className = 'settings-mcp-hint';
    keyHint.textContent = options?.hasContext7ApiKey
      ? 'A key is saved on the server (not shown here). Encrypted at rest under ~/.minnow/mcp/secrets.json.'
      : 'No API key saved yet. Required for live library docs from Context7.';

    detail.appendChild(
      createSettingsInputRow('Context7 API key', {
        input: keyInput,
        description: keyHint.textContent,
      }).row,
    );
    detail.appendChild(
      createSettingsActionsRow([
        {
          label: 'Save key',
          className: 'settings-inline-btn',
          onClick: () => {
            void (async () => {
              const value = keyInput.value.trim();
              if (!value) {
                if (!options?.hasContext7ApiKey) {
                  setStatus('err', 'Enter a Context7 API key');
                  return;
                }
                setStatus('ok', 'Context7 API key unchanged');
                return;
              }
              const result = await updateMcpSecrets({ context7ApiKey: value });
              if (result.ok === false) {
                setStatus('err', result.error);
                return;
              }
              const { flags } = result;
              keyInput.value = '';
              keyInput.placeholder = flags.hasContext7ApiKey
                ? 'Leave blank to keep current key'
                : 'Optional — get one at context7.com';
              keyHint.textContent = flags.hasContext7ApiKey
                ? 'A key is saved on the server (not shown here). Encrypted at rest under ~/.minnow/mcp/secrets.json.'
                : 'No API key saved yet. Required for live library docs from Context7.';
              setStatus('ok', 'Context7 API key saved');
              await renderMcpSection();
            })();
          },
        },
      ]),
    );
  }

  row.append(detail);
  return row;
}

let mcpToggleHandlerBound = false;
let mcpAddFormBound = false;
let mcpSettingsShellReady = false;

/** Build the add-server disclosure form (mounted once inside the MCP settings shell). */
function buildMcpAddPanel(): HTMLDetailsElement {
  const panel = document.createElement('details');
  panel.id = 'settingsMcpAddPanel';
  panel.className = 'settings-mcp-add-panel hidden';

  const summary = document.createElement('summary');
  summary.className = 'settings-mcp-add-summary';
  summary.textContent = 'Add MCP server';
  panel.appendChild(summary);

  const form = document.createElement('form');
  form.id = 'settingsMcpAddForm';
  form.className = 'settings-mcp-form';
  form.noValidate = true;

  const idRow = el('div', 'field-row');
  const idField = el('div', 'field');
  idField.append(
    Object.assign(document.createElement('label'), {
      htmlFor: 'settingsMcpAddId',
      textContent: 'Server id',
    }),
    Object.assign(document.createElement('input'), {
      type: 'text',
      id: 'settingsMcpAddId',
      name: 'id',
      required: true,
      pattern: '[a-z0-9][a-z0-9_-]*',
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'my-docs-mcp',
    }),
    el('p', 'field-hint', 'Lowercase letters, numbers, hyphens, underscores.'),
  );
  const labelField = el('div', 'field');
  labelField.append(
    Object.assign(document.createElement('label'), {
      htmlFor: 'settingsMcpAddLabel',
      textContent: 'Display name',
    }),
    Object.assign(document.createElement('input'), {
      type: 'text',
      id: 'settingsMcpAddLabel',
      name: 'label',
      required: true,
      autocomplete: 'off',
      placeholder: 'My docs MCP',
    }),
  );
  idRow.append(idField, labelField);

  const descField = el('div', 'field');
  descField.append(
    Object.assign(document.createElement('label'), {
      htmlFor: 'settingsMcpAddDescription',
      textContent: 'Description (optional)',
    }),
    Object.assign(document.createElement('input'), {
      type: 'text',
      id: 'settingsMcpAddDescription',
      name: 'description',
      autocomplete: 'off',
      placeholder: 'What this server provides',
    }),
  );

  const cmdRow = el('div', 'field-row');
  const cmdField = el('div', 'field');
  cmdField.append(
    Object.assign(document.createElement('label'), {
      htmlFor: 'settingsMcpAddCommand',
      textContent: 'Command',
    }),
    Object.assign(document.createElement('input'), {
      type: 'text',
      id: 'settingsMcpAddCommand',
      name: 'command',
      required: true,
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'npx',
    }),
  );
  const enabledField = el('div', 'field');
  const enabledLabel = el('label', undefined, 'Enabled on add');
  const enabledToggle = el('label', 'settings-toggle-row');
  const enabledInput = Object.assign(document.createElement('input'), {
    type: 'checkbox',
    id: 'settingsMcpAddEnabled',
    name: 'enabled',
    checked: true,
  });
  enabledToggle.append(enabledInput, el('span', undefined, 'Connect after saving'));
  enabledField.append(enabledLabel, enabledToggle);
  cmdRow.append(cmdField, enabledField);

  const argsField = el('div', 'field');
  argsField.append(
    Object.assign(document.createElement('label'), {
      htmlFor: 'settingsMcpAddArgs',
      textContent: 'Arguments (one per line)',
    }),
    Object.assign(document.createElement('textarea'), {
      id: 'settingsMcpAddArgs',
      name: 'args',
      rows: 4,
      spellcheck: false,
      placeholder: '-y\n@modelcontextprotocol/server-filesystem\n/path/to/allowed/dir',
    }),
  );

  const envField = el('div', 'field');
  envField.append(
    Object.assign(document.createElement('label'), {
      htmlFor: 'settingsMcpAddEnv',
      textContent: 'Environment variables (optional, KEY=value per line)',
    }),
    Object.assign(document.createElement('textarea'), {
      id: 'settingsMcpAddEnv',
      name: 'env',
      rows: 3,
      spellcheck: false,
      placeholder: 'API_KEY=your-key-here',
    }),
  );

  const errEl = el('p', 'settings-mcp-form-error hidden');
  errEl.id = 'settingsMcpAddError';
  errEl.setAttribute('role', 'alert');

  const actions = el('div', 'settings-mcp-form-actions');
  const submitBtn = Object.assign(document.createElement('button'), {
    type: 'submit',
    className: 'settings-action-btn',
    textContent: 'Add server',
  });
  const resetBtn = Object.assign(document.createElement('button'), {
    type: 'button',
    id: 'settingsMcpAddReset',
    className: 'settings-inline-btn',
    textContent: 'Clear form',
  });
  actions.append(submitBtn, resetBtn);

  form.append(idRow, descField, cmdRow, argsField, envField, errEl, actions);
  panel.appendChild(form);
  return panel;
}

/** Mount the MCP settings shell once (emphasis-panel layout like Browser / Servers). */
function ensureMcpSettingsShell(mount: HTMLElement): {
  listEl: HTMLElement;
  offlineEl: HTMLElement;
  addPanel: HTMLDetailsElement;
} {
  if (mcpSettingsShellReady) {
    return {
      listEl: document.getElementById('settingsMcpServerList')!,
      offlineEl: document.getElementById('settingsMcpOffline')!,
      addPanel: document.getElementById('settingsMcpAddPanel') as HTMLDetailsElement,
    };
  }

  mount.replaceChildren();

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'External tool servers connect over stdio and register as ',
    el('code', undefined, 'mcp__server__tool'),
    '. Language-server diagnostics live under ',
    linkToSettingsSection('Language servers', 'lsp'),
    '; AI ghost text lives under ',
    linkToSettingsSection('Editor', 'editor'),
    '.',
  );
  shell.appendChild(lead);

  const offlineEl = appendSettingsOfflineHint(
    shell,
    'Start with <code>npm start</code> to load, toggle, and add MCP servers.',
    { id: 'settingsMcpOffline', searchKey: 'integrations.mcp', hidden: true },
  );
  offlineEl.classList.add('settings-mcp-offline');

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const catalog = appendSettingsGroup(
    content,
    'Configured servers',
    'Built-in servers ship with Minnow. Custom entries persist in ~/.minnow/mcp.json.',
    'integrations.mcp',
    { emphasis: true },
  );

  const listEl = el('div', 'settings-mcp-list');
  listEl.id = 'settingsMcpServerList';
  listEl.setAttribute('role', 'list');
  listEl.setAttribute('aria-label', 'Configured MCP servers');
  catalog.appendChild(listEl);

  const addPanel = buildMcpAddPanel();
  catalog.appendChild(addPanel);

  appendSettingsCrosslinks(content, [
    { label: 'Language servers', sectionId: 'lsp' },
    { label: 'Editor', sectionId: 'editor' },
    { label: 'Tool permissions', sectionId: 'tools' },
  ]);

  mcpSettingsShellReady = true;
  bindMcpAddForm();

  return { listEl, offlineEl, addPanel };
}

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
  const mount = document.getElementById('settingsMcpBody');
  if (!mount) return;

  const { listEl, offlineEl, addPanel } = ensureMcpSettingsShell(mount);

  const online = isLocalServerAvailable();
  offlineEl.classList.toggle('hidden', online);
  addPanel.classList.toggle('hidden', !online);

  if (!online) {
    listEl.replaceChildren();
    return;
  }

  const servers = await fetchMcpServers();
  const secretFlags = online ? await fetchMcpSecrets() : null;
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
    listEl.appendChild(
      createMcpSettingsRow(server, {
        hasContext7ApiKey: secretFlags?.hasContext7ApiKey === true,
      }),
    );
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

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Install drop-in bundles of work agents with prompts and tool allowlists. Pack agents merge with built-ins and appear in ',
    linkToSettingsSection('Agents', 'agent-center'),
    '. Per-agent models live under ',
    linkToSettingsSection('Routing', 'model-routing'),
    '.',
  );
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);
  await renderAgentPacksSettingsSection(content);
}

async function renderSkillsSection(): Promise<void> {
  const mount = clearMount('settingsSkillsBody');
  if (!mount) return;

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Slash commands the agent can load with /skill-name. Tool permissions live under ',
    linkToSettingsSection('Tools', 'tools'),
    '. Browser automation lives under ',
    linkToSettingsSection('Browser', 'browser'),
    '.',
  );
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const catalog = appendSettingsGroup(
    content,
    'Skills catalog',
    'Built-in skills ship with Minnow. Custom skills live under ~/.minnow/skills/ when npm start is running.',
    'integrations.skills',
    { emphasis: true },
  );
  await renderSkillsSettingsSection(catalog);

  appendSettingsCrosslinks(content, [
    { label: 'Skills Library', sectionId: 'skills-library' },
    { label: 'Tool permissions', sectionId: 'tools' },
    { label: 'Browser automation', sectionId: 'browser' },
  ]);
}

async function renderSkillsLibrarySection(): Promise<void> {
  const mount = clearMount('settingsSkillsLibraryBody');
  if (!mount) return;

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Browse curated third-party SKILL.md packs, install skills into ',
    document.createElement('code'),
    ', or add from a GitHub URL. Enable/disable installed skills in ',
    linkToSettingsSection('Skills catalog', 'skills'),
    '.',
  );
  (lead.querySelector('code') as HTMLElement).textContent = '~/.minnow/skills/';
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const library = appendSettingsGroup(
    content,
    'Curated packs',
    'Matt Pocock, Addy Osmani, Superpowers, last30days, and Browserbase ship offline indexes for browse.',
    'integrations.skills-library',
    { emphasis: true },
  );
  await renderSkillsLibrarySettingsSection(library);

  appendSettingsCrosslinks(content, [
    { label: 'Skills catalog', sectionId: 'skills' },
    { label: 'Tool permissions', sectionId: 'tools' },
  ]);
}

async function renderBrowserSection(): Promise<void> {
  const mount = clearMount('settingsBrowserBody');
  if (!mount) return;
  const generation = beginAsyncSectionRender('browser');
  await renderBrowserSettingsSection(mount);
  if (isAsyncSectionRenderStale('browser', generation)) return;
}

async function renderWebhooksSection(): Promise<void> {
  const mount = clearMount('settingsWebhooksBody');
  if (!mount) return;
  await renderWebhooksSettingsSection(mount);
}

async function renderRulesSection(): Promise<void> {
  const mount = clearMount('settingsRulesBody');
  if (!mount) return;

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Standing instructions added to every parent chat send, after the built-in system prompt. Does not apply to sub-agents. Mode and agent prompts live under ',
    linkToSettingsSection('Agents', 'agent-center'),
    '.',
  );
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);
  await renderRulesSettingsSection(content, setStatus);
}

async function renderAppearanceSection(): Promise<void> {
  const mount = clearMount('settingsAppearanceBody');
  if (!mount) return;
  renderAppearanceSettingsSection(mount);
}

async function renderAppsSection(): Promise<void> {
  const mount = clearMount('settingsAppsBody');
  if (!mount) return;
  renderAppsSettingsSection(mount);
}

async function renderIssuesSettingsPanel(): Promise<void> {
  const mount = clearMount('settingsIssuesBody');
  if (!mount) return;
  renderIssuesSettingsSection(mount);
}

/** Load or refresh one settings section from live APIs. */
export async function refreshSettingsSection(
  section: SettingsSectionId,
): Promise<void> {
  switch (section) {
    case 'general':
      await renderGeneralSection();
      break;
    case 'notifications':
      await renderNotificationsSection();
      break;
    case 'apps':
      await renderAppsSection();
      break;
    case 'issues':
      await renderIssuesSettingsPanel();
      break;
    case 'appearance':
      await renderAppearanceSection();
      break;
    case 'audio':
      await renderAudioSection();
      break;
    case 'about':
      await renderAboutSettingsSection();
      break;
    case 'diagnostics':
      await renderDiagnosticsSettingsSection();
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
    case 'agent-center':
      await renderAgentCenterSection();
      break;
    case 'prompting':
    case 'modes':
    case 'work-agents':
    case 'sub-agents':
      await renderAgentCenterSection();
      break;
    case 'rules':
      await renderRulesSection();
      break;
    case 'agent-packs':
      await renderAgentPacksSection();
      break;
    case 'autopilot':
      await renderAutopilotSection();
      break;
    case 'watchdog':
      await renderWatchdogSection();
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
    case 'browser':
      await renderBrowserSection();
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
    case 'skills-library':
      await renderSkillsLibrarySection();
      break;
    case 'webhooks':
      await renderWebhooksSection();
      break;
    default:
      break;
  }
}
