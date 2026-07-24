/**
 * Global agent activity panel — all in-flight workers across chats.
 */

import { listActiveSubAgentRuns } from '../agents/orchestrator';
import { getSubAgentTypeConfig } from '../agents/sub-agent-config';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import { AGENT_ACTIVITY_OPEN_KEY } from '../constants';
import { getContextBudget } from '../chat/context-usage';
import {
  clearMainTurnActivity,
  listMainTurnActivity,
  subscribeMainTurnActivity,
} from '../chat/main-turn-activity';
import {
  listTitleJobActivity,
  subscribeTitleJobActivity,
  type TitleJobActivity,
} from '../chat/titles/activity-events';
import { listTitleJobInflightChatIds } from '../chat/titles/inflight';
import { getTitleScheduleContext } from '../chat/titles/schedule';
import {
  buildAgentActivitySnapshot,
  formatAgentActivityElapsed,
  formatAgentActivityStatusLine,
  formatAgentActivityToolRounds,
  type AgentActivityContextFill,
  type AgentActivityRow,
} from '../state/agent-activity-registry';
import { sessionState } from '../state/sessions';
import {
  registerChromePopover,
  unregisterChromePopover,
} from './preview-electron-visibility';
import { openSubAgentDrawer } from './sub-agent-drawer';
import { switchChat } from './sidebar';

const REFRESH_THROTTLE_MS = 150;
const ELAPSED_TICK_MS = 1000;

let panelOpen = false;
let chromePopoverRegistered = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let contextCache = new Map<string, AgentActivityContextFill>();
let subAgentLabelCache = new Map<string, string>();

function getPanel(): HTMLElement | null {
  return document.getElementById('agentActivityPanel');
}

function getToggleBtn(): HTMLElement | null {
  return document.getElementById('btnAgentActivity');
}

export function isAgentActivityPanelOpen(): boolean {
  return panelOpen;
}

export function setAgentActivityPanelOpen(open: boolean): void {
  const panel = getPanel();
  const btn = getToggleBtn();
  if (!panel) return;

  panelOpen = open;
  panel.classList.toggle('is-open', open);
  panel.hidden = !open;
  btn?.setAttribute('aria-expanded', open ? 'true' : 'false');

  try {
    localStorage.setItem(AGENT_ACTIVITY_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }

  if (open) {
    if (!chromePopoverRegistered) {
      registerChromePopover();
      chromePopoverRegistered = true;
    }
    void refreshAgentActivityPanel(true);
    startElapsedTimer();
  } else {
    if (chromePopoverRegistered) {
      unregisterChromePopover();
      chromePopoverRegistered = false;
    }
    stopElapsedTimer();
  }
}

export function toggleAgentActivityPanel(): void {
  setAgentActivityPanelOpen(!panelOpen);
}

function startElapsedTimer(): void {
  stopElapsedTimer();
  elapsedTimer = setInterval(() => {
    if (!panelOpen) return;
    updateElapsedCellsOnly();
  }, ELAPSED_TICK_MS);
}

function stopElapsedTimer(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (panelOpen) {
      void refreshAgentActivityPanel(false);
    } else {
      void refreshAgentActivityBadgeOnly();
    }
  }, REFRESH_THROTTLE_MS);
}

/** Update footer badge count without rebuilding the open panel list. */
async function refreshAgentActivityBadgeOnly(): Promise<void> {
  if (!sessionState) return;
  const rows = buildAgentActivitySnapshot({
    nowMs: Date.now(),
    chats: sessionState.chats,
    mainTurns: listMainTurnActivity(),
    subAgents: listActiveSubAgentRuns(),
    titleJobs: mergeTitleJobActivity(),
    resolveSubAgentLabel: (type) => subAgentLabelCache.get(type) ?? type,
  });
  updateBadgeCount(rows.length);
}

function mergeTitleJobActivity(): TitleJobActivity[] {
  const rows = listTitleJobActivity();
  const seen = new Set(rows.map((r) => r.chatId));
  for (const chatId of listTitleJobInflightChatIds()) {
    if (seen.has(chatId)) continue;
    const ctx = getTitleScheduleContext(chatId);
    rows.push({
      chatId,
      modelId: ctx?.modelId,
      providerId: ctx?.providerId,
      startedAtMs: Date.now(),
    });
  }
  return rows;
}

async function resolveSubAgentLabel(type: string): Promise<string> {
  const cached = subAgentLabelCache.get(type);
  if (cached) return cached;
  const cfg = await getSubAgentTypeConfig(type);
  const label = cfg?.label?.trim() || type;
  subAgentLabelCache.set(type, label);
  return label;
}

async function loadContextFills(chats: { id: string }[]): Promise<Map<string, AgentActivityContextFill>> {
  const map = new Map<string, AgentActivityContextFill>();
  const state = sessionState;
  if (!state) return map;

  await Promise.all(
    chats.map(async (c) => {
      const chat = state.chats.find((x) => x.id === c.id);
      if (!chat) return;
      try {
        const budget = await getContextBudget({ chat });
        map.set(c.id, {
          percent: budget.percent,
          isEstimate: budget.isEstimate,
        });
      } catch {
        map.set(c.id, { percent: null, isEstimate: true });
      }
    }),
  );
  return map;
}

function updateBadgeCount(count: number): void {
  const btn = getToggleBtn();
  if (!btn) return;
  let badge = btn.querySelector('.agent-activity-badge');
  if (count <= 0) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'agent-activity-badge';
    badge.setAttribute('aria-hidden', 'true');
    btn.appendChild(badge);
  }
  badge.textContent = count > 9 ? '9+' : String(count);
}

function renderEmptyState(list: HTMLElement): void {
  list.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'agent-activity-empty';
  empty.textContent = 'No agents are running right now.';
  list.appendChild(empty);
}

function renderContextBar(row: AgentActivityRow): HTMLElement | null {
  if (row.contextPercent == null) return null;
  const wrap = document.createElement('div');
  wrap.className = 'agent-activity-row__context';
  const track = document.createElement('div');
  track.className = 'agent-activity-row__context-track';
  const fill = document.createElement('div');
  fill.className = 'agent-activity-row__context-fill';
  fill.style.width = `${Math.min(100, Math.max(0, row.contextPercent))}%`;
  track.appendChild(fill);
  wrap.appendChild(track);
  const hint = row.contextIsEstimate ? ' (estimate)' : '';
  wrap.title = `Context fill${hint}`;
  return wrap;
}

function buildRowElement(row: AgentActivityRow): HTMLElement {
  const li = document.createElement('li');
  li.className = 'agent-activity-row';
  li.dataset.rowId = row.id;
  li.setAttribute('role', 'listitem');
  li.tabIndex = 0;

  const head = document.createElement('div');
  head.className = 'agent-activity-row__head';

  const label = document.createElement('span');
  label.className = 'agent-activity-row__label';
  label.textContent = row.label;

  const elapsed = document.createElement('span');
  elapsed.className = 'agent-activity-row__elapsed';
  elapsed.dataset.elapsedMs = String(row.elapsedMs);
  elapsed.textContent = formatAgentActivityElapsed(row.elapsedMs);

  head.appendChild(label);
  head.appendChild(elapsed);

  const meta = document.createElement('div');
  meta.className = 'agent-activity-row__meta';
  meta.textContent = `${row.chatTitle} · ${row.modelDisplay}`;

  const status = document.createElement('div');
  status.className = 'agent-activity-row__status';
  const statusText = formatAgentActivityStatusLine(row);
  const rounds = formatAgentActivityToolRounds(row);
  status.textContent = rounds ? `${statusText} · ${rounds}` : statusText;

  li.appendChild(head);
  li.appendChild(meta);
  li.appendChild(status);
  const ctxBar = renderContextBar(row);
  if (ctxBar) li.appendChild(ctxBar);

  if (row.kind === 'title_job') {
    const badge = document.createElement('span');
    badge.className = 'agent-activity-row__bg-badge';
    badge.textContent = 'Background';
    li.appendChild(badge);
  }

  li.addEventListener('click', () => {
    void handleRowActivate(row);
  });
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void handleRowActivate(row);
    }
  });

  return li;
}

async function handleRowActivate(row: AgentActivityRow): Promise<void> {
  if (row.chatId) {
    switchChat(row.chatId);
  }
  if (row.kind === 'sub_agent' && row.runId && row.chatId) {
    openSubAgentDrawer(row.runId, row.chatId);
  }
}

function updateElapsedCellsOnly(): void {
  const list = document.getElementById('agentActivityList');
  if (!list) return;
  const now = Date.now();
  for (const el of list.querySelectorAll<HTMLElement>('.agent-activity-row')) {
    const elapsedEl = el.querySelector<HTMLElement>('.agent-activity-row__elapsed');
    if (!elapsedEl) continue;
    const rowId = el.dataset.rowId;
    if (!rowId) continue;
    const startedAttr = elapsedEl.dataset.startedAtMs;
    if (!startedAttr) continue;
    const started = Number(startedAttr);
    if (!Number.isFinite(started)) continue;
    const elapsedMs = Math.max(0, now - started);
    elapsedEl.dataset.elapsedMs = String(elapsedMs);
    elapsedEl.textContent = formatAgentActivityElapsed(elapsedMs);
  }
}

/** Rebuild list from current activity sources. */
export async function refreshAgentActivityPanel(forceContext = false): Promise<void> {
  const list = document.getElementById('agentActivityList');
  if (!list || !sessionState) return;

  const subAgents = listActiveSubAgentRuns();
  const labelResolver = async (type: string) => resolveSubAgentLabel(type);

  const mainChatIds = new Set(listMainTurnActivity().map((t) => t.chatId));
  for (const c of sessionState.chats) {
    if (c.currentGenerationId?.trim()) mainChatIds.add(c.id);
  }

  if (forceContext || contextCache.size === 0) {
    contextCache = await loadContextFills([...mainChatIds].map((id) => ({ id })));
  }

  const resolveSubAgentLabelSync = (type: string): string =>
    subAgentLabelCache.get(type) ?? type;

  for (const run of subAgents) {
    await labelResolver(run.type);
  }

  const rows = buildAgentActivitySnapshot({
    nowMs: Date.now(),
    chats: sessionState.chats,
    mainTurns: listMainTurnActivity(),
    subAgents,
    titleJobs: mergeTitleJobActivity(),
    contextByChatId: contextCache,
    resolveSubAgentLabel: resolveSubAgentLabelSync,
  });

  updateBadgeCount(rows.length);

  if (rows.length === 0) {
    renderEmptyState(list);
    return;
  }

  list.replaceChildren();
  list.setAttribute('role', 'list');
  for (const row of rows) {
    const el = buildRowElement(row);
    const elapsedEl = el.querySelector('.agent-activity-row__elapsed');
    if (elapsedEl instanceof HTMLElement) {
      elapsedEl.dataset.startedAtMs = String(row.startedAtMs);
    }
    list.appendChild(el);
  }
}

function bindActivitySubscriptions(): void {
  subscribeSubAgentRuns(() => scheduleRefresh());
  subscribeMainTurnActivity(() => scheduleRefresh());
  subscribeTitleJobActivity(() => scheduleRefresh());
}

function bindPanelChrome(): void {
  getToggleBtn()?.addEventListener('click', () => toggleAgentActivityPanel());

  document.getElementById('btnAgentActivityClose')?.addEventListener('click', () => {
    setAgentActivityPanelOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panelOpen) return;
    const panel = getPanel();
    if (!panel || panel.hidden) return;
    setAgentActivityPanelOpen(false);
  });
}

/** Wire panel toggle, subscriptions, and persisted open state. */
export function initAgentActivityPanel(): void {
  let open = false;
  try {
    open = localStorage.getItem(AGENT_ACTIVITY_OPEN_KEY) === '1';
  } catch {
    open = false;
  }
  bindActivitySubscriptions();
  bindPanelChrome();
  setAgentActivityPanelOpen(open);
  void refreshAgentActivityPanel(true);
}
