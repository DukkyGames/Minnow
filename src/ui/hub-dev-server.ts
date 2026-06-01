/**
 * Vibe Hub dev-server cell — startup.md lifecycle, agents, polling, console bridge.
 */

import { spawnSubAgent } from '../agents/orchestrator';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import {
  fetchDevServerStatus,
  fetchWorkspaceStartup,
  postDevServerStop,
} from '../config/startup-api';
import { getWorkspacePath } from '../state/workspace';
import { isLocalServerAvailable } from '../tools/config';
import type { Chat } from '../types';
import {
  deriveHubDevServerView,
  type HubDevServerViewModel,
} from './hub-dev-server-view';
import { attachDevServerConsole } from './terminal-panel';

export { deriveHubDevServerView } from './hub-dev-server-view';
export type {
  HubDevServerUiState,
  HubDevServerViewModel,
} from './hub-dev-server-view';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeAgents: (() => void) | null = null;
let activeChatId: string | null = null;
let managedRunId: string | null = null;
let startAgentRunId: string | null = null;

const SETUP_TASK = `Create or update startup.md at the workspace root.

Inspect package.json, README, and common scripts to determine how to start the local dev server.
Write startup.md with YAML frontmatter:
- command (required): one shell line to start the dev server
- cwd (optional): relative directory, default .
- healthUrl (optional): HTTP URL to probe when running (e.g. http://localhost:5173/)
- port (optional): display hint
- stop.command (optional): shell command to stop when not using PID kill

Keep the markdown body as human notes for future agents.
Do not start a long-running server with execute_command (30s timeout). Use start_background_command only for a quick smoke test if needed.`;

function buildStartTask(startupPath: string): string {
  return `Read the workspace startup guide at:
${startupPath}

Start the dev server using start_background_command with the command from startup.md (respect cwd).
If healthUrl is set, wait until it responds successfully before finishing.
Report the URL/port in your structured summary.`;
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

function applyViewToDom(view: HubDevServerViewModel): void {
  const cell = document.getElementById('hubDevServerCell');
  const labelEl = document.getElementById('hubDevServerLabel');
  const metaEl = document.getElementById('hubDevServerMeta');
  const dot = document.getElementById('hubDevServerDot');
  const consoleBtn = document.getElementById('hubDevServerConsole');

  if (!cell || !labelEl || !metaEl || !dot) return;

  labelEl.textContent = view.label;
  metaEl.textContent = view.meta;

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

async function refreshDevServerCell(): Promise<void> {
  const online = isLocalServerAvailable();
  if (!online) {
    applyViewToDom(deriveHubDevServerView(false, 'stopped'));
    stopPolling();
    return;
  }

  try {
    const status = await fetchDevServerStatus();
    managedRunId = status.runId;
    const view = deriveHubDevServerView(
      true,
      status.status,
      status.error,
      status.runId,
    );
    applyViewToDom(view);

    if (status.status === 'starting' || status.status === 'running') {
      startPolling(() => void refreshDevServerCell());
    } else {
      stopPolling();
    }
  } catch {
    applyViewToDom(
      deriveHubDevServerView(true, 'error', 'status unavailable'),
    );
  }
}

async function handlePrimaryClick(chat: Chat): Promise<void> {
  if (!isLocalServerAvailable()) return;

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
    applyViewToDom(deriveHubDevServerView(true, 'starting', null));
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
    applyViewToDom(deriveHubDevServerView(true, 'stopping'));
    await postDevServerStop();
    void refreshDevServerCell();
    return;
  }

  if (status === 'starting' || status === 'stopping') {
    return;
  }

  if (status === 'error' || status === 'stopped') {
    const ws = getWorkspacePath();
    const startupPath = `${ws.replace(/\\/g, '/')}/startup.md`;
    const result = await spawnSubAgent({
      type: 'shell',
      task: buildStartTask(startupPath),
      wait: false,
      parentChatId: chat.id,
    });
    startAgentRunId = result.runId;
    applyViewToDom(deriveHubDevServerView(true, 'starting', null));
    startPolling(() => void refreshDevServerCell());
  }
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

  const consoleBtn = document.getElementById('hubDevServerConsole');
  consoleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!managedRunId || !activeChatId) return;
    void attachDevServerConsole(managedRunId, 'dev server', activeChatId);
  });

  const onPrimary = (): void => {
    if (cell.getAttribute('aria-disabled') === 'true') return;
    void handlePrimaryClick(chat);
  };

  cell.addEventListener('click', onPrimary);
  cell.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as HTMLElement).closest('#hubDevServerConsole')) return;
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
  activeChatId = null;
  managedRunId = null;
  startAgentRunId = null;
}
