/**
 * Bottom docked terminal: interactive PTY tabs (xterm) + agent run stream sidebar.
 */

import {
  cancelTerminalRun,
  fetchTerminalLog,
  loadTerminalHistory,
  startTerminalRun,
  streamTerminalRun,
} from '../api/terminal';
import {
  getTerminalMetaCached,
  loadTerminalMeta,
  saveTerminalMeta,
} from '../config/terminal-meta';
import { getActiveChat, scheduleSaveSessions } from '../state/sessions';
import type { TerminalRunRecord } from '../types';
import { getLocalServerAvailable } from '../tools/client';
import { registerShellRun, unregisterShellRun } from './shell-run-registry';
import { refreshShellKillUi } from './shell-run-ui';
import {
  detachAllTerminalTabs,
  initTerminalTabs,
  isTerminalTabsInitialized,
  onTerminalPanelResize,
  setAgentTabActivityBadge,
  setTerminalNewTabScope,
  setTerminalTabChangeHandler,
  activePtyDiffersFromTargetCwd,
  switchToAgentTab,
  switchToDevServerTab,
  type TerminalTabKind,
} from './terminal-tabs';
import { stripAnsi } from '../lib/strip-ansi';
import {
  focusTerminalXterm,
  initTerminalXterm,
  isTerminalXtermReady,
} from './terminal-xterm';
import { appendConsoleOutputWithLinks } from './terminal-console-links';
import {
  shouldShowAgentTabActivityBadge,
  shouldSwitchToAgentTab,
} from './terminal-agent-follow-policy';
import {
  formatTerminalCwdHeader,
  formatTerminalShellHint,
  getTerminalCwdLabelSuffix,
  resolveFileExplorerTerminalCwd,
  terminalCwdsEqual,
} from './terminal-worktree-cwd';

const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_RATIO = 0.5;

let panelEl: HTMLElement | null = null;
let agentPaneEl: HTMLElement | null = null;
let devServerPaneEl: HTMLElement | null = null;
let devServerOutputEl: HTMLElement | null = null;
let ptyPaneEl: HTMLElement | null = null;
let outputEl: HTMLElement | null = null;
let xtermHostEl: HTMLElement | null = null;
let agentRunSelectEl: HTMLSelectElement | null = null;
let offlineBannerEl: HTMLElement | null = null;
let terminalCwdLabelEl: HTMLElement | null = null;
let activeRunId: string | null = null;
/** Background dev-server log stream (hub-owned; does not open the panel). */
let devServerSubscribedRunId: string | null = null;
let devServerStreamChatId: string | null = null;
let devServerStreamAbort: AbortController | null = null;
let devServerStickToBottom = true;
let devServerDisplayBytes = 0;
let stickToBottom = true;
let displayBytes = 0;
const MAX_DISPLAY_BYTES = 2 * 1024 * 1024;
let activeTabKind: TerminalTabKind = 'pty';
/** Depth of agent runs that requested the top-bar hint while the panel was closed. */
let agentRunHintDepth = 0;
/** Depth of agent runs that should badge the Agent tab while the user is on another tab. */
let agentTabActivityDepth = 0;
/** Last synced target cwd for new PTY tabs (file-explorer scope change detection). */
let terminalTargetCwd: string | undefined;
let terminalScopeChangePending = false;

const TERMINAL_BTN_DEFAULT_TITLE = 'Terminal (Ctrl+`)';
const TERMINAL_BTN_AGENT_RUN_TITLE =
  'Agent command running — click Terminal to view';

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
  agentPaneEl = document.getElementById('terminalAgentPane');
  devServerPaneEl = document.getElementById('terminalDevServerPane');
  devServerOutputEl = document.getElementById('terminalDevServerOutput');
  ptyPaneEl = document.getElementById('terminalPtyPane');
  outputEl = document.getElementById('terminalOutput');
  xtermHostEl = document.getElementById('terminalXtermHost');
  agentRunSelectEl = document.getElementById(
    'terminalAgentRunSelect',
  ) as HTMLSelectElement | null;
  offlineBannerEl = document.getElementById('terminalOfflineBanner');
  terminalCwdLabelEl = document.getElementById('terminalCwdLabel');
}

function updateTerminalCwdChrome(cwd: string): void {
  if (!terminalCwdLabelEl) return;
  const label = formatTerminalCwdHeader(cwd);
  const suffix = getTerminalCwdLabelSuffix(cwd);
  terminalCwdLabelEl.textContent = label;
  terminalCwdLabelEl.title = cwd;
  terminalCwdLabelEl.classList.toggle('terminal-cwd-label--worktree', suffix.length > 0);
}

function updateTerminalShellHintText(cwd: string): void {
  const hintEl = document.getElementById('terminalShellHint');
  if (!hintEl) return;
  const activeShellDiffers =
    terminalScopeChangePending && activePtyDiffersFromTargetCwd(cwd);
  hintEl.textContent = formatTerminalShellHint(cwd, {
    scopeChanged: terminalScopeChangePending,
    activeShellDiffers,
  });
}

function maybeClearScopeChangePending(): void {
  if (!terminalTargetCwd || !terminalScopeChangePending) return;
  if (!activePtyDiffersFromTargetCwd(terminalTargetCwd)) {
    terminalScopeChangePending = false;
    updateTerminalShellHintText(terminalTargetCwd);
  }
}

/**
 * Align terminal cwd with the file explorer / git panel root (MIN-349).
 * New PTY tabs spawn in the resolved cwd; existing shells keep their directory.
 */
export function syncTerminalFromFileExplorer(): void {
  getElements();

  const cwd = resolveFileExplorerTerminalCwd();
  const prevCwd = terminalTargetCwd;
  const cwdChanged =
    prevCwd !== undefined && !terminalCwdsEqual(prevCwd, cwd);

  terminalTargetCwd = cwd;
  terminalScopeChangePending = cwdChanged;
  setTerminalNewTabScope(cwd);
  updateTerminalCwdChrome(cwd);
  updateTerminalShellHintText(cwd);
}

function applyActiveTabView(kind: TerminalTabKind): void {
  activeTabKind = kind;
  const isAgent = kind === 'agent';
  const isDevServer = kind === 'devServer';
  const isPty = kind === 'pty';
  const isVirtual = isAgent || isDevServer;

  agentPaneEl?.classList.toggle('hidden', !isAgent);
  devServerPaneEl?.classList.toggle('hidden', !isDevServer);
  ptyPaneEl?.classList.toggle('hidden', !isPty);

  document.getElementById('terminalShellHint')?.classList.toggle('hidden', isVirtual);
  document.getElementById('terminalShellSelect')?.classList.toggle('hidden', isVirtual);
  document.getElementById('terminalCwdLabel')?.classList.toggle('hidden', isVirtual);
  const clearBtn = document.getElementById('btnTerminalClear');
  clearBtn?.classList.toggle('hidden', !isAgent && !isDevServer);
  if (clearBtn) {
    clearBtn.textContent = isDevServer ? 'Clear dev server output' : 'Clear agent output';
  }

  if (isAgent) {
    setAgentTabActivityBadge(false);
    scrollOutputIfPinned();
    refreshShellKillUi();
    return;
  }

  if (isDevServer) {
    scrollDevServerIfPinned();
    void import('./hub-dev-server').then(({ syncDevServerConsoleStopVisibility }) => {
      syncDevServerConsoleStopVisibility(true);
    });
    return;
  }

  void import('./hub-dev-server').then(({ syncDevServerConsoleStopVisibility }) => {
    syncDevServerConsoleStopVisibility(false);
  });

  requestAnimationFrame(() => {
    onTerminalPanelResize();
    focusTerminalXterm();
  });
}

/** Switch to the Agent tab only when the user opted in or explicitly requested history. */
function maybeFollowAgentTab(userInitiated = false): void {
  const meta = getTerminalMetaCached();
  if (
    shouldSwitchToAgentTab({
      panelOpen: isTerminalPanelOpen(),
      userInitiated,
      autoFollowAgentTab: meta.autoFollowAgentTab,
    })
  ) {
    void switchToAgentTab();
  }
}

function syncAgentTabActivityBadge(): void {
  setAgentTabActivityBadge(
    shouldShowAgentTabActivityBadge({
      panelOpen: isTerminalPanelOpen(),
      activeTabKind,
      activityDepth: agentTabActivityDepth,
    }),
  );
}

function bumpAgentTabActivity(delta: number): void {
  agentTabActivityDepth = Math.max(0, agentTabActivityDepth + delta);
  syncAgentTabActivityBadge();
}

function updateOfflineBanner(): void {
  if (!offlineBannerEl || !xtermHostEl) return;
  const offline = !getLocalServerAvailable();
  offlineBannerEl.classList.toggle('hidden', !offline);
  xtermHostEl.classList.toggle('terminal-xterm-host--offline', offline);
}

function scrollOutputIfPinned(): void {
  if (!outputEl || !stickToBottom || activeTabKind !== 'agent') return;
  outputEl.scrollTop = outputEl.scrollHeight;
}

function appendOutputText(text: string, stream: 'stdout' | 'stderr'): void {
  if (!outputEl || !text) return;

  const plain = stripAnsi(text);
  if (!plain) return;

  const addBytes = new TextEncoder().encode(plain).length;
  if (displayBytes + addBytes > MAX_DISPLAY_BYTES) {
    if (!outputEl.dataset.truncated) {
      outputEl.appendChild(document.createTextNode('\n…[truncated]\n'));
      outputEl.dataset.truncated = '1';
    }
    return;
  }
  displayBytes += addBytes;

  appendConsoleOutputWithLinks(outputEl, plain, { stderr: stream === 'stderr' });
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
  maybeFollowAgentTab();
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
  if (!agentRunSelectEl) return;
  agentRunSelectEl.value = runId;
}

export function appendTerminalOutput(
  runId: string,
  stream: 'stdout' | 'stderr',
  text: string,
): void {
  if (activeRunId && runId !== activeRunId) return;
  appendOutputText(text, stream);
  externalHooks.onChunk?.(runId, stream, text);
}

function syncTerminalAgentRunHint(): void {
  const btn = document.getElementById('btnTerminal');
  if (!btn) return;
  const show = agentRunHintDepth > 0;
  btn.classList.toggle('icon-btn--agent-run', show);
  btn.setAttribute('title', show ? TERMINAL_BTN_AGENT_RUN_TITLE : TERMINAL_BTN_DEFAULT_TITLE);
}

function bumpAgentRunHint(delta: number): void {
  agentRunHintDepth = Math.max(0, agentRunHintDepth + delta);
  syncTerminalAgentRunHint();
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
    agentRunHintDepth = 0;
    syncTerminalAgentRunHint();
    void ensureTerminalTabsWhenOpen();
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

/** Wire PTY tabs and attach the active tab only after the user opens the panel. */
async function ensureTerminalTabsWhenOpen(): Promise<void> {
  if (!isTerminalPanelOpen()) return;

  const tabBar = document.getElementById('terminalTabBar');
  const shellSelect = document.getElementById(
    'terminalShellSelect',
  ) as HTMLSelectElement | null;
  if (
    !tabBar ||
    !shellSelect ||
    !getLocalServerAvailable() ||
    !isTerminalXtermReady()
  ) {
    return;
  }

  try {
    await initTerminalTabs(tabBar, shellSelect);
  } catch (err) {
    console.error('Terminal tabs failed to initialize', err);
  }
}

export function openTerminalPanel(): void {
  ensureTerminalPanelVisible();
  void ensureTerminalTabsWhenOpen();
  void refreshTerminalHistoryForActiveChat();
}

function scrollDevServerIfPinned(): void {
  if (!devServerOutputEl || !devServerStickToBottom || activeTabKind !== 'devServer') {
    return;
  }
  devServerOutputEl.scrollTop = devServerOutputEl.scrollHeight;
}

function clearDevServerOutput(): void {
  if (!devServerOutputEl) return;
  devServerOutputEl.textContent = '';
  delete devServerOutputEl.dataset.truncated;
  devServerDisplayBytes = 0;
}

function appendDevServerOutputText(text: string, stream: 'stdout' | 'stderr'): void {
  if (!devServerOutputEl || !text) return;

  const plain = stripAnsi(text);
  if (!plain) return;

  const addBytes = new TextEncoder().encode(plain).length;
  if (devServerDisplayBytes + addBytes > MAX_DISPLAY_BYTES) {
    if (!devServerOutputEl.dataset.truncated) {
      devServerOutputEl.appendChild(document.createTextNode('\n…[truncated]\n'));
      devServerOutputEl.dataset.truncated = '1';
    }
    return;
  }
  devServerDisplayBytes += addBytes;

  appendConsoleOutputWithLinks(devServerOutputEl, plain, { stderr: stream === 'stderr' });
  scrollDevServerIfPinned();
}

/** Stop background dev-server log streaming (hub teardown / run change). */
export function stopDevServerStream(): void {
  devServerStreamAbort?.abort();
  devServerStreamAbort = null;
  devServerSubscribedRunId = null;
  devServerStreamChatId = null;
}

async function pumpDevServerStream(
  runId: string,
  label: string,
  chatId: string,
  abort: AbortController,
): Promise<void> {
  let finished = false;
  let exitCode: number | null = null;
  let timedOut = false;

  try {
    await streamTerminalRun(
      runId,
      (ev) => {
        if (devServerSubscribedRunId !== runId) return;
        if (ev.type === 'stdout') {
          appendDevServerOutputText(ev.text, 'stdout');
        } else if (ev.type === 'stderr') {
          appendDevServerOutputText(ev.text, 'stderr');
        } else if (ev.type === 'exit') {
          finished = true;
          exitCode = ev.code;
          timedOut = ev.timedOut;
          appendDevServerOutputText(
            `\n[exit ${ev.code ?? '?'}${ev.timedOut ? ', timed out' : ''}]\n`,
            'stderr',
          );
        } else if (ev.type === 'error') {
          appendDevServerOutputText(`\nError: ${ev.message}\n`, 'stderr');
        }
      },
      abort.signal,
    );
  } catch (err) {
    if (abort.signal.aborted) return;
    appendDevServerOutputText(
      `\nError: ${err instanceof Error ? err.message : String(err)}\n`,
      'stderr',
    );
  } finally {
    if (devServerStreamAbort === abort) {
      devServerStreamAbort = null;
    }
    if (devServerSubscribedRunId === runId) {
      devServerSubscribedRunId = null;
    }
  }

  if (!finished || abort.signal.aborted) return;

  const chat = getActiveChat();
  if (chat?.id === chatId) {
    upsertChatTerminalRun(chat, {
      id: runId,
      command: label,
      cwd: '.',
      source: 'agent',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      exitCode,
      timedOut,
      logPath: `logs/dev-server/${runId}.log`,
    });
    await refreshTerminalHistoryForActiveChat();
    scheduleSaveSessions();
  }
}

/**
 * Attach SSE logs for a managed dev-server run without opening the terminal panel.
 * Idempotent while the same runId is already streaming.
 */
export function ensureDevServerStream(
  runId: string,
  label: string,
  chatId: string,
): void {
  getElements();
  if (devServerSubscribedRunId === runId && devServerStreamAbort) return;

  stopDevServerStream();
  devServerSubscribedRunId = runId;
  devServerStreamChatId = chatId;
  clearDevServerOutput();
  appendDevServerOutputText(`$ ${label}\n`, 'stdout');
  devServerStickToBottom = true;

  const abort = new AbortController();
  devServerStreamAbort = abort;
  void pumpDevServerStream(runId, label, chatId, abort);
}

/** Open the terminal panel on the Dev server tab (Console button). */
export async function openDevServerConsole(): Promise<void> {
  openTerminalPanel();
  await ensureTerminalTabsWhenOpen();
  await switchToDevServerTab();
  scrollDevServerIfPinned();
}

/**
 * @deprecated Use ensureDevServerStream + openDevServerConsole.
 */
export async function attachDevServerConsole(): Promise<void> {
  await openDevServerConsole();
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
  if (!agentRunSelectEl) return;

  const sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt);
  agentRunSelectEl.innerHTML = '';

  if (sorted.length === 0) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No agent runs yet';
    empty.disabled = true;
    empty.selected = true;
    agentRunSelectEl.appendChild(empty);
    return;
  }

  for (const run of sorted) {
    const label = historyCommandLabel(run);
    const opt = document.createElement('option');
    opt.value = run.id;
    opt.textContent = label;
    opt.title = label;
    agentRunSelectEl.appendChild(opt);
  }
}

function wireAgentRunSelect(): void {
  agentRunSelectEl?.addEventListener('change', () => {
    const runId = agentRunSelectEl?.value?.trim();
    if (!runId) return;
    void loadHistoryRun(runId);
  });
}

async function loadHistoryRun(runId: string): Promise<void> {
  maybeFollowAgentTab(true);
  clearOutput();
  setActiveHistoryRun(runId);
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

  devServerOutputEl?.addEventListener('scroll', () => {
    if (!devServerOutputEl) return;
    const atBottom =
      devServerOutputEl.scrollHeight -
        devServerOutputEl.scrollTop -
        devServerOutputEl.clientHeight <
      24;
    devServerStickToBottom = atBottom;
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
    /** When aborted (e.g. user Stop), cancel the server run. */
    abortSignal?: AbortSignal;
    /** Allow-listed workspace root for agent runs (user runs stay global). */
    workspaceRoot?: string;
    /** Working directory relative to workspaceRoot. */
    cwd?: string;
    /** Custom timeout in ms forwarded to the server (1000–600000; default 30s). */
    timeoutMs?: number;
  },
): Promise<string> {
  const isAgentRun = options.source === 'agent';
  if (isAgentRun && getTerminalMetaCached().autoOpenOnAgentRun) {
    openTerminalPanel();
  }

  const panelWasClosed = !isTerminalPanelOpen();
  // Agent/sub-agent shell tools never raise the panel unless the user opted in.
  const showAgentRunHint = isAgentRun && panelWasClosed;
  const showAgentTabBadge = isAgentRun && !panelWasClosed;
  if (showAgentRunHint) {
    bumpAgentRunHint(1);
  }
  if (showAgentTabBadge) {
    bumpAgentTabActivity(1);
  }

  try {
  const label = options.displayLabel ?? command;
  beginCommandOutput(label, { clear: true });

  const { runId, startedAt } = await startTerminalRun({
    command,
    args: options.args,
    shell: options.shell,
    chatId: options.chatId,
    source: options.source,
    toolCallId: options.toolCallId,
    workspaceRoot: options.workspaceRoot,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
  });

  activeRunId = runId;
  registerShellRun({
    runId,
    command: label,
    toolCallId: options.toolCallId,
    chatId: options.chatId,
  });
  refreshShellKillUi();
  setActiveHistoryRun(runId);
  options.hooks?.onRunStart?.(runId, label);
  externalHooks.onRunStart?.(runId, label);

  let exitCode: number | null = 0;
  let timedOut = false;
  let stopped = false;
  let stdoutAcc = '';
  let stderrAcc = '';
  let aborted = false;

  const onAbort = () => {
    aborted = true;
    void cancelTerminalRun(runId);
  };
  options.abortSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    await streamTerminalRun(
      runId,
      (ev) => {
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
          stopped = ev.stopped ?? false;
        } else if (ev.type === 'error') {
          appendOutputText(`\nError: ${ev.message}\n`, 'stderr');
        }
      },
      options.abortSignal,
    );
  } catch (err) {
    if (!aborted && !options.abortSignal?.aborted) {
      throw err;
    }
    aborted = true;
  } finally {
    options.abortSignal?.removeEventListener('abort', onAbort);
  }

  activeRunId = null;
  unregisterShellRun(runId);
  refreshShellKillUi();
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

  const timeoutSecs = options.timeoutMs ? options.timeoutMs / 1000 : 30;
  const parts = [
    aborted
      ? `${label} (cancelled)`
      : stopped
        ? `${label} (stopped by user — process terminated, not a failure)`
        : timedOut
          ? `${label} (timed out after ${timeoutSecs}s)`
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
  } finally {
    if (showAgentRunHint) {
      bumpAgentRunHint(-1);
    }
    if (showAgentTabBadge) {
      bumpAgentTabActivity(-1);
    }
  }
}

export function setTerminalStreamHooks(hooks: TerminalStreamHooks): void {
  externalHooks = hooks;
}

function wireTerminalPanelButtons(): void {
  if (panelEl?.dataset.buttonsWired === 'true') return;
  if (panelEl) panelEl.dataset.buttonsWired = 'true';

  document.getElementById('btnTerminal')?.addEventListener('click', () => {
    toggleTerminalPanel();
  });

  document.getElementById('btnTerminalClear')?.addEventListener('click', () => {
    if (activeTabKind === 'devServer') {
      clearDevServerOutput();
      return;
    }
    if (activeTabKind === 'agent') {
      clearOutput();
    }
  });

  document.getElementById('btnTerminalCollapse')?.addEventListener('click', () => {
    closeTerminalPanel();
  });
}

export async function initTerminalPanel(): Promise<void> {
  getElements();
  if (!panelEl) return;

  wireTerminalPanelButtons();
  setTerminalTabChangeHandler((_tabId, kind) => {
    applyActiveTabView(kind);
    if (kind === 'pty') {
      maybeClearScopeChangePending();
    }
  });
  wireAgentRunSelect();

  const meta = await loadTerminalMeta();
  applyPanelHeight(meta.heightPx);
  setPanelOpen(meta.open);
  updateOfflineBanner();
  applyActiveTabView('pty');

  if (xtermHostEl) {
    initTerminalXterm(xtermHostEl);
  }

  // PTY tabs attach only when the panel is opened (avoids orphan sessions on reload).
  if (meta.open) {
    await ensureTerminalTabsWhenOpen();
  }

  window.addEventListener('pagehide', () => {
    void detachAllTerminalTabs();
  });

  setupResizeHandle();
  setupOutputScroll();
  syncTerminalFromFileExplorer();
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
  if (!getLocalServerAvailable()) return;

  getElements();
  if (xtermHostEl && !isTerminalXtermReady()) {
    initTerminalXterm(xtermHostEl);
  }
  if (isTerminalPanelOpen()) {
    void ensureTerminalTabsWhenOpen();
  }
}
