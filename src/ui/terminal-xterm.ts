/**
 * xterm.js viewport wired to PTY WebSocket sessions.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  buildTerminalWsUrl,
  createTerminalSession,
  deleteTerminalSession,
  fetchTerminalSessions,
  parsePtyServerMessage,
  resizeTerminalSession,
  type ShellProfile,
} from '../api/terminal-pty';
import { getLocalServerAvailable } from '../tools/client';
import { resolveFileExplorerTerminalCwd } from './terminal-worktree-cwd';
import {
  copyTextToClipboard,
  shouldCopyTerminalSelectionOnKeydown,
} from './terminal-copy-shortcut';
import {
  buildHistoryClearInput,
  buildHistoryReplaceInput,
  isTerminalEscapeInput,
  parseHistoryArrow,
  resolveHistoryNavigation,
  usesShellNativeHistory,
} from './terminal-history-nav';
import { handleTerminalWebLink } from './terminal-console-links';
import { buildTerminalXtermTheme } from './terminal-xterm-theme';

const HISTORY_STORAGE_PREFIX = 'minnow.terminal.history.';
const MAX_TAB_HISTORY = 500;

export interface TerminalTabSession {
  tabId: string;
  shellProfileId: string;
  sessionId: string | null;
  title: string;
  /** Chat bound when the session was created (MIN-349). */
  chatId?: string | null;
  /** Absolute cwd used when the PTY was spawned. */
  boundCwd?: string;
}

/** Padded outer shell from index.html (#terminalXtermHost). */
let outerHostEl: HTMLElement | null = null;
/** Inner viewport FitAddon sizes against (excludes host padding). */
let hostEl: HTMLElement | null = null;
let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let activeWs: WebSocket | null = null;
let activeTabId: string | null = null;
let activeShellProfileId: string | null = null;
let lineBuffer = '';
let historyIndex = -1;
let tabHistory: string[] = [];
let resizeObserver: ResizeObserver | null = null;
let onSessionEnded: ((tabId: string) => void) | null = null;

function historyKey(tabId: string): string {
  return `${HISTORY_STORAGE_PREFIX}${tabId}`;
}

/** Migrate one-time from sessionStorage (pre-reload persistence fix). */
function migrateTabHistoryFromSession(tabId: string): void {
  const key = historyKey(tabId);
  try {
    if (localStorage.getItem(key)) return;
    const legacy = sessionStorage.getItem(key);
    if (!legacy) return;
    localStorage.setItem(key, legacy);
    sessionStorage.removeItem(key);
  } catch {
    /* quota / private mode */
  }
}

function loadTabHistory(tabId: string): string[] {
  migrateTabHistoryFromSession(tabId);
  try {
    const raw = localStorage.getItem(historyKey(tabId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((l) => typeof l === 'string').slice(-MAX_TAB_HISTORY);
  } catch {
    return [];
  }
}

function saveTabHistory(tabId: string, lines: string[]): void {
  try {
    localStorage.setItem(
      historyKey(tabId),
      JSON.stringify(lines.slice(-MAX_TAB_HISTORY)),
    );
  } catch {
    /* quota */
  }
}

/** Drop stored command history when a PTY tab is closed. */
export function clearTabHistory(tabId: string): void {
  const key = historyKey(tabId);
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

function pushSubmittedLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed || !activeTabId) return;
  if (tabHistory[tabHistory.length - 1] !== trimmed) {
    tabHistory.push(trimmed);
    if (tabHistory.length > MAX_TAB_HISTORY) {
      tabHistory = tabHistory.slice(-MAX_TAB_HISTORY);
    }
    saveTabHistory(activeTabId, tabHistory);
  }
  historyIndex = tabHistory.length;
}

function resolveTerminalTypography(): {
  fontFamily: string;
  fontSize: number;
  /** xterm lineHeight is a multiplier on glyph height (not px). */
  lineHeight: number;
} {
  const style = getComputedStyle(document.documentElement);
  const fontFamily =
    style.getPropertyValue('--font-mono').trim() ||
    "'JetBrains Mono', ui-monospace, monospace";
  const fontSize =
    Number.parseFloat(style.getPropertyValue('--terminal-font-size')) || 13;
  const lineHeight =
    Number.parseFloat(style.getPropertyValue('--terminal-line-height')) || 1.55;
  return {
    fontFamily,
    fontSize,
    lineHeight,
  };
}

function applyXtermTheme(): void {
  if (!term) return;
  const style = getComputedStyle(document.documentElement);
  const typography = resolveTerminalTypography();
  term.options.theme = buildTerminalXtermTheme(style);
  term.options.fontFamily = typography.fontFamily;
  term.options.fontSize = typography.fontSize;
  term.options.lineHeight = typography.lineHeight;
}

/** Re-read CSS variables into xterm after theme change (no-op if terminal not mounted). */
export function refreshXtermTheme(): void {
  applyXtermTheme();
  fitAddon?.fit();
}

function disconnectWs(): void {
  if (activeWs) {
    activeWs.close();
    activeWs = null;
  }
}

/** Close WebSocket for the active tab without killing the server PTY. */
export function disconnectActiveTerminalWs(): void {
  disconnectWs();
  attachedTabId = null;
}

function fitAndResize(sessionId: string | null): void {
  if (!fitAddon || !term || !hostEl) return;
  fitAddon.fit();
  const cols = term.cols;
  const rows = term.rows;
  if (sessionId && cols > 0 && rows > 0) {
    void resizeTerminalSession(sessionId, cols, rows);
    if (activeWs?.readyState === WebSocket.OPEN) {
      activeWs.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }
}

function sendPtyInput(data: string): void {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !data) return;
  activeWs.send(JSON.stringify({ type: 'input', data }));
}

function trackLineBufferInput(data: string): void {
  if (isTerminalEscapeInput(data)) return;

  for (const ch of data) {
    if (ch === '\r' || ch === '\n') {
      pushSubmittedLine(lineBuffer);
      lineBuffer = '';
    } else if (ch === '\u007f' || ch === '\b') {
      lineBuffer = lineBuffer.slice(0, -1);
    } else if (ch >= ' ') {
      lineBuffer += ch;
    }
  }
}

function handleHistoryKeys(data: string): boolean {
  const arrow = parseHistoryArrow(data);
  if (!arrow || !term) return false;
  if (usesShellNativeHistory(activeShellProfileId)) return false;
  if (tabHistory.length === 0) return false;
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return false;

  const nav = resolveHistoryNavigation(
    { historyIndex, tabHistory },
    arrow,
  );
  historyIndex = nav.historyIndex;

  const input =
    nav.nextLine === ''
      ? buildHistoryClearInput(lineBuffer)
      : buildHistoryReplaceInput(lineBuffer, nav.nextLine);
  sendPtyInput(input);
  lineBuffer = nav.nextLine;
  return true;
}

function connectWs(sessionId: string, tabId: string): void {
  disconnectWs();
  const url = buildTerminalWsUrl(sessionId);
  const ws = new WebSocket(url);
  activeWs = ws;

  ws.onmessage = (ev) => {
    const text = typeof ev.data === 'string' ? ev.data : '';
    const msg = parsePtyServerMessage(text);
    if (!msg || !term) return;
    if (msg.type === 'output') {
      term.write(msg.data);
    } else if (msg.type === 'exit') {
      term.writeln(`\r\n[Session ended — exit ${msg.code}]`);
      onSessionEnded?.(tabId);
    }
  };

  ws.onopen = () => {
    fitAndResize(sessionId);
  };

  ws.onclose = () => {
    if (activeWs === ws) activeWs = null;
  };
}

function ensureTerminal(): Terminal | null {
  if (!hostEl) return null;
  if (term) return term;

  const typography = resolveTerminalTypography();
  term = new Terminal({
    cursorBlink: true,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    scrollback: 5000,
    allowProposedApi: false,
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon(handleTerminalWebLink));
  applyXtermTheme();
  term.open(hostEl);
  hostEl.setAttribute('role', 'document');
  hostEl.setAttribute('aria-label', 'Terminal');
  hostEl.setAttribute('aria-keyshortcuts', 'Control+C Meta+C');

  // Copy selected text on Ctrl/Cmd+C; otherwise Ctrl+C still sends SIGINT to the PTY.
  term.attachCustomKeyEventHandler((event) => {
    if (!shouldCopyTerminalSelectionOnKeydown(event, term.hasSelection())) {
      return true;
    }
    const selection = term.getSelection();
    if (selection) {
      event.preventDefault();
      void copyTextToClipboard(selection);
    }
    return false;
  });

  term.onData((data) => {
    if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;

    if (handleHistoryKeys(data)) return;

    trackLineBufferInput(data);
    activeWs.send(JSON.stringify({ type: 'input', data }));
  });

  const resizeTarget = hostEl;
  resizeObserver = new ResizeObserver(() => {
    const sid = activeWs ? new URL(activeWs.url).searchParams.get('sessionId') : null;
    fitAndResize(sid);
  });
  if (resizeTarget) {
    resizeObserver.observe(resizeTarget);
  }

  return term;
}

function ensureXtermViewport(host: HTMLElement): HTMLElement {
  let viewport = host.querySelector<HTMLElement>('.terminal-xterm-viewport');
  if (!viewport) {
    viewport = document.createElement('div');
    viewport.className = 'terminal-xterm-viewport';
    host.appendChild(viewport);
  }
  return viewport;
}

/** Mount xterm into the host element. */
export function initTerminalXterm(host: HTMLElement): void {
  outerHostEl = host;
  hostEl = ensureXtermViewport(host);
}

/** Whether the xterm host element has been registered. */
export function isTerminalXtermReady(): boolean {
  return outerHostEl !== null && hostEl !== null;
}

/** Fill cwd scope on restored tabs before spawning a PTY session. */
function ensureTabScope(tab: TerminalTabSession): void {
  if (!tab.boundCwd) {
    tab.boundCwd = resolveFileExplorerTerminalCwd();
  }
}

/** True when the server still has a live PTY for this session id. */
async function isTerminalSessionAlive(sessionId: string): Promise<boolean> {
  try {
    const { sessions } = await fetchTerminalSessions();
    return sessions.some((s) => s.sessionId === sessionId && !s.exited);
  } catch {
    return false;
  }
}

/** Open or reconnect PTY for a tab. */
export async function attachTerminalTab(
  tab: TerminalTabSession,
  cols = 80,
  rows = 24,
): Promise<void> {
  if (!getLocalServerAvailable()) return;

  if (attachedTabId && attachedTabId !== tab.tabId) {
    disconnectWs();
  }
  attachedTabId = tab.tabId;
  activeTabId = tab.tabId;
  activeShellProfileId = tab.shellProfileId;
  tabHistory = loadTabHistory(tab.tabId);
  historyIndex = tabHistory.length;
  lineBuffer = '';

  const t = ensureTerminal();
  if (!t) return;

  t.reset();
  t.focus();

  if (tab.sessionId) {
    const alive = await isTerminalSessionAlive(tab.sessionId);
    if (alive) {
      connectWs(tab.sessionId, tab.tabId);
      return;
    }
    tab.sessionId = null;
  }

  ensureTabScope(tab);

  try {
    const created = await createTerminalSession({
      shellProfileId: tab.shellProfileId,
      cols,
      rows,
      chatId: tab.chatId ?? null,
      cwd: tab.boundCwd,
    });
    tab.sessionId = created.sessionId;
    tab.boundCwd = created.cwd;
    connectWs(created.sessionId, tab.tabId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    t.writeln(`\r\n[Terminal] ${message}`);
    if (message.includes('Maximum')) {
      tab.sessionId = null;
    }
    throw err;
  }
}

let attachedTabId: string | null = null;

/** Tear down WebSocket; optionally delete server session. */
export async function detachTerminalTab(
  tab: TerminalTabSession,
  killServer = true,
): Promise<void> {
  if (attachedTabId === tab.tabId) {
    disconnectWs();
    attachedTabId = null;
  }
  if (killServer && tab.sessionId) {
    await deleteTerminalSession(tab.sessionId).catch(() => {});
    tab.sessionId = null;
  }
}

export function focusTerminalXterm(): void {
  term?.focus();
}

/**
 * Insert plain text at the shell prompt (file-tree drag-drop, paste helpers).
 * Updates the in-memory line buffer used for per-tab history navigation.
 */
export function insertTextAtTerminalInput(text: string): void {
  if (!text) return;
  const t = ensureTerminal();
  if (!t) return;
  t.focus();
  if (activeWs?.readyState === WebSocket.OPEN) {
    trackLineBufferInput(text);
    sendPtyInput(text);
  }
}

export function fitTerminalXterm(): void {
  const sid = activeWs
    ? new URL(activeWs.url).searchParams.get('sessionId')
    : null;
  fitAndResize(sid);
}

export function setTerminalSessionEndedHandler(
  handler: (tabId: string) => void,
): void {
  onSessionEnded = handler;
}

export function disposeTerminalXterm(): void {
  disconnectWs();
  resizeObserver?.disconnect();
  resizeObserver = null;
  term?.dispose();
  term = null;
  fitAddon = null;
}

/** Profile label for a new tab title. */
export function profileTabTitle(profile: ShellProfile): string {
  return profile.label;
}
