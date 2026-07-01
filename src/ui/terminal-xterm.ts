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
  parsePtyServerMessage,
  resizeTerminalSession,
  type ShellProfile,
} from '../api/terminal-pty';
import { getLocalServerAvailable } from '../tools/client';
import {
  copyTextToClipboard,
  shouldCopyTerminalSelectionOnKeydown,
} from './terminal-copy-shortcut';
import {
  buildHistoryClearInput,
  buildHistoryReplaceInput,
  resolveHistoryNavigation,
} from './terminal-history-nav';

const HISTORY_STORAGE_PREFIX = 'minnow.terminal.history.';
const MAX_TAB_HISTORY = 500;

export interface TerminalTabSession {
  tabId: string;
  shellProfileId: string;
  sessionId: string | null;
  title: string;
}

let hostEl: HTMLElement | null = null;
let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let activeWs: WebSocket | null = null;
let activeTabId: string | null = null;
let lineBuffer = '';
let historyIndex = -1;
let tabHistory: string[] = [];
let resizeObserver: ResizeObserver | null = null;
let onSessionEnded: ((tabId: string) => void) | null = null;

function historyKey(tabId: string): string {
  return `${HISTORY_STORAGE_PREFIX}${tabId}`;
}

function loadTabHistory(tabId: string): string[] {
  try {
    const raw = sessionStorage.getItem(historyKey(tabId));
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
    sessionStorage.setItem(
      historyKey(tabId),
      JSON.stringify(lines.slice(-MAX_TAB_HISTORY)),
    );
  } catch {
    /* quota */
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
  const fg = style.getPropertyValue('--mn-fg').trim() || '#dfe3e8';
  const bg = style.getPropertyValue('--mn-bg').trim() || '#0f1216';
  const accent = style.getPropertyValue('--mn-accent').trim() || '#9ec5a7';
  const sel = style.getPropertyValue('--mn-surface-0').trim() || '#161a20';
  const typography = resolveTerminalTypography();
  term.options.theme = {
    background: bg,
    foreground: fg,
    cursor: accent,
    selectionBackground: sel,
  };
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

function handleHistoryKeys(data: string): boolean {
  if (!term || data !== '\u001b[A' && data !== '\u001b[B') return false;
  if (tabHistory.length === 0) return false;
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return false;

  const arrow = data === '\u001b[A' ? 'up' : 'down';
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
  term.loadAddon(new WebLinksAddon());
  applyXtermTheme();
  term.open(hostEl);

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

    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        pushSubmittedLine(lineBuffer);
        lineBuffer = '';
      } else if (ch === '\u007f') {
        lineBuffer = lineBuffer.slice(0, -1);
      } else if (ch >= ' ') {
        lineBuffer += ch;
      }
    }

    activeWs.send(JSON.stringify({ type: 'input', data }));
  });

  resizeObserver = new ResizeObserver(() => {
    const sid = activeWs ? new URL(activeWs.url).searchParams.get('sessionId') : null;
    fitAndResize(sid);
  });
  resizeObserver.observe(hostEl);

  return term;
}

/** Mount xterm into the host element. */
export function initTerminalXterm(host: HTMLElement): void {
  hostEl = host;
}

/** Whether the xterm host element has been registered. */
export function isTerminalXtermReady(): boolean {
  return hostEl !== null;
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
  tabHistory = loadTabHistory(tab.tabId);
  historyIndex = tabHistory.length;
  lineBuffer = '';

  const t = ensureTerminal();
  if (!t) return;

  t.reset();
  t.focus();

  if (tab.sessionId) {
    connectWs(tab.sessionId, tab.tabId);
    return;
  }

  try {
    const created = await createTerminalSession({
      shellProfileId: tab.shellProfileId,
      cols,
      rows,
      chatId: null,
    });
    tab.sessionId = created.sessionId;
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
