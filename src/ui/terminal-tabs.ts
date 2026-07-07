/**
 * Multi-tab bar: fixed Agent tab + interactive PTY terminal sessions.
 */

import { fetchShellProfiles, type ShellProfile } from '../api/terminal-pty';
import { randomUUID } from '../lib/random-id.ts';
import {
  getTerminalMetaCached,
  loadTerminalMeta,
  saveTerminalMeta,
  type TerminalTabMeta,
} from '../config/terminal-meta';
import {
  attachTerminalTab,
  detachTerminalTab,
  disconnectActiveTerminalWs,
  fitTerminalXterm,
  focusTerminalXterm,
  profileTabTitle,
  setTerminalSessionEndedHandler,
  type TerminalTabSession,
} from './terminal-xterm';

/** Virtual tab id for agent command output (not a PTY session). */
export const AGENT_TAB_ID = '__minnow_agent__';

/** Virtual tab id for workspace dev-server logs (not a PTY session). */
export const DEV_SERVER_TAB_ID = '__minnow_dev_server__';

export type TerminalTabKind = 'agent' | 'devServer' | 'pty';

let tabBarEl: HTMLElement | null = null;
let shellSelectEl: HTMLSelectElement | null = null;
let profiles: ShellProfile[] = [];
const liveTabs = new Map<string, TerminalTabSession>();
let tabsInitialized = false;
let onActiveTabChange: ((tabId: string, kind: TerminalTabKind) => void) | null =
  null;
/** When true, the Agent tab shows a pulse dot (agent command running off-tab). */
let agentTabActivityBadge = false;

export function isAgentTabId(tabId: string): boolean {
  return tabId === AGENT_TAB_ID;
}

export function isDevServerTabId(tabId: string): boolean {
  return tabId === DEV_SERVER_TAB_ID;
}

function tabKindFromId(tabId: string): TerminalTabKind {
  if (isAgentTabId(tabId)) return 'agent';
  if (isDevServerTabId(tabId)) return 'devServer';
  return 'pty';
}

function isVirtualTabId(tabId: string): boolean {
  return isAgentTabId(tabId) || isDevServerTabId(tabId);
}

export function setTerminalTabChangeHandler(
  handler: (tabId: string, kind: TerminalTabKind) => void,
): void {
  onActiveTabChange = handler;
}

function syncAgentTabActivityBadge(): void {
  const btn = tabBarEl?.querySelector<HTMLButtonElement>('.terminal-tab--agent');
  if (!btn) return;
  btn.classList.toggle('terminal-tab--agent-run', agentTabActivityBadge);
  btn.setAttribute(
    'title',
    agentTabActivityBadge
      ? 'Agent command running — click to view output'
      : 'Agent command output',
  );
}

/** Show or hide the activity dot on the Agent tab (MIN-242). */
export function setAgentTabActivityBadge(active: boolean): void {
  agentTabActivityBadge = active;
  syncAgentTabActivityBadge();
}

function notifyActiveTabChange(tabId: string): void {
  onActiveTabChange?.(tabId, tabKindFromId(tabId));
}

function randomTabId(): string {
  return randomUUID();
}

function metaToSession(meta: TerminalTabMeta): TerminalTabSession {
  return {
    tabId: meta.id,
    shellProfileId: meta.shellProfileId,
    sessionId: null,
    title: meta.title ?? meta.shellProfileId,
  };
}

function sessionsToMeta(): TerminalTabMeta[] {
  return [...liveTabs.values()].map((t, i) => ({
    id: t.tabId,
    shellProfileId: t.shellProfileId,
    title: t.title,
    chatId: null,
    order: i,
  }));
}

async function persistTabs(activeId: string | null): Promise<void> {
  await saveTerminalMeta({
    tabs: sessionsToMeta(),
    activeTabId: activeId,
  });
}

function renderAgentTab(activeId: string | null): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'terminal-tab terminal-tab--agent';
  btn.setAttribute('role', 'tab');
  btn.dataset.tabId = AGENT_TAB_ID;
  btn.setAttribute(
    'aria-selected',
    activeId === AGENT_TAB_ID ? 'true' : 'false',
  );
  btn.tabIndex = activeId === AGENT_TAB_ID ? 0 : -1;
  btn.textContent = 'Agent';
  btn.title = 'Agent command output';
  btn.addEventListener('click', () => {
    void switchTab(AGENT_TAB_ID);
  });
  return btn;
}

function renderDevServerTab(activeId: string | null): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'terminal-tab terminal-tab--dev-server';
  btn.setAttribute('role', 'tab');
  btn.dataset.tabId = DEV_SERVER_TAB_ID;
  btn.setAttribute(
    'aria-selected',
    activeId === DEV_SERVER_TAB_ID ? 'true' : 'false',
  );
  btn.tabIndex = activeId === DEV_SERVER_TAB_ID ? 0 : -1;
  btn.textContent = 'Dev server';
  btn.title = 'Workspace dev server logs';
  btn.addEventListener('click', () => {
    void switchTab(DEV_SERVER_TAB_ID);
  });
  return btn;
}

function renderTabBar(activeId: string | null): void {
  if (!tabBarEl) return;
  tabBarEl.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'terminal-tab-list';
  list.setAttribute('role', 'tablist');

  list.appendChild(renderAgentTab(activeId));
  list.appendChild(renderDevServerTab(activeId));

  for (const tab of liveTabs.values()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'terminal-tab';
    btn.setAttribute('role', 'tab');
    btn.dataset.tabId = tab.tabId;
    btn.setAttribute('aria-selected', tab.tabId === activeId ? 'true' : 'false');
    btn.tabIndex = tab.tabId === activeId ? 0 : -1;
    btn.textContent = tab.title;
    btn.title = tab.title;
    btn.addEventListener('click', () => {
      void switchTab(tab.tabId);
    });

    const close = document.createElement('span');
    close.className = 'terminal-tab-close';
    close.setAttribute('aria-label', `Close ${tab.title}`);
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      void closeTab(tab.tabId);
    });
    btn.appendChild(close);
    list.appendChild(btn);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'terminal-tab-add';
  addBtn.setAttribute('aria-label', 'New terminal tab');
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    void addTab();
  });

  tabBarEl.appendChild(list);
  tabBarEl.appendChild(addBtn);
  syncAgentTabActivityBadge();
}

function fillShellSelect(): void {
  if (!shellSelectEl) return;
  const meta = getTerminalMetaCached();
  const selected =
    meta.defaultShellProfileId ?? profiles[0]?.id ?? 'powershell';
  shellSelectEl.innerHTML = '';
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    shellSelectEl.appendChild(opt);
  }
  shellSelectEl.value = selected;
}

async function switchTab(tabId: string): Promise<void> {
  if (isVirtualTabId(tabId)) {
    disconnectActiveTerminalWs();
    renderTabBar(tabId);
    await persistTabs(tabId);
    notifyActiveTabChange(tabId);
    return;
  }

  const tab = liveTabs.get(tabId);
  if (!tab) return;

  disconnectActiveTerminalWs();
  try {
    await attachTerminalTab(tab);
  } catch {
    renderTabBar(tabId);
    await persistTabs(tabId);
    notifyActiveTabChange(tabId);
    return;
  }
  renderTabBar(tabId);
  await persistTabs(tabId);
  notifyActiveTabChange(tabId);
  focusTerminalXterm();
}

/** Switch the tab bar to the Agent output tab. */
export async function switchToAgentTab(): Promise<void> {
  if (!tabsInitialized) return;
  await switchTab(AGENT_TAB_ID);
}

/** Switch the tab bar to the Dev server logs tab. */
export async function switchToDevServerTab(): Promise<void> {
  if (!tabsInitialized) return;
  await switchTab(DEV_SERVER_TAB_ID);
}

export async function addTab(shellProfileId?: string): Promise<string> {
  const meta = getTerminalMetaCached();
  const profileId =
    shellProfileId ??
    shellSelectEl?.value ??
    meta.defaultShellProfileId ??
    profiles[0]?.id ??
    'powershell';
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0];
  const tabId = randomTabId();
  const session: TerminalTabSession = {
    tabId,
    shellProfileId: profile?.id ?? profileId,
    sessionId: null,
    title: profile ? profileTabTitle(profile) : profileId,
  };
  liveTabs.set(tabId, session);
  await switchTab(tabId);
  return tabId;
}

export async function closeTab(tabId: string): Promise<void> {
  const tab = liveTabs.get(tabId);
  if (!tab) return;
  await detachTerminalTab(tab, true);
  liveTabs.delete(tabId);

  const meta = getTerminalMetaCached();
  let nextActive = meta.activeTabId;
  if (nextActive === tabId) {
    const remaining = [...liveTabs.keys()];
    nextActive = remaining[0] ?? null;
  }

  if (liveTabs.size === 0) {
    await addTab();
    return;
  }

  renderTabBar(nextActive);
  if (nextActive) {
    await switchTab(nextActive);
  } else {
    await persistTabs(null);
  }
}

/** Whether tab bar wiring and restore have completed. */
export function isTerminalTabsInitialized(): boolean {
  return tabsInitialized;
}

/** Close all live tabs and kill server PTY sessions (e.g. on page unload). */
export async function detachAllTerminalTabs(): Promise<void> {
  for (const tab of liveTabs.values()) {
    await detachTerminalTab(tab, true);
  }
  liveTabs.clear();
  tabsInitialized = false;
  if (tabBarEl) tabBarEl.innerHTML = '';
}

/** Initialize tab UI and restore persisted tabs. */
export async function initTerminalTabs(
  tabBar: HTMLElement,
  shellSelect: HTMLSelectElement,
): Promise<void> {
  if (tabsInitialized) return;
  tabBarEl = tabBar;
  shellSelectEl = shellSelect;

  setTerminalSessionEndedHandler((tabId) => {
    const tab = liveTabs.get(tabId);
    if (tab) tab.sessionId = null;
  });

  shellSelect.addEventListener('change', () => {
    const profileId = shellSelect.value;
    void (async () => {
      // Remember default shell and open a fresh PTY tab (MIN-244).
      await saveTerminalMeta({ defaultShellProfileId: profileId });
      await addTab(profileId);
    })();
  });

  try {
    const { profiles: list } = await fetchShellProfiles();
    profiles = list;
  } catch {
    profiles = [];
  }
  fillShellSelect();

  await loadTerminalMeta();
  const meta = getTerminalMetaCached();
  const saved = meta.tabs ?? [];

  if (saved.length > 0) {
    for (const row of saved) {
      liveTabs.set(row.id, metaToSession(row));
    }
    const active = meta.activeTabId ?? saved[0].id;
    renderTabBar(active);
    if (isVirtualTabId(active)) {
      await switchTab(active);
    } else if (liveTabs.has(active)) {
      await switchTab(active);
    } else {
      await switchTab(saved[0].id);
    }
  } else {
    await addTab(meta.defaultShellProfileId);
  }

  tabsInitialized = true;
}

export function onTerminalPanelResize(): void {
  fitTerminalXterm();
}

export function getActiveTerminalTabId(): string | null {
  return getTerminalMetaCached().activeTabId ?? null;
}
