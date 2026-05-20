/**
 * Bottom docked terminal: interactive PTY tabs (xterm) + agent run stream sidebar.
 */

import {
  fetchTerminalLog,
  loadTerminalHistory,
  startTerminalRun,
  streamTerminalRun,
  type TerminalStreamEvent,
} from '../api/terminal';
import {
  getTerminalMetaCached,
  loadTerminalMeta,
  saveTerminalMeta,
} from '../config/terminal-meta';
import { getActiveChat, scheduleSaveSessions } from '../state/sessions';
import type { TerminalRunRecord } from '../types';
import { getLocalServerAvailable } from '../tools/client';
import { initTerminalTabs, onTerminalPanelResize } from './terminal-tabs';
import {
  focusTerminalXterm,
  initTerminalXterm,
} from './terminal-xterm';

const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_RATIO = 0.5;

let panelEl: HTMLElement | null = null;
let outputEl: HTMLElement | null = null;
let xtermHostEl: HTMLElement | null = null;
let historyEl: HTMLElement | null = null;
let offlineBannerEl: HTMLElement | null = null;
let activeRunId: string | null = null;
let stickToBottom = true;
let displayBytes = 0;
const MAX_DISPLAY_BYTES = 2 * 1024 * 1024;
let agentOutputVisible = false;

/** Hooks for tool loop streaming integration. */
export interface TerminalStreamHooks {
  onRunStart?: (runId: string, command: string) => void;
  onChunk?: (runId: string, stream: 'stdout' | 'stderr', text: string) => void;
  onRunEnd?: (runId: string) => void;
}

let externalHooks: TerminalStreamHooks = {};

function maxPanelHeight(): number {
  return Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
}

function clampHeight(px: number): number {
  return Math.min(maxPanelHeight(), Math.max(MIN_HEIGHT_PX, px));
}

function getElements(): void {
  panelEl = document.getElementById('terminalPanel');
  outputEl = document.getElementById('terminalOutput');
  xtermHostEl = document.getElementById('terminalXtermHost');
  historyEl = document.getElementById('terminalHistory');
  offlineBannerEl = document.getElementById('terminalOfflineBanner');
}

function showAgentOutputPane(): void {
  if (!outputEl) return;
  outputEl.classList.remove('hidden');
  agentOutputVisible = true;
}

function hideAgentOutputPane(): void {
  if (!outputEl) return;
  outputEl.classList.add('hidden');
  agentOutputVisible = false;
}

function updateOfflineBanner(): void {
  if (!offlineBannerEl || !xtermHostEl) return;
  const offline = !getLocalServerAvailable();
  offlineBannerEl.classList.toggle('hidden', !offline);
  xtermHostEl.classList.toggle('terminal-xterm-host--offline', offline);
}

function scrollOutputIfPinned(): void {
  if (!outputEl || !stickToBottom || !agentOutputVisible) return;
  outputEl.scrollTop = outputEl.scrollHeight;
}

function appendOutputText(text: string, stream: 'stdout' | 'stderr'): void {
  if (!outputEl || !text) return;

  const addBytes = new TextEncoder().encode(text).length;
  if (displayBytes + addBytes > MAX_DISPLAY_BYTES) {
    if (!outputEl.dataset.truncated) {
      outputEl.appendChild(document.createTextNode('\n…[truncated]\n'));
      outputEl.dataset.truncated = '1';
    }
    return;
  }
  displayBytes += addBytes;

  if (stream === 'stderr') {
    const span = document.createElement('span');
    span.className = 'stderr-line';
    span.textContent = text;
    outputEl.appendChild(span);
  } else {
    outputEl.appendChild(document.createTextNode(text));
  }
  scrollOutputIfPinned();
}

function clearOutput(): void {
  if (!outputEl) return;
  outputEl.textContent = '';
  delete outputEl.dataset.truncated;
  displayBytes = 0;
}

function isTerminalPanelOpen(): boolean {
  return Boolean(panelEl && !panelEl.classList.contains('hidden'));
}

function beginCommandOutput(command: string, options: { clear?: boolean } = {}): void {
  showAgentOutputPane();
  if (options.clear) {
    clearOutput();
    appendOutputText(`$ ${command}\n`, 'stdout');
    stickToBottom = true;
    return;
  }
  if (outputEl?.textContent?.trim()) {
    appendOutputText('\n', 'stdout');
  }
  appendOutputText(`$ ${command}\n`, 'stdout');
  stickToBottom = true;
}

function setActiveHistoryRun(runId: string): void {
  if (!historyEl) return;
  historyEl.querySelectorAll('.terminal-history-item').forEach((el) => {
    const item = el as HTMLButtonElement;
    item.classList.toggle('is-active', item.dataset.runId === runId);
  });
}

export function appendTerminalOutput(
  runId: string,
  stream: 'stdout' | 'stderr',
  text: string,
): void {
  if (activeRunId && runId !== activeRunId) return;
  showAgentOutputPane();
  appendOutputText(text, stream);
  externalHooks.onChunk?.(runId, stream, text);
}

function setPanelOpen(open: boolean): void {
  if (!panelEl) return;
  const currentlyOpen = isTerminalPanelOpen();
  const btn = document.getElementById('btnTerminal');
  btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (currentlyOpen === open) return;

  panelEl.classList.toggle('hidden', !open);
  panelEl.classList.toggle('is-collapsed', !open);
  void saveTerminalMeta({ open });
  if (open) {
    requestAnimationFrame(() => {
      onTerminalPanelResize();
      focusTerminalXterm();
    });
  }
}

function ensureTerminalPanelVisible(): void {
  if (!isTerminalPanelOpen()) {
    setPanelOpen(true);
  }
}

export function openTerminalPanel(): void {
  ensureTerminalPanelVisible();
  void refreshTerminalHistoryForActiveChat();
}

export function closeTerminalPanel(): void {
  setPanelOpen(false);
}

export function toggleTerminalPanel(): void {
  setPanelOpen(!isTerminalPanelOpen());
}

function applyPanelHeight(px: number): void {
  if (!panelEl) return;
  const height = clampHeight(px);
  panelEl.style.height = `${height}px`;
  void saveTerminalMeta({ heightPx: height });
  onTerminalPanelResize();
}

const MAX_TERMINAL_HISTORY = 50;

function historyCommandLabel(run: TerminalRunRecord): string {
  const cmd = typeof run.command === 'string' ? run.command.trim() : '';
  if (cmd) return cmd;
  if (run.toolCallId) return `Tool ${run.toolCallId.slice(0, 8)}…`;
  return `Run ${run.id.slice(0, 8)}…`;
}

function mergeTerminalHistory(
  local: TerminalRunRecord[],
  remote: TerminalRunRecord[],
): TerminalRunRecord[] {
  const byId = new Map<string, TerminalRunRecord>();
  for (const run of [...local, ...remote]) {
    if (!run?.id) continue;
    const existing = byId.get(run.id);
    if (!existing || run.finishedAt >= existing.finishedAt) {
      byId.set(run.id, run);
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_TERMINAL_HISTORY);
}

function upsertChatTerminalRun(
  chat: { terminalHistory?: TerminalRunRecord[] },
  record: TerminalRunRecord,
): void {
  const history = chat.terminalHistory ?? [];
  const next = [record, ...history.filter((r) => r.id !== record.id)].slice(
    0,
    MAX_TERMINAL_HISTORY,
  );
  chat.terminalHistory = next;
  renderHistoryList(next);
}

function renderHistoryList(runs: TerminalRunRecord[]): void {
  if (!historyEl) return;
  historyEl.innerHTML = '';
  const sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt);

  if (sorted.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'terminal-history-empty';
    empty.textContent = 'No agent runs yet';
    historyEl.appendChild(empty);
    return;
  }

  for (const run of sorted) {
    const label = historyCommandLabel(run);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'terminal-history-item';
    btn.dataset.runId = run.id;
    const cmd = document.createElement('span');
    cmd.className = 'cmd';
    cmd.textContent = label;
    cmd.title = label;
    btn.appendChild(cmd);
    btn.addEventListener('click', () => {
      void loadHistoryRun(run.id);
      historyEl
        ?.querySelectorAll('.terminal-history-item')
        .forEach((el) => el.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
    historyEl.appendChild(btn);
  }
}

async function loadHistoryRun(runId: string): Promise<void> {
  showAgentOutputPane();
  clearOutput();
  const text = await fetchTerminalLog(runId);
  if (text) {
    appendOutputText(text, 'stdout');
  }
}

export async function refreshTerminalHistoryForActiveChat(): Promise<void> {
  const chat = getActiveChat();
  if (!chat) return;

  const local = chat.terminalHistory ?? [];
  let remote: TerminalRunRecord[] = [];
  if (getLocalServerAvailable()) {
    try {
      remote = await loadTerminalHistory(chat.id);
    } catch {
      /* in-memory only */
    }
  }
  const merged = mergeTerminalHistory(local, remote);
  chat.terminalHistory = merged.length ? merged : undefined;
  renderHistoryList(merged);
}

function setupResizeHandle(): void {
  const handle = document.getElementById('terminalResize');
  if (!handle || !panelEl) return;

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startY = e.clientY;
    startHeight = panelEl!.getBoundingClientRect().height;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging || !panelEl) return;
    const delta = startY - e.clientY;
    applyPanelHeight(startHeight + delta);
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });
}

function setupOutputScroll(): void {
  outputEl?.addEventListener('scroll', () => {
    if (!outputEl) return;
    const atBottom =
      outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 24;
    stickToBottom = atBottom;
  });
}

export async function runCommandWithTerminalStream(
  command: string,
  options: {
    chatId: string;
    source: 'user' | 'agent';
    toolCallId?: string;
    displayLabel?: string;
    args?: string[];
    shell?: boolean;
    hooks?: TerminalStreamHooks;
  },
): Promise<string> {
  const meta = getTerminalMetaCached();
  if (options.source === 'agent' && meta.autoOpenOnAgentRun) {
    ensureTerminalPanelVisible();
  }

  const label = options.displayLabel ?? command;
  beginCommandOutput(label, { clear: true });

  const { runId, startedAt } = await startTerminalRun({
    command,
    args: options.args,
    shell: options.shell,
    chatId: options.chatId,
    source: options.source,
    toolCallId: options.toolCallId,
  });

  activeRunId = runId;
  options.hooks?.onRunStart?.(runId, label);
  externalHooks.onRunStart?.(runId, label);

  let exitCode: number | null = 0;
  let timedOut = false;
  let stdoutAcc = '';
  let stderrAcc = '';

  await streamTerminalRun(runId, (ev) => {
    if (ev.type === 'stdout') {
      stdoutAcc += ev.text;
      appendTerminalOutput(runId, 'stdout', ev.text);
      options.hooks?.onChunk?.(runId, 'stdout', ev.text);
    } else if (ev.type === 'stderr') {
      stderrAcc += ev.text;
      appendTerminalOutput(runId, 'stderr', ev.text);
      options.hooks?.onChunk?.(runId, 'stderr', ev.text);
    } else if (ev.type === 'exit') {
      exitCode = ev.code;
      timedOut = ev.timedOut;
    } else if (ev.type === 'error') {
      appendOutputText(`\nError: ${ev.message}\n`, 'stderr');
    }
  });

  activeRunId = null;
  options.hooks?.onRunEnd?.(runId);
  externalHooks.onRunEnd?.(runId);

  const chat = getActiveChat();
  if (chat?.id === options.chatId) {
    upsertChatTerminalRun(chat, {
      id: runId,
      command: label,
      cwd: '.',
      source: options.source,
      ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
      startedAt,
      finishedAt: Date.now(),
      exitCode,
      timedOut,
      logPath: `logs/terminal/${runId}.log`,
    });
    await refreshTerminalHistoryForActiveChat();
    scheduleSaveSessions();
  }

  const parts = [
    timedOut
      ? `${label} (timed out after 30s)`
      : `${label} (exit ${exitCode ?? 1})`,
  ];
  if (stdoutAcc.trim()) {
    parts.push(`stdout:\n${stdoutAcc.trimEnd()}`);
  }
  if (stderrAcc.trim()) {
    parts.push(`stderr:\n${stderrAcc.trimEnd()}`);
  }
  if (!stdoutAcc.trim() && !stderrAcc.trim()) {
    parts.push('(no output)');
  }
  return parts.join('\n\n');
}

export function setTerminalStreamHooks(hooks: TerminalStreamHooks): void {
  externalHooks = hooks;
}

export async function initTerminalPanel(): Promise<void> {
  getElements();
  if (!panelEl) return;

  const meta = await loadTerminalMeta();
  applyPanelHeight(meta.heightPx);
  setPanelOpen(meta.open);
  updateOfflineBanner();
  hideAgentOutputPane();

  if (xtermHostEl) {
    initTerminalXterm(xtermHostEl);
  }

  const tabBar = document.getElementById('terminalTabBar');
  const shellSelect = document.getElementById(
    'terminalShellSelect',
  ) as HTMLSelectElement | null;
  if (tabBar && shellSelect && getLocalServerAvailable()) {
    await initTerminalTabs(tabBar, shellSelect);
  }

  document.getElementById('btnTerminal')?.addEventListener('click', () => {
    toggleTerminalPanel();
  });

  document.getElementById('btnTerminalClear')?.addEventListener('click', () => {
    clearOutput();
    hideAgentOutputPane();
  });

  document.getElementById('btnTerminalCollapse')?.addEventListener('click', () => {
    closeTerminalPanel();
  });

  setupResizeHandle();
  setupOutputScroll();
  await refreshTerminalHistoryForActiveChat();
}

export function registerTerminalKeyboardShortcut(): void {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      toggleTerminalPanel();
    }
  });
}

export function onTerminalServerAvailabilityChanged(): void {
  updateOfflineBanner();
  const tabBar = document.getElementById('terminalTabBar');
  const shellSelect = document.getElementById(
    'terminalShellSelect',
  ) as HTMLSelectElement | null;
  if (getLocalServerAvailable() && tabBar && shellSelect && tabBar.childElementCount === 0) {
    void initTerminalTabs(tabBar, shellSelect);
  }
}
