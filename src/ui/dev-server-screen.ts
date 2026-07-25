/**
 * Code app Dev Servers screen — multi-server registry, logs, listening ports (MIN-500).
 */

import '../styles/dev-server-screen.css';
import { spawnSubAgent } from '../agents/orchestrator';
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
  deriveDevServerRowView,
  labelPortAttribution,
} from './dev-server-screen-view';
import { stripMainColumnOverlayClasses } from './main-column-overlay';

const ROOT_ID = 'devServerScreenRoot';
const CHAT_AREA_CLASS = 'chat-area--dev-server';
const MAIN_COLUMN_CLASS = 'main-column--dev-server';
const POLL_FAST_MS = 2000;
const POLL_SLOW_MS = 10000;

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

let initialized = false;
let returnChatId: string | null = null;
let pollTimer: number | undefined;
let servers: DevServerListItem[] = [];
let ports: ListeningPortRow[] = [];
let selectedId: string | null = null;
let editingId: string | null = null;
let showAddForm = false;
let portsAuto = true;

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
    <div class="dev-server-screen__body">
      <section class="dev-server-screen__section" aria-label="Server list">
        <div class="dev-server-screen__section-head">
          <h2 class="dev-server-screen__section-title">Servers</h2>
        </div>
        <div class="dev-server-screen__list" data-role="server-list"></div>
        <div class="dev-server-screen__form hidden" data-role="edit-form"></div>
      </section>
      <section class="dev-server-screen__section" aria-label="Logs">
        <div class="dev-server-screen__section-head">
          <h2 class="dev-server-screen__section-title">Logs</h2>
          <div class="dev-server-log__tabs" data-role="log-tabs"></div>
          <div class="dev-server-log__toolbar">
            <input type="search" class="dev-server-log__filter" data-role="log-filter" placeholder="Filter…" aria-label="Filter logs" />
            <button type="button" class="dev-server-screen__btn" data-action="log-wrap" aria-pressed="true">Wrap</button>
            <button type="button" class="dev-server-screen__btn" data-action="log-clear">Clear</button>
          </div>
        </div>
        <div class="dev-server-log__output-host" data-role="log-output"></div>
      </section>
      <section class="dev-server-screen__section" aria-label="Listening ports">
        <div class="dev-server-screen__section-head">
          <h2 class="dev-server-screen__section-title">Ports (listening)</h2>
          <div class="dev-server-screen__actions">
            <button type="button" class="dev-server-screen__btn" data-action="ports-refresh">Refresh</button>
            <button type="button" class="dev-server-screen__btn" data-action="ports-auto" aria-pressed="true">Auto</button>
          </div>
        </div>
        <div class="dev-server-ports__table" data-role="ports-table"></div>
      </section>
    </div>
  `;
  return root;
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
      : 'Local server offline — start Minnow with npm start.';
    list.appendChild(empty);
    return;
  }

  for (const item of visible) {
    const view = deriveDevServerRowView(online, item);
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

    const actions = document.createElement('div');
    actions.className = 'dev-server-screen__row-actions';
    actions.append(
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

  form.innerHTML = `
    <label>Name<input name="name" value="${escapeAttr(def?.name ?? '')}" /></label>
    <label>Command<input name="command" value="${escapeAttr(def?.command ?? existing?.command ?? '')}" ${lockedCmd ? 'disabled' : ''} /></label>
    <label>Cwd<input name="cwd" value="${escapeAttr(def?.cwd ?? '.')}" ${lockedCmd ? 'disabled' : ''} /></label>
    <label>Port<input name="port" type="number" min="1" max="65535" value="${def?.port ?? existing?.port ?? DEFAULT_DEV_SERVER_PORT}" /></label>
    <label>Network
      <select name="network">
        <option value="local" ${(def?.network ?? 'local') === 'local' ? 'selected' : ''}>This PC</option>
        <option value="lan" ${(def?.network ?? 'local') === 'lan' ? 'selected' : ''}>Network</option>
      </select>
    </label>
    <label>Health URL<input name="healthUrl" value="${escapeAttr(def?.healthUrl ?? '')}" ${lockedCmd ? 'disabled' : ''} /></label>
    <div class="dev-server-screen__form-actions">
      <label><input type="checkbox" name="autoStart" ${def?.autoStart ? 'checked' : ''} /> Auto-start</label>
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

function renderPorts(): void {
  const host = document.querySelector<HTMLElement>('[data-role="ports-table"]');
  if (!host) return;
  if (!ports.length) {
    host.innerHTML = `<div class="dev-server-screen__empty">No listening ports reported.</div>`;
    return;
  }
  const rows = ports
    .map((p) => {
      const attr = labelPortAttribution(p, servers);
      const attrLabel = p.protected
        ? 'Minnow (protected)'
        : attr
          ? `← ${attr}`
          : '';
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
    <thead><tr><th>Port</th><th>Process</th><th>PID</th><th></th><th></th></tr></thead>
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
    try {
      ports = await fetchListeningPorts();
    } catch {
      ports = [];
    }
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
  await postDevServerStartById(id);
  await refreshAll();
}

async function onStop(id: string): Promise<void> {
  await postDevServerStopById(id);
  await refreshAll();
}

async function onRestart(id: string): Promise<void> {
  await postDevServerRestartById(id);
  await refreshAll();
}

async function onDelete(id: string): Promise<void> {
  if (!window.confirm('Delete this server definition?')) return;
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
  if (!window.confirm(`Kill process ${pid} on port ${port}?`)) return;
  const result = await postKillPortOwner(pid, port);
  if (!result.ok) window.alert(result.error ?? 'Kill failed');
  await refreshAll();
}

async function onDetect(): Promise<void> {
  const chat = getActiveChat();
  if (!chat) {
    window.alert('Open a chat first so Detect can spawn a setup agent.');
    return;
  }
  await spawnSubAgent({
    type: 'generalPurpose',
    task: SETUP_TASK,
    wait: false,
    parentChatId: chat.id,
    modeId: 'build',
  });
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
  if (!name) {
    window.alert('Name is required');
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
      });
    } else {
      if (!command) {
        window.alert('Command is required');
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
      });
    }
    hideEditForm();
    await refreshAll();
  } catch (err) {
    window.alert(err instanceof Error ? err.message : String(err));
  }
}

function wireShellEvents(root: HTMLElement): void {
  root.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'refresh') void refreshAll();
    if (action === 'add') openEditForm('new');
    if (action === 'detect') void onDetect();
    if (action === 'log-clear') clearActiveLog();
    if (action === 'log-wrap') {
      const pressed = target.getAttribute('aria-pressed') !== 'true';
      target.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      setLogWrap(pressed);
    }
    if (action === 'ports-refresh') {
      void fetchListeningPorts()
        .then((rows) => {
          ports = rows;
          renderPorts();
        })
        .catch(() => undefined);
    }
    if (action === 'ports-auto') {
      portsAuto = !portsAuto;
      target.setAttribute('aria-pressed', portsAuto ? 'true' : 'false');
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
  syncRailButton();
  startPolling();
  await refreshAll();
  notifyAskQuestionDisplayContextChanged();
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
  syncRailButton();

  if (!options?.skipNavigate) {
    navigateToCodeChat();
  }

  if (options?.restoreChat === false) {
    notifyAskQuestionDisplayContextChanged();
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
