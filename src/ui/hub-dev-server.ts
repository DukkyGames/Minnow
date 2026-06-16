/**
 * Vibe Hub dev-server cell — startup.md lifecycle, agents, polling, console bridge.
 */

import { spawnSubAgent } from '../agents/orchestrator';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import {
  DEFAULT_DEV_SERVER_PORT,
  fetchDevServerStatus,
  fetchWorkspaceStartup,
  postDevServerStart,
  postDevServerStop,
  putDevServerSettings,
  type DevServerNetwork,
  type DevServerSettings,
  type DevServerLifecycleStatus,
} from '../config/startup-api';
import { getWorkspacePath } from '../state/workspace';
import { isLocalServerAvailable } from '../tools/config';
import type { Chat } from '../types';
import {
  deriveHubDevServerView,
  formatHubDevServerMeta,
  formatHubDevServerOpenUrl,
  type HubDevServerViewModel,
} from './hub-dev-server-view';
import {
  ensureDevServerStream,
  openDevServerConsole,
  stopDevServerStream,
} from './terminal-panel';

export { deriveHubDevServerView } from './hub-dev-server-view';
export type {
  HubDevServerUiState,
  HubDevServerViewModel,
} from './hub-dev-server-view';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeAgents: (() => void) | null = null;
let activeChatId: string | null = null;
let managedRunId: string | null = null;
let streamRunId: string | null = null;
let startAgentRunId: string | null = null;
let cachedSettings: DevServerSettings = { port: DEFAULT_DEV_SERVER_PORT, network: 'local' };
let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastLifecycleStatus: DevServerLifecycleStatus = 'stopped';
let lastLifecycleError: string | null = null;
let lastHealthUrl: string | null = null;

const SETUP_TASK = `Create or update startup.md at the workspace root.

Inspect package.json, README, and common scripts to determine how to start the local dev server.
Write startup.md with YAML frontmatter:
- command (required): one shell line to start the dev server
- cwd (optional): relative directory only (e.g. . or apps/web), default .
- healthUrl (optional): HTTP URL to probe when running (e.g. http://localhost:3000/)
- port (optional): display hint
- stop.command (optional): shell command to stop when not using PID kill

Keep the markdown body as human notes for future agents.
Do not start a long-running server with execute_command (30s timeout). Use start_background_command only for a quick smoke test if needed.`;

function buildStartTask(startupPath: string): string {
  return `Read the workspace startup guide at:
${startupPath}

Start the dev server with one start_background_command call (fallback when managed start failed):
- Use the command from startup.md frontmatter.
- Set cwd to the guide cwd if present, otherwise "." (relative to workspace root only — never an absolute path).
- Do not use execute_command for cd or exploration; execute_command always runs at workspace root.
- Do not prefix the command with cd.
If healthUrl is set, the hub polls health automatically. Report the URL/port in your structured summary.`;
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(refresh: () => void): void {
  stopPolling();
  pollTimer = setInterval(() => {
    void refresh();
  }, 2000);
}

function applySettingsToDom(view: HubDevServerViewModel): void {
  const portInput = document.getElementById('hubDevServerPort') as HTMLInputElement | null;
  const settingsRow = document.getElementById('hubDevServerSettings');
  const localBtn = document.getElementById('hubDevServerNetworkLocal');
  const lanBtn = document.getElementById('hubDevServerNetworkLan');

  if (portInput) {
    if (document.activeElement !== portInput) {
      portInput.value = String(view.port);
    }
    portInput.disabled = view.settingsDisabled;
  }
  if (settingsRow) {
    settingsRow.classList.toggle('hub-dev-server-settings--disabled', view.settingsDisabled);
  }
  localBtn?.classList.toggle('is-active', view.network === 'local');
  lanBtn?.classList.toggle('is-active', view.network === 'lan');
  localBtn?.toggleAttribute('disabled', view.settingsDisabled);
  lanBtn?.toggleAttribute('disabled', view.settingsDisabled);
}

const HUB_DEV_SERVER_URL_ATTR = 'data-hub-dev-url';

function applyOpenUrlToDom(openUrl: string | null): void {
  const urlEl = document.getElementById('hubDevServerUrl') as HTMLButtonElement | null;
  if (!urlEl) return;
  if (!openUrl) {
    urlEl.classList.add('hidden');
    urlEl.removeAttribute(HUB_DEV_SERVER_URL_ATTR);
    urlEl.textContent = '';
    urlEl.removeAttribute('aria-label');
    return;
  }
  urlEl.classList.remove('hidden');
  urlEl.setAttribute(HUB_DEV_SERVER_URL_ATTR, openUrl);
  urlEl.textContent = openUrl;
  urlEl.setAttribute('aria-label', `Open dev server in preview: ${openUrl}`);
}

async function openHubDevServerInPreview(url: string): Promise<void> {
  const { openUrlInPreviewPanel } = await import('./preview-panel');
  await openUrlInPreviewPanel(url);
}

function applyViewToDom(view: HubDevServerViewModel): void {
  const cell = document.getElementById('hubDevServerCell');
  const labelEl = document.getElementById('hubDevServerLabel');
  const metaEl = document.getElementById('hubDevServerMeta');
  const dot = document.getElementById('hubDevServerDot');
  const consoleBtn = document.getElementById('hubDevServerConsole');

  if (!cell || !labelEl || !metaEl || !dot) return;

  labelEl.textContent = view.label;
  metaEl.textContent = view.meta;
  applyOpenUrlToDom(view.openUrl);
  applySettingsToDom(view);

  cell.classList.remove(
    'hub-strip__cell--stopped',
    'hub-strip__cell--starting',
    'hub-strip__cell--running',
    'hub-strip__cell--error',
    'hub-strip__cell--offline',
    'hub-strip__cell--setup',
  );

  const dotClass =
    view.uiState === 'running'
      ? 'ok pulse'
      : view.uiState === 'starting' || view.uiState === 'stopping'
        ? 'warn pulse'
        : view.uiState === 'error'
          ? 'err'
          : 'idle';

  dot.className = `hub-strip__dot ${dotClass}`;
  cell.classList.add(`hub-strip__cell--${view.uiState}`);
  cell.setAttribute('aria-disabled', view.primaryDisabled ? 'true' : 'false');
  cell.classList.toggle('hub-strip__cell--disabled', view.primaryDisabled);

  if (consoleBtn) {
    consoleBtn.classList.toggle('hidden', !view.showConsole);
    consoleBtn.toggleAttribute('disabled', view.uiState === 'offline');
  }
}

/** Keep the status line in sync while the port field is being edited. */
function refreshMetaFromCache(): void {
  const metaEl = document.getElementById('hubDevServerMeta');
  if (!metaEl) return;
  metaEl.textContent = formatHubDevServerMeta(
    lastLifecycleStatus,
    lastLifecycleError,
    cachedSettings.port,
    cachedSettings.network,
  );
  const openUrl =
    lastLifecycleStatus === 'starting' || lastLifecycleStatus === 'running'
      ? formatHubDevServerOpenUrl(
          lastHealthUrl,
          cachedSettings.port,
          cachedSettings.network,
        )
      : null;
  applyOpenUrlToDom(openUrl);
}

function resolveSettingsFromStatus(
  status: Awaited<ReturnType<typeof fetchDevServerStatus>>,
): DevServerSettings {
  syncPortFromInput();
  const fromServer: DevServerSettings = status.settings
    ? status.settings
    : {
        port: status.port ?? cachedSettings.port,
        network: (status.network ?? cachedSettings.network) as DevServerNetwork,
      };
  if (fromServer.port !== cachedSettings.port) {
    return { ...fromServer, port: cachedSettings.port };
  }
  cachedSettings = fromServer;
  return fromServer;
}

function syncDevServerStream(
  status: DevServerLifecycleStatus,
  runId: string | null,
  command: string | null,
): void {
  if (!isLocalServerAvailable() || !activeChatId) return;

  const active = status === 'starting' || status === 'running';
  if (!active || !runId) {
    if (streamRunId) {
      streamRunId = null;
      stopDevServerStream();
    }
    return;
  }

  streamRunId = runId;
  ensureDevServerStream(runId, command ?? 'dev server', activeChatId);
}

function scheduleSettingsSave(patch: Partial<DevServerSettings>): void {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => {
    settingsSaveTimer = null;
    void flushDevServerSettings(patch);
  }, 350);
}

/** Read port from the hub input into cachedSettings (invalid values are ignored). */
function syncPortFromInput(): void {
  const portInput = document.getElementById('hubDevServerPort') as HTMLInputElement | null;
  if (!portInput) return;
  const raw = Number(portInput.value);
  if (!Number.isFinite(raw) || raw < 1 || raw > 65535) return;
  cachedSettings = { ...cachedSettings, port: Math.floor(raw) };
}

/** Persist port/network immediately (e.g. before start or on blur). */
async function flushDevServerSettings(
  patch: Partial<DevServerSettings> = {},
): Promise<void> {
  if (settingsSaveTimer) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = null;
  }
  if (!isLocalServerAvailable()) return;

  syncPortFromInput();
  const body: DevServerSettings = {
    port: patch.port ?? cachedSettings.port,
    network: patch.network ?? cachedSettings.network,
  };
  cachedSettings = body;

  try {
    cachedSettings = await putDevServerSettings(body);
  } catch {
    /* keep in-memory values; status poll may reconcile */
  }
}

async function refreshDevServerCell(): Promise<void> {
  const online = isLocalServerAvailable();
  if (!online) {
    applyViewToDom(
      deriveHubDevServerView(
        false,
        'stopped',
        null,
        null,
        cachedSettings.port,
        cachedSettings.network,
      ),
    );
    stopPolling();
    syncDevServerStream('stopped', null, null);
    return;
  }

  try {
    const status = await fetchDevServerStatus();
    managedRunId = status.runId;
    lastLifecycleStatus = status.status;
    lastLifecycleError = status.error;
    lastHealthUrl = status.healthUrl;
    const settings = resolveSettingsFromStatus(status);
    const view = deriveHubDevServerView(
      true,
      status.status,
      status.error,
      status.runId,
      settings.port,
      settings.network,
      status.healthUrl,
    );
    applyViewToDom(view);
    syncDevServerStream(status.status, status.runId, status.command);

    if (status.status === 'starting' || status.status === 'running') {
      startPolling(() => void refreshDevServerCell());
    } else {
      stopPolling();
    }
  } catch {
    applyViewToDom(
      deriveHubDevServerView(
        true,
        'error',
        'status unavailable',
        null,
        cachedSettings.port,
        cachedSettings.network,
      ),
    );
  }
}

async function handlePrimaryClick(chat: Chat): Promise<void> {
  if (!isLocalServerAvailable()) return;
  syncPortFromInput();

  let startup;
  try {
    startup = await fetchWorkspaceStartup();
  } catch {
    return;
  }

  if (!startup.exists || !startup.parsed) {
    await spawnSubAgent({
      type: 'generalPurpose',
      task: SETUP_TASK,
      wait: false,
      parentChatId: chat.id,
      modeId: 'build',
    });
    applyViewToDom(
      deriveHubDevServerView(
        true,
        'starting',
        null,
        null,
        cachedSettings.port,
        cachedSettings.network,
      ),
    );
    return;
  }

  let status = startup.status;
  try {
    const live = await fetchDevServerStatus();
    status = live.status;
  } catch {
    /* use startup snapshot */
  }

  if (status === 'running') {
    applyViewToDom(
      deriveHubDevServerView(
        true,
        'stopping',
        null,
        null,
        cachedSettings.port,
        cachedSettings.network,
      ),
    );
    await postDevServerStop();
    void refreshDevServerCell();
    return;
  }

  if (status === 'starting' || status === 'stopping') {
    return;
  }

  if (status === 'error' || status === 'stopped') {
    syncPortFromInput();
    await flushDevServerSettings();
    const startSettings = { ...cachedSettings };
    lastLifecycleStatus = 'starting';
    lastLifecycleError = null;
    applyViewToDom(
      deriveHubDevServerView(
        true,
        'starting',
        null,
        null,
        startSettings.port,
        startSettings.network,
      ),
    );
    startPolling(() => void refreshDevServerCell());

    const apiResult = await postDevServerStart(startSettings);
    if (apiResult.ok) {
      managedRunId = apiResult.runId ?? null;
      syncDevServerStream('starting', managedRunId, null);
      void refreshDevServerCell();
      return;
    }

    const ws = getWorkspacePath();
    const startupPath = `${ws.replace(/\\/g, '/')}/startup.md`;
    const fallback = await spawnSubAgent({
      type: 'shell',
      task: buildStartTask(startupPath),
      wait: false,
      parentChatId: chat.id,
    });
    startAgentRunId = fallback.runId;
    applyViewToDom(
      deriveHubDevServerView(
        true,
        'starting',
        apiResult.error ?? null,
        null,
        cachedSettings.port,
        cachedSettings.network,
      ),
    );
  }
}

function wireDevServerSettings(): void {
  const settingsRow = document.getElementById('hubDevServerSettings');
  const portInput = document.getElementById('hubDevServerPort') as HTMLInputElement | null;
  const localBtn = document.getElementById('hubDevServerNetworkLocal');
  const lanBtn = document.getElementById('hubDevServerNetworkLan');

  const stopPrimary = (e: Event): void => {
    e.stopPropagation();
  };

  settingsRow?.addEventListener('click', stopPrimary);
  settingsRow?.addEventListener('keydown', stopPrimary);

  portInput?.addEventListener('click', stopPrimary);
  portInput?.addEventListener('keydown', (e) => {
    stopPrimary(e);
    if (e.key === 'Enter') portInput.blur();
  });

  const applyPortFromInput = (refreshCell: boolean): void => {
    const raw = Number(portInput?.value);
    if (!Number.isFinite(raw) || raw < 1 || raw > 65535) {
      if (portInput) portInput.value = String(cachedSettings.port);
      return;
    }
    const port = Math.floor(raw);
    cachedSettings = { ...cachedSettings, port };
    scheduleSettingsSave({ port });
    refreshMetaFromCache();
    if (refreshCell) void refreshDevServerCell();
  };

  portInput?.addEventListener('input', () => applyPortFromInput(false));
  portInput?.addEventListener('change', () => applyPortFromInput(true));
  portInput?.addEventListener('blur', () => {
    applyPortFromInput(false);
    void flushDevServerSettings();
  });

  const setNetwork = (network: DevServerNetwork): void => {
    cachedSettings = { ...cachedSettings, network };
    scheduleSettingsSave({ network });
    refreshMetaFromCache();
    void refreshDevServerCell();
  };

  localBtn?.addEventListener('click', (e) => {
    stopPrimary(e);
    if (localBtn.hasAttribute('disabled')) return;
    setNetwork('local');
  });
  lanBtn?.addEventListener('click', (e) => {
    stopPrimary(e);
    if (lanBtn.hasAttribute('disabled')) return;
    setNetwork('lan');
  });
}

function wireAgentSubscription(): void {
  if (unsubscribeAgents) return;
  unsubscribeAgents = subscribeSubAgentRuns((run) => {
    if (!startAgentRunId || run.runId !== startAgentRunId) return;
    if (run.status === 'running' || run.status === 'queued') return;
    startAgentRunId = null;
    void refreshDevServerCell();
  });
}

/** Mount dev-server cell behavior (call once per hub build). */
export function initHubDevServer(cell: HTMLElement, chat: Chat): void {
  activeChatId = chat.id;
  wireAgentSubscription();
  wireDevServerSettings();

  const consoleBtn = document.getElementById('hubDevServerConsole');

  consoleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (managedRunId && activeChatId) {
      ensureDevServerStream(managedRunId, 'dev server', activeChatId);
    }
    void openDevServerConsole();
  });

  const onPrimary = (e?: Event): void => {
    if (cell.getAttribute('aria-disabled') === 'true') return;
    const target = e?.target;
    if (
      target instanceof HTMLElement &&
      target.closest('#hubDevServerSettings, #hubDevServerConsole, #hubDevServerUrl')
    ) {
      return;
    }
    void handlePrimaryClick(chat);
  };

  cell.addEventListener('click', (e) => {
    const urlBtn = (e.target as HTMLElement).closest('#hubDevServerUrl');
    if (urlBtn && !urlBtn.classList.contains('hidden')) {
      e.preventDefault();
      e.stopPropagation();
      const url = urlBtn.getAttribute(HUB_DEV_SERVER_URL_ATTR)?.trim();
      if (url) void openHubDevServerInPreview(url);
      return;
    }
    onPrimary(e);
  });
  cell.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as HTMLElement).closest('#hubDevServerConsole')) return;
    if ((e.target as HTMLElement).closest('#hubDevServerUrl')) return;
    if ((e.target as HTMLElement).closest('#hubDevServerSettings')) return;
    e.preventDefault();
    onPrimary();
  });

  void refreshDevServerCell();
}

/** Update dev-server cell on hub refresh (no duplicate listeners). */
export function updateHubDevServer(): void {
  void refreshDevServerCell();
}

/** Tear down polling when hub unmounts. */
export function teardownHubDevServer(): void {
  stopPolling();
  stopDevServerStream();
  streamRunId = null;
  if (settingsSaveTimer) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = null;
  }
  activeChatId = null;
  managedRunId = null;
  startAgentRunId = null;
}
