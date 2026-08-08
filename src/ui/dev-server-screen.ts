/**
 * Code app Dev Servers screen — multi-server registry, logs, listening ports (MIN-500).
 */

import '../styles/dev-server-screen.css';
import { cancelSubAgent, getSubAgentRun, spawnSubAgent } from '../agents/orchestrator';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentRun } from '../agents/types';
import { appAlert, appConfirm } from './app-dialog';
import {
  createDevServerApi,
  deleteDevServerApi,
  fetchDevServers,
  fetchListeningPorts,
  fetchNextFreePort,
  postDevServerRestartById,
  postDevServerStartById,
  postDevServerStopById,
  postKillPortOwner,
  updateDevServerApi,
  type DevServerListItem,
  type ListeningPortRow,
} from '../config/dev-servers-api';
import { DEFAULT_DEV_SERVER_PORT, type DevServerNetwork } from '../config/startup-api';
import { notifyAskQuestionDisplayContextChanged } from '../chat/ask-question-display';
import { navigateToCodeChat, navigateToCodeDevServers } from '../os/router';
import { getActiveChat, sessionState } from '../state/sessions';
import { isLocalServerAvailable } from '../tools/config';
import {
  clearActiveLog,
  initDevServerLogView,
  setLogFilter,
  setLogWrap,
  syncDevServerLogs,
  teardownDevServerLogView,
} from './dev-server-log-view';
import {
  cyclePortsListSort,
  DEFAULT_PORTS_LIST_SORT,
  deriveDevServerRowView,
  filterListeningPorts,
  labelPortAttribution,
  portsListSortAriaSort,
  sortListeningPorts,
  type PortsListSort,
  type PortsScopeFilter,
  type PortsSortKey,
} from './dev-server-screen-view';
import { subAgentLiveStatusLine } from './sub-agent-live-status';
import { notifyCodeStageViewChanged, stripMainColumnOverlayClasses } from './main-column-overlay';
import { formatWorktreeOptionLabel, parseWorktreeListPorcelain } from '../lib/worktree-list-parse';
import { listWorktrees } from '../state/worktree-service';
import { getWorkspacePath } from '../state/workspace';
import type { ParsedWorktree } from '../lib/worktree-list-parse';
const ROOT_ID = 'devServerScreenRoot';
const CHAT_AREA_CLASS = 'chat-area--dev-server';
const MAIN_COLUMN_CLASS = 'main-column--dev-server';
const POLL_FAST_MS = 2000;
const POLL_SLOW_MS = 10000;

const SETUP_TASK = `Register the workspace dev server using manage_dev_servers (action=create) or by creating startup.md at the workspace root.

Inspect package.json, README, and common scripts to determine how to start the local dev server.

Preferred: manage_dev_servers with action=create — fields:
- name (required): short label, e.g. "web" or "primary"
- command (required): one shell line to start the dev server
- cwd (optional): relative directory only (e.g. . or apps/web), default .
- healthUrl (optional): HTTP URL to probe when running (e.g. http://localhost:3000/)
- port (optional): display / bind hint
- network (optional): local or lan

Alternative: write startup.md with YAML frontmatter (command, cwd, healthUrl, port, stop.command) for the primary server seeded from disk.

Keep human notes in startup.md body when you use that file.
Do not start a long-running server with execute_command (30s timeout). Use manage_dev_servers action=start or start_background_command only for a quick smoke test if needed.`;

let initialized = false;
let returnChatId: string | null = null;
let pollTimer: number | undefined;
let servers: DevServerListItem[] = [];
let ports: ListeningPortRow[] = [];
let selectedId: string | null = null;
let editingId: string | null = null;
let showAddForm = false;
let portsAuto = true;
let portsFilterQuery = '';
let portsScopeFilter: PortsScopeFilter = 'all';
let portsSort: PortsListSort = { ...DEFAULT_PORTS_LIST_SORT };
let logsCollapsed = false;
let portsCollapsed = false;
/** Git worktrees available for dev-server spawn (refreshed on screen open). */
let knownWorktrees: ParsedWorktree[] = [];
/** Per-server worktree pick when starting (falls back to def.worktreeRoot). */
const pendingWorktreeById = new Map<string, string>();
/** Sub-agent run spawned by Detect servers (toolbar). */
let detectAgentRunId: string | null = null;
let detectAgentPending = false;
let detectRunListenerBound = false;

function detectRunDetailLine(run: SubAgentRun | undefined): string {
  if (!run) return 'Starting background agent…';
  const live = run.status === 'running' || run.status === 'queued';
  if (live) {
    return (
      subAgentLiveStatusLine(run, true) ||
      'Scanning package.json, README, and startup files for dev servers…'
    );
  }
  if (run.status === 'completed') {
    return 'Finished. New servers should appear in the list below.';
  }
  if (run.status === 'failed') {
    return run.error?.trim() || 'Detection failed. Check the parent chat for details.';
  }
  if (run.status === 'cancelled') return 'Detection stopped.';
  return 'Looking for dev servers…';
}

function detectRunTitle(run: SubAgentRun | undefined): string {
  if (!run) return 'Detecting dev servers';
  if (run.status === 'completed') return 'Detection complete';
  if (run.status === 'failed') return 'Detection failed';
  if (run.status === 'cancelled') return 'Detection stopped';
  return 'Detecting dev servers';
}

function syncDetectBanner(): void {
  const banner = document.querySelector<HTMLElement>('[data-role="detect-banner"]');
  const titleEl = document.querySelector<HTMLElement>('[data-role="detect-title"]');
  const detailEl = document.querySelector<HTMLElement>('[data-role="detect-detail"]');
  const liveDots = document.querySelector<HTMLElement>('[data-role="detect-live-dots"]');
  const stopBtn = document.querySelector<HTMLButtonElement>('[data-action="detect-stop"]');
  const detectBtn = document.querySelector<HTMLButtonElement>('[data-action="detect"]');
  if (!banner || !titleEl || !detailEl) return;

  if (!detectAgentRunId && !detectAgentPending) {
    banner.classList.add('hidden');
    banner.classList.remove('is-active', 'is-done', 'is-error');
    detectBtn?.removeAttribute('disabled');
    liveDots?.classList.add('hidden');
    stopBtn?.classList.add('hidden');
    return;
  }

  const run = detectAgentRunId ? getSubAgentRun(detectAgentRunId) : undefined;
  const live =
    detectAgentPending || !run || run.status === 'running' || run.status === 'queued';

  banner.classList.remove('hidden');
  banner.classList.toggle('is-active', live);
  banner.classList.toggle('is-done', run?.status === 'completed');
  banner.classList.toggle(
    'is-error',
    run?.status === 'failed' || run?.status === 'cancelled',
  );
  liveDots?.classList.toggle('hidden', !live);

  const canStop = Boolean(
    detectAgentRunId && run && (run.status === 'running' || run.status === 'queued'),
  );
  stopBtn?.classList.toggle('hidden', !canStop);

  titleEl.textContent = detectRunTitle(run);
  detailEl.textContent = detectRunDetailLine(run);
  if (live) detectBtn?.setAttribute('disabled', 'true');
  else detectBtn?.removeAttribute('disabled');
}

function bindDetectRunListener(): void {
  if (detectRunListenerBound) return;
  detectRunListenerBound = true;
  subscribeSubAgentRuns((run) => {
    if (!detectAgentRunId || run.runId !== detectAgentRunId) return;
    syncDetectBanner();
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      void refreshAll();
    }
  });
}

function clearDetectAgentState(): void {
  detectAgentRunId = null;
  detectAgentPending = false;
}

export function isDevServerScreenOpen(): boolean {
  return Boolean(document.getElementById(ROOT_ID));
}

export function dismissDevServerScreenForNavigation(): boolean {
  if (!isDevServerScreenOpen()) return false;
  closeDevServerScreen({ skipNavigate: true, restoreChat: false });
  navigateToCodeChat();
  return true;
}

function stopPolling(): void {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startPolling(): void {
  stopPolling();
  const tick = () => {
    if (document.hidden) return;
    void refreshAll();
  };
  const busy = servers.some((s) => s.status === 'starting' || s.status === 'running');
  pollTimer = window.setInterval(tick, busy ? POLL_FAST_MS : POLL_SLOW_MS);
}

async function closeCompetingMainColumnViews(): Promise<void> {
  const orchestrate = await import('./orchestrate-hub');
  if (orchestrate.isOrchestrateHubMounted()) orchestrate.closeOrchestrateHub();
  const overview = await import('./code-overview');
  if (overview.isCodeOverviewOpen()) {
    overview.closeCodeOverview({ skipNavigate: true, restoreChat: false });
  }
  const brain = await import('./code-brain-map');
  if (brain.isCodeBrainMapOpen()) brain.closeCodeBrainMap();
  const { teardownHub } = await import('./hub');
  teardownHub();
}

function buildShell(): HTMLElement {
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'dev-server-screen is-open';
  root.innerHTML = `
    <div class="dev-server-screen__toolbar">
      <h1 class="dev-server-screen__title">Dev servers</h1>
      <div class="dev-server-screen__actions">
        <button type="button" class="dev-server-screen__btn" data-action="detect">Detect servers</button>
        <button type="button" class="dev-server-screen__btn" data-action="refresh">Refresh</button>
        <button type="button" class="dev-server-screen__btn dev-server-screen__btn--primary" data-action="add">+ Add server</button>
      </div>
    </div>
    <div
      class="dev-server-screen__detect-banner hidden"
      data-role="detect-banner"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div class="dev-server-screen__detect-copy">
        <div
          class="stream-status stream-status--generating dev-server-screen__detect-live hidden"
          data-role="detect-live-dots"
          aria-hidden="true"
        >
          <span class="stream-status__dots">
            <span class="stream-status__dot"></span>
            <span class="stream-status__dot"></span>
            <span class="stream-status__dot"></span>
          </span>
        </div>
        <div class="dev-server-screen__detect-title" data-role="detect-title">Detecting dev servers</div>
        <div class="dev-server-screen__detect-detail" data-role="detect-detail"></div>
      </div>
      <button
        type="button"
        class="dev-server-screen__btn dev-server-screen__detect-stop hidden"
        data-action="detect-stop"
      >
        Stop
      </button>
    </div>
    <div class="dev-server-screen__body">
      <section class="dev-server-screen__section dev-server-screen__section--servers" aria-label="Server list">
        <div class="dev-server-screen__section-head">
          <h2 class="dev-server-screen__section-title">Servers</h2>
        </div>
        <div class="dev-server-screen__section-panel">
          <div class="dev-server-screen__list" data-role="server-list"></div>
          <div class="dev-server-screen__form hidden" data-role="edit-form"></div>
        </div>
      </section>
      <section class="dev-server-screen__section dev-server-screen__section--logs" data-section="logs" aria-label="Logs">
        <div class="dev-server-screen__section-head">
          <button type="button" class="dev-server-screen__section-toggle" data-action="toggle-logs" aria-expanded="true">
            <span class="dev-server-screen__chevron" aria-hidden="true">▾</span>
            <span class="dev-server-screen__section-title">Logs</span>
          </button>
          <div class="dev-server-log__toolbar">
            <div class="dev-server-log__tabs" data-role="log-tabs"></div>
            <input type="search" class="dev-server-log__filter" data-role="log-filter" placeholder="Filter…" aria-label="Filter logs" />
            <button type="button" class="dev-server-screen__btn" data-action="log-wrap" aria-pressed="true">Wrap</button>
            <button type="button" class="dev-server-screen__btn" data-action="log-clear">Clear</button>
          </div>
        </div>
        <div class="dev-server-screen__section-panel">
          <div class="dev-server-log__output-host" data-role="log-output"></div>
        </div>
      </section>
      <section class="dev-server-screen__section dev-server-screen__section--ports" data-section="ports" aria-label="Listening ports">
        <div class="dev-server-screen__section-head">
          <button type="button" class="dev-server-screen__section-toggle" data-action="toggle-ports" aria-expanded="true">
            <span class="dev-server-screen__chevron" aria-hidden="true">▾</span>
            <span class="dev-server-screen__section-title">Ports (listening)</span>
          </button>
          <div class="dev-server-ports__toolbar">
            <input
              type="search"
              class="dev-server-log__filter dev-server-ports__filter"
              data-role="ports-filter"
              placeholder="Search…"
              aria-label="Search listening ports"
            />
            <select class="dev-server-ports__scope" data-role="ports-scope" aria-label="Filter ports by source">
              <option value="all">All</option>
              <option value="linked">Dev servers</option>
              <option value="protected">Protected</option>
              <option value="other">Other</option>
            </select>
            <button
              type="button"
              class="dev-server-screen__btn dev-server-screen__btn--compact"
              data-action="ports-refresh"
              aria-label="Refresh port list"
            >
              Refresh
            </button>
            <button
              type="button"
              class="dev-server-screen__btn dev-server-screen__btn--compact"
              data-action="ports-auto"
              aria-pressed="true"
              aria-label="Live port updates"
            >
              Live
            </button>
          </div>
        </div>
        <div class="dev-server-screen__section-panel">
          <div class="dev-server-ports__table" data-role="ports-table"></div>
        </div>
      </section>
    </div>
  `;
  return root;
}

function normalizePathKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function resolveWorktreePathForServer(item: DevServerListItem): string {
  const ws = getWorkspacePath().trim();
  const pending = pendingWorktreeById.get(item.id);
  if (pending) return pending;
  const configured = item.def?.worktreeRoot?.trim() || item.worktreeRoot?.trim();
  if (configured) return configured;
  return ws;
}

async function refreshWorktreeOptions(): Promise<void> {
  const ws = getWorkspacePath().trim();
  if (!ws) {
    knownWorktrees = [];
    return;
  }
  const list = await listWorktrees();
  if (list.ok && list.output) {
    knownWorktrees = parseWorktreeListPorcelain(list.output);
    return;
  }
  knownWorktrees = [{ path: ws, head: '', detached: false }];
}

function buildWorktreeSelectOptions(): Array<{ value: string; label: string }> {
  const ws = getWorkspacePath().trim();
  if (!knownWorktrees.length && ws) {
    return [{ value: ws, label: 'workspace' }];
  }
  return knownWorktrees.map((wt) => ({
    value: wt.path,
    label: formatWorktreeOptionLabel(wt, ws),
  }));
}

function renderWorktreeSelect(
  item: DevServerListItem,
  disabled: boolean,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'dev-server-screen__worktree-select';
  select.title = 'Worktree';
  select.setAttribute('aria-label', `Worktree for ${item.name}`);
  select.disabled = disabled;

  const selected = resolveWorktreePathForServer(item);
  const options = buildWorktreeSelectOptions();
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    if (normalizePathKey(opt.value) === normalizePathKey(selected)) {
      el.selected = true;
    }
    select.appendChild(el);
  }

  select.addEventListener('click', (ev) => ev.stopPropagation());
  select.addEventListener('change', (ev) => {
    ev.stopPropagation();
    pendingWorktreeById.set(item.id, select.value);
  });
  return select;
}

function renderServerList(): void {
  const list = document.querySelector<HTMLElement>('[data-role="server-list"]');
  if (!list) return;
  const online = isLocalServerAvailable();
  list.replaceChildren();

  const visible = servers.filter((s) => s.def != null || s.status !== 'no_guide');
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'dev-server-screen__empty';
    empty.textContent = online
      ? 'No servers yet. Add one, or Detect servers to write startup.md.'
      : 'Minnow is not running locally. Open or restart the app.';
    list.appendChild(empty);
    return;
  }

  for (const item of visible) {
    const view = deriveDevServerRowView(online, item, getWorkspacePath());
    const row = document.createElement('div');
    row.className = 'dev-server-screen__row';
    row.classList.toggle('is-selected', item.id === selectedId);
    row.dataset.serverId = item.id;

    const dot = document.createElement('span');
    dot.className = `dev-server-screen__dot is-${view.uiState}`;
    dot.setAttribute('aria-hidden', 'true');

    const main = document.createElement('div');
    main.className = 'dev-server-screen__row-main';
    main.innerHTML = `
      <div class="dev-server-screen__row-name"></div>
      <div class="dev-server-screen__row-cmd mono"></div>
      <div class="dev-server-screen__row-meta"></div>
    `;
    main.querySelector('.dev-server-screen__row-name')!.textContent = view.name;
    main.querySelector('.dev-server-screen__row-cmd')!.textContent = view.command || '—';
    main.querySelector('.dev-server-screen__row-meta')!.textContent = view.meta;

    const worktreeSelect = renderWorktreeSelect(item, !view.canStart && !view.canRestart);

    const actions = document.createElement('div');
    actions.className = 'dev-server-screen__row-actions';
    actions.append(
      worktreeSelect,
      iconBtn('▶', 'Start', () => void onStart(item.id), !view.canStart),
      iconBtn('■', 'Stop', () => void onStop(item.id), !view.canStop),
      iconBtn('↻', 'Restart', () => void onRestart(item.id), !view.canRestart),
      iconBtn('↗', 'Open preview', () => void onOpen(view.openUrl), !view.openUrl),
      iconBtn('✎', 'Edit', () => openEditForm(item.id), !view.canEdit),
      iconBtn('✕', 'Delete', () => void onDelete(item.id), !view.canDelete),
    );

    row.append(dot, main, actions);
    row.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('.dev-server-screen__row-actions')) return;
      selectedId = item.id;
      renderServerList();
    });
    list.appendChild(row);
  }
}

function iconBtn(
  label: string,
  title: string,
  onClick: () => void,
  disabled: boolean,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dev-server-screen__icon-btn';
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.disabled = disabled;
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return btn;
}

function openEditForm(id: string | 'new'): void {
  editingId = id === 'new' ? null : id;
  showAddForm = true;
  renderEditForm();
}

function hideEditForm(): void {
  showAddForm = false;
  editingId = null;
  const form = document.querySelector<HTMLElement>('[data-role="edit-form"]');
  form?.classList.add('hidden');
  form?.replaceChildren();
}

function renderEditForm(): void {
  const form = document.querySelector<HTMLElement>('[data-role="edit-form"]');
  if (!form || !showAddForm) return;
  form.classList.remove('hidden');
  const existing = editingId ? servers.find((s) => s.id === editingId) : null;
  const def = existing?.def;
  const lockedCmd = def?.source === 'startup.md';
  const worktreeOptions = buildWorktreeSelectOptions();
  const selectedWorktree =
    def?.worktreeRoot?.trim() ||
    existing?.worktreeRoot?.trim() ||
    getWorkspacePath().trim();
  const worktreeOptionsHtml = worktreeOptions
    .map((opt) => {
      const selected =
        normalizePathKey(opt.value) === normalizePathKey(selectedWorktree) ? 'selected' : '';
      return `<option value="${escapeAttr(opt.value)}" ${selected}>${escapeAttr(opt.label)}</option>`;
    })
    .join('');

  form.innerHTML = `
    <label>Name<input name="name" value="${escapeAttr(def?.name ?? '')}" /></label>
    <label>Command<input name="command" value="${escapeAttr(def?.command ?? existing?.command ?? '')}" ${lockedCmd ? 'disabled' : ''} /></label>
    <label>Cwd<input name="cwd" value="${escapeAttr(def?.cwd ?? '.')}" ${lockedCmd ? 'disabled' : ''} /></label>
    <label>Worktree
      <select name="worktreeRoot">${worktreeOptionsHtml}</select>
    </label>
    <label>Port<input name="port" type="number" min="1" max="65535" value="${def?.port ?? existing?.port ?? DEFAULT_DEV_SERVER_PORT}" /></label>
    <label>Network
      <select name="network">
        <option value="local" ${(def?.network ?? 'local') === 'local' ? 'selected' : ''}>This PC</option>
        <option value="lan" ${(def?.network ?? 'local') === 'lan' ? 'selected' : ''}>Network</option>
      </select>
    </label>
    <label>Health URL<input name="healthUrl" value="${escapeAttr(def?.healthUrl ?? '')}" ${lockedCmd ? 'disabled' : ''} /></label>
    <div class="dev-server-screen__form-actions">
      <label class="dev-server-screen__inline-check">
        <input type="checkbox" name="autoStart" ${def?.autoStart ? 'checked' : ''} />
        <span>Auto-start</span>
      </label>
      <span class="dev-server-screen__warn" data-role="port-warn" hidden></span>
      <button type="button" class="dev-server-screen__btn" data-action="use-free-port">Use next free port</button>
      <button type="button" class="dev-server-screen__btn" data-action="cancel-edit">Cancel</button>
      <button type="button" class="dev-server-screen__btn dev-server-screen__btn--primary" data-action="save-edit">Save</button>
    </div>
  `;

  const portInput = form.querySelector<HTMLInputElement>('input[name="port"]');
  portInput?.addEventListener('input', () => void checkPortConflict(form));
  void checkPortConflict(form);
}

async function checkPortConflict(form: HTMLElement): Promise<void> {
  const warn = form.querySelector<HTMLElement>('[data-role="port-warn"]');
  const portInput = form.querySelector<HTMLInputElement>('input[name="port"]');
  if (!warn || !portInput) return;
  const port = Number(portInput.value);
  const hit = ports.find((p) => p.port === port);
  if (hit) {
    warn.hidden = false;
    warn.textContent = `Port ${port} in use by ${hit.process} (pid ${hit.pid})`;
  } else {
    warn.hidden = true;
    warn.textContent = '';
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function portsSortHeaderCell(label: string, key: PortsSortKey): string {
  const ariaSort = portsListSortAriaSort(portsSort, key);
  const active = portsSort.key === key;
  const dirHint = active ? `, ${portsSort.direction === 'asc' ? 'ascending' : 'descending'}` : '';
  return `<th scope="col" aria-sort="${ariaSort}">
    <button type="button" class="dev-server-ports__sort${active ? ' is-active' : ''}" data-ports-sort="${key}" aria-label="Sort by ${label}${dirHint}">
      <span class="dev-server-ports__sort-label">${label}</span>
      <span class="dev-server-ports__sort-indicator" aria-hidden="true">${active ? (portsSort.direction === 'asc' ? '↑' : '↓') : ''}</span>
    </button>
  </th>`;
}

function renderPorts(): void {
  const host = document.querySelector<HTMLElement>('[data-role="ports-table"]');
  if (!host) return;
  if (!ports.length) {
    host.innerHTML = `<div class="dev-server-screen__empty">No listening ports reported.</div>`;
    return;
  }
  const visible = filterListeningPorts(ports, servers, {
    query: portsFilterQuery,
    scope: portsScopeFilter,
  });
  if (!visible.length) {
    host.innerHTML = `<div class="dev-server-screen__empty">No ports match your search or filter.</div>`;
    return;
  }
  const sorted = sortListeningPorts(visible, servers, portsSort);
  const rows = sorted
    .map((p) => {
      const attrLabel = p.protected
        ? 'Minnow (protected)'
        : (() => {
            const attr = labelPortAttribution(p, servers);
            return attr ? `← ${attr}` : '';
          })();
      const killDisabled = p.protected ? 'disabled' : '';
      return `<tr>
        <td>${p.port}</td>
        <td>${escapeAttr(p.process)}</td>
        <td>${p.pid}</td>
        <td class="dev-server-ports__attr">${escapeAttr(attrLabel)}</td>
        <td><button type="button" class="dev-server-screen__icon-btn" data-kill-pid="${p.pid}" data-kill-port="${p.port}" ${killDisabled} aria-label="Kill pid ${p.pid}">✕</button></td>
      </tr>`;
    })
    .join('');
  host.innerHTML = `<table>
    <thead><tr>
      ${portsSortHeaderCell('Port', 'port')}
      ${portsSortHeaderCell('Process', 'process')}
      ${portsSortHeaderCell('PID', 'pid')}
      ${portsSortHeaderCell('Source', 'source')}
      <th scope="col" class="dev-server-ports__actions-head"><span class="visually-hidden">Actions</span></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  host.querySelectorAll<HTMLButtonElement>('[data-kill-pid]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = Number(btn.dataset.killPid);
      const port = Number(btn.dataset.killPort);
      void onKill(pid, port);
    });
  });
}

async function refreshPorts(manual = false): Promise<void> {
  if (!isLocalServerAvailable()) return;
  const btn = document.querySelector<HTMLButtonElement>('[data-action="ports-refresh"]');
  if (manual) btn?.classList.add('is-busy');
  try {
    ports = await fetchListeningPorts();
    renderPorts();
  } catch {
    /* keep last snapshot */
  } finally {
    if (manual) btn?.classList.remove('is-busy');
  }
}

function syncPortsAutoButton(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-action="ports-auto"]');
  if (!btn) return;
  btn.setAttribute('aria-pressed', portsAuto ? 'true' : 'false');
  btn.title = portsAuto ? 'Live updates on (click to pause)' : 'Live updates off (click to enable)';
}

function syncSectionCollapse(): void {
  const body = document.querySelector<HTMLElement>('.dev-server-screen__body');
  body?.classList.toggle('is-logs-collapsed', logsCollapsed);
  body?.classList.toggle('is-ports-collapsed', portsCollapsed);

  const logsSection = document.querySelector<HTMLElement>('[data-section="logs"]');
  const portsSection = document.querySelector<HTMLElement>('[data-section="ports"]');
  logsSection?.classList.toggle('is-collapsed', logsCollapsed);
  portsSection?.classList.toggle('is-collapsed', portsCollapsed);

  document
    .querySelector<HTMLElement>('[data-action="toggle-logs"]')
    ?.setAttribute('aria-expanded', logsCollapsed ? 'false' : 'true');
  document
    .querySelector<HTMLElement>('[data-action="toggle-ports"]')
    ?.setAttribute('aria-expanded', portsCollapsed ? 'false' : 'true');
}

async function refreshAll(): Promise<void> {
  if (!isLocalServerAvailable()) {
    servers = [];
    ports = [];
    renderServerList();
    renderPorts();
    startPolling();
    return;
  }
  try {
    servers = await fetchDevServers();
  } catch {
    servers = [];
  }
  if (portsAuto) {
    await refreshPorts();
  }
  if (!selectedId && servers[0]) selectedId = servers[0].id;
  renderServerList();
  renderPorts();
  await syncDevServerLogs(
    servers.map((s) => ({
      id: s.id,
      name: s.name,
      runId: s.runId,
      command: s.command,
    })),
  );
  startPolling();
}

async function onStart(id: string): Promise<void> {
  const item = servers.find((s) => s.id === id);
  const ws = getWorkspacePath().trim();
  const worktreeRoot = item ? resolveWorktreePathForServer(item) : ws;
  const options =
    ws && normalizePathKey(worktreeRoot) !== normalizePathKey(ws)
      ? { worktreeRoot }
      : undefined;
  await postDevServerStartById(id, options);
  await refreshAll();
}

async function onStop(id: string): Promise<void> {
  await postDevServerStopById(id);
  await refreshAll();
}

async function onRestart(id: string): Promise<void> {
  const item = servers.find((s) => s.id === id);
  const ws = getWorkspacePath().trim();
  const worktreeRoot = item ? resolveWorktreePathForServer(item) : ws;
  const options =
    ws && normalizePathKey(worktreeRoot) !== normalizePathKey(ws)
      ? { worktreeRoot }
      : undefined;
  await postDevServerRestartById(id, options);
  await refreshAll();
}

async function onDelete(id: string): Promise<void> {
  if (
    !(await appConfirm('Delete this server definition?', {
      confirmLabel: 'Delete',
      danger: true,
    }))
  ) {
    return;
  }
  await deleteDevServerApi(id);
  if (selectedId === id) selectedId = null;
  hideEditForm();
  await refreshAll();
}

async function onOpen(url: string | null): Promise<void> {
  if (!url) return;
  const { openUrlInPreviewPanel } = await import('./preview-panel');
  await openUrlInPreviewPanel(url);
}

async function onKill(pid: number, port: number): Promise<void> {
  if (!(await appConfirm(`Kill process ${pid} on port ${port}?`, { danger: true }))) return;
  const result = await postKillPortOwner(pid, port);
  if (!result.ok) await appAlert(result.error ?? 'Kill failed');
  await refreshAll();
}

async function onDetectStop(): Promise<void> {
  if (!detectAgentRunId) return;
  cancelSubAgent(detectAgentRunId, 'user_cancel');
  syncDetectBanner();
}

async function onDetect(): Promise<void> {
  const chat = getActiveChat();
  if (!chat) {
    await appAlert('Open a chat first so Detect can spawn a setup agent.');
    return;
  }
  bindDetectRunListener();
  detectAgentPending = true;
  detectAgentRunId = null;
  syncDetectBanner();
  try {
    const result = await spawnSubAgent({
      type: 'generalPurpose',
      task: SETUP_TASK,
      wait: false,
      parentChatId: chat.id,
      modeId: 'build',
    });
    if ('runId' in result) {
      detectAgentRunId = result.runId;
    }
  } catch (err) {
    await appAlert(err instanceof Error ? err.message : String(err));
  } finally {
    detectAgentPending = false;
    syncDetectBanner();
  }
}

async function onSaveEdit(): Promise<void> {
  const form = document.querySelector<HTMLElement>('[data-role="edit-form"]');
  if (!form) return;
  const name = (form.querySelector<HTMLInputElement>('input[name="name"]')?.value ?? '').trim();
  const command = (
    form.querySelector<HTMLInputElement>('input[name="command"]')?.value ?? ''
  ).trim();
  const cwd = (form.querySelector<HTMLInputElement>('input[name="cwd"]')?.value ?? '.').trim();
  const port = Number(form.querySelector<HTMLInputElement>('input[name="port"]')?.value);
  const network = (form.querySelector<HTMLSelectElement>('select[name="network"]')?.value ??
    'local') as DevServerNetwork;
  const healthUrl = (
    form.querySelector<HTMLInputElement>('input[name="healthUrl"]')?.value ?? ''
  ).trim();
  const autoStart = Boolean(
    form.querySelector<HTMLInputElement>('input[name="autoStart"]')?.checked,
  );
  const worktreeSelect = form.querySelector<HTMLSelectElement>('select[name="worktreeRoot"]');
  const worktreeRoot = worktreeSelect?.value?.trim() ?? '';
  const ws = getWorkspacePath().trim();
  const worktreePatch =
    ws && worktreeRoot && normalizePathKey(worktreeRoot) !== normalizePathKey(ws)
      ? { worktreeRoot }
      : { worktreeRoot: '' };
  if (!name) {
    await appAlert('Name is required');
    return;
  }
  try {
    if (editingId) {
      await updateDevServerApi(editingId, {
        name,
        command,
        cwd,
        port,
        network,
        healthUrl: healthUrl || undefined,
        autoStart,
        ...worktreePatch,
      });
    } else {
      if (!command) {
        await appAlert('Command is required');
        return;
      }
      await createDevServerApi({
        name,
        command,
        cwd,
        port,
        network,
        healthUrl: healthUrl || undefined,
        autoStart,
        ...worktreePatch,
      });
    }
    hideEditForm();
    await refreshAll();
  } catch (err) {
    await appAlert(err instanceof Error ? err.message : String(err));
  }
}

function wireShellEvents(root: HTMLElement): void {
  root.addEventListener('click', (ev) => {
    const sortBtn = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-ports-sort]');
    if (sortBtn?.dataset.portsSort) {
      portsSort = cyclePortsListSort(portsSort, sortBtn.dataset.portsSort as PortsSortKey);
      renderPorts();
      return;
    }
    const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'refresh') void refreshAll();
    if (action === 'add') openEditForm('new');
    if (action === 'detect') void onDetect();
    if (action === 'detect-stop') void onDetectStop();
    if (action === 'log-clear') clearActiveLog();
    if (action === 'log-wrap') {
      const pressed = target.getAttribute('aria-pressed') !== 'true';
      target.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      setLogWrap(pressed);
    }
    if (action === 'toggle-logs') {
      logsCollapsed = !logsCollapsed;
      syncSectionCollapse();
    }
    if (action === 'toggle-ports') {
      portsCollapsed = !portsCollapsed;
      syncSectionCollapse();
    }
    if (action === 'ports-refresh') void refreshPorts(true);
    if (action === 'ports-auto') {
      portsAuto = !portsAuto;
      syncPortsAutoButton();
      if (portsAuto) void refreshPorts(true);
    }
    if (action === 'cancel-edit') hideEditForm();
    if (action === 'save-edit') void onSaveEdit();
    if (action === 'use-free-port') {
      const form = document.querySelector<HTMLElement>('[data-role="edit-form"]');
      const portInput = form?.querySelector<HTMLInputElement>('input[name="port"]');
      const base = Number(portInput?.value) || DEFAULT_DEV_SERVER_PORT;
      void fetchNextFreePort(base).then((port) => {
        if (portInput) portInput.value = String(port);
        if (form) void checkPortConflict(form);
      });
    }
  });

  const filter = root.querySelector<HTMLInputElement>('[data-role="log-filter"]');
  filter?.addEventListener('input', () => setLogFilter(filter.value));

  const portsFilter = root.querySelector<HTMLInputElement>('[data-role="ports-filter"]');
  portsFilter?.addEventListener('input', () => {
    portsFilterQuery = portsFilter.value;
    renderPorts();
  });
  const portsScope = root.querySelector<HTMLSelectElement>('[data-role="ports-scope"]');
  portsScope?.addEventListener('change', () => {
    portsScopeFilter = (portsScope.value as PortsScopeFilter) || 'all';
    renderPorts();
  });
}

function syncRailButton(): void {
  const btn = document.getElementById('btnDevServers');
  const open = isDevServerScreenOpen();
  btn?.classList.toggle('is-active', open);
  btn?.setAttribute('aria-pressed', open ? 'true' : 'false');
}

export async function openDevServerScreen(): Promise<void> {
  if (isDevServerScreenOpen()) {
    void refreshAll();
    return;
  }

  await closeCompetingMainColumnViews();

  const area = document.getElementById('chatArea');
  if (!area) return;

  if (!returnChatId && sessionState?.activeId) {
    returnChatId = sessionState.activeId;
  }

  const shell = buildShell();
  area.replaceChildren();
  area.appendChild(shell);
  stripMainColumnOverlayClasses();
  area.classList.add(CHAT_AREA_CLASS);
  document.getElementById('mainColumn')?.classList.add(MAIN_COLUMN_CLASS);

  const tabs = shell.querySelector<HTMLElement>('[data-role="log-tabs"]');
  const output = shell.querySelector<HTMLElement>('[data-role="log-output"]');
  if (tabs && output) initDevServerLogView({ tabsEl: tabs, outputEl: output });

  wireShellEvents(shell);
  syncSectionCollapse();
  syncPortsAutoButton();
  syncRailButton();
  startPolling();
  await refreshWorktreeOptions();
  await refreshAll();
  notifyAskQuestionDisplayContextChanged();
  void import('./preview-electron-visibility').then((m) =>
    m.scheduleElectronPreviewHostVisibilitySync(),
  );
  notifyCodeStageViewChanged();
}

export function closeDevServerScreen(options?: {
  skipNavigate?: boolean;
  restoreChat?: boolean;
}): void {
  if (!isDevServerScreenOpen()) return;

  stopPolling();
  teardownDevServerLogView();
  const savedReturnChatId = returnChatId;
  document.getElementById(ROOT_ID)?.remove();
  stripMainColumnOverlayClasses();
  returnChatId = null;
  servers = [];
  ports = [];
  selectedId = null;
  hideEditForm();
  logsCollapsed = false;
  portsCollapsed = false;
  portsAuto = true;
  portsFilterQuery = '';
  portsScopeFilter = 'all';
  portsSort = { ...DEFAULT_PORTS_LIST_SORT };
  knownWorktrees = [];
  pendingWorktreeById.clear();
  clearDetectAgentState();
  syncRailButton();

  if (!options?.skipNavigate) {
    navigateToCodeChat();
  }

  if (options?.restoreChat === false) {
    notifyAskQuestionDisplayContextChanged();
    void import('./preview-electron-visibility').then((m) =>
      m.scheduleElectronPreviewHostVisibilitySync(),
    );
    notifyCodeStageViewChanged();
    return;
  }

  const targetId =
    savedReturnChatId && sessionState?.chats.some((c) => c.id === savedReturnChatId)
      ? savedReturnChatId
      : sessionState?.activeId;
  const chat = targetId ? sessionState?.chats.find((c) => c.id === targetId) : undefined;
  const area = document.getElementById('chatArea');
  if (chat) {
    void import('./messages').then((m) => m.renderChatFromHistory(chat));
  } else if (area) {
    area.replaceChildren();
  }
  notifyAskQuestionDisplayContextChanged();
  void import('./preview-electron-visibility').then((m) =>
    m.scheduleElectronPreviewHostVisibilitySync(),
  );
  notifyCodeStageViewChanged();
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash === '#/app/code/dev-server') {
    void openDevServerScreen();
    return;
  }
  if (isDevServerScreenOpen()) {
    closeDevServerScreen({ skipNavigate: true, restoreChat: false });
  }
}

export function initDevServerScreen(): void {
  if (initialized) return;
  initialized = true;

  document.getElementById('btnDevServers')?.addEventListener('click', () => {
    if (isDevServerScreenOpen()) {
      closeDevServerScreen();
      return;
    }
    navigateToCodeDevServers();
  });

  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isDevServerScreenOpen()) void refreshAll();
  });

  if (window.location.hash === '#/app/code/dev-server') {
    void openDevServerScreen();
  }
}
