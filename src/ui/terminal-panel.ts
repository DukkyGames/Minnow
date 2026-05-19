/**
 * Bottom docked terminal panel: streaming output, history, user commands.
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

const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_RATIO = 0.5;

let panelEl: HTMLElement | null = null;
let outputEl: HTMLElement | null = null;
let historyEl: HTMLElement | null = null;
let formEl: HTMLFormElement | null = null;
let inputEl: HTMLInputElement | null = null;
let offlineBannerEl: HTMLElement | null = null;
let activeRunId: string | null = null;
let stickToBottom = true;
let displayBytes = 0;
const MAX_DISPLAY_BYTES = 2 * 1024 * 1024;

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
  historyEl = document.getElementById('terminalHistory');
  formEl = document.getElementById('terminalForm') as HTMLFormElement | null;
  inputEl = document.getElementById('terminalInput') as HTMLInputElement | null;
  offlineBannerEl = document.getElementById('terminalOfflineBanner');
}

function updateOfflineBanner(): void {
  if (!offlineBannerEl || !inputEl || !formEl) return;
  const offline = !getLocalServerAvailable();
  offlineBannerEl.classList.toggle('hidden', !offline);
  inputEl.disabled = offline;
  const runBtn = formEl.querySelector('button[type="submit"]') as HTMLButtonElement | null;
  if (runBtn) runBtn.disabled = offline;
}

function scrollOutputIfPinned(): void {
  if (!outputEl || !stickToBottom) return;
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

/** Append streamed chunk (tool or user run). */
export function appendTerminalOutput(
  runId: string,
  stream: 'stdout' | 'stderr',
  text: string,
): void {
  if (activeRunId && runId !== activeRunId) return;
  appendOutputText(text, stream);
  externalHooks.onChunk?.(runId, stream, text);
}

function setPanelOpen(open: boolean): void {
  if (!panelEl) return;
  panelEl.classList.toggle('hidden', !open);
  panelEl.classList.toggle('is-collapsed', !open);
  const btn = document.getElementById('btnTerminal');
  btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  void saveTerminalMeta({ open });
}

export function openTerminalPanel(): void {
  setPanelOpen(true);
}

export function closeTerminalPanel(): void {
  setPanelOpen(false);
}

export function toggleTerminalPanel(): void {
  const meta = getTerminalMetaCached();
  setPanelOpen(!meta.open);
}

function applyPanelHeight(px: number): void {
  if (!panelEl) return;
  const height = clampHeight(px);
  panelEl.style.height = `${height}px`;
  void saveTerminalMeta({ heightPx: height });
}

function renderHistoryList(runs: TerminalRunRecord[]): void {
  if (!historyEl) return;
  historyEl.innerHTML = '';
  const sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt);

  for (const run of sorted) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'terminal-history-item';
    btn.dataset.runId = run.id;
    const cmd = document.createElement('span');
    cmd.className = 'cmd';
    cmd.textContent = run.command;
    cmd.title = run.command;
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
  clearOutput();
  const text = await fetchTerminalLog(runId);
  if (text) {
    appendOutputText(text, 'stdout');
  }
}

/** Refresh history sidebar for the active chat. */
export async function refreshTerminalHistoryForActiveChat(): Promise<void> {
  const chat = getActiveChat();
  if (!chat) return;

  let runs = chat.terminalHistory ?? [];
  if (getLocalServerAvailable()) {
    try {
      const remote = await loadTerminalHistory(chat.id);
      if (remote.length) {
        runs = remote;
        chat.terminalHistory = remote;
      }
    } catch {
      /* use in-memory history */
    }
  }
  renderHistoryList(runs);
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

async function runUserCommand(command: string): Promise<void> {
  const chat = getActiveChat();
  if (!chat || !getLocalServerAvailable()) return;

  clearOutput();
  activeRunId = null;

  const { runId } = await startTerminalRun({
    command,
    chatId: chat.id,
    source: 'user',
    shell: typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent),
  });

  activeRunId = runId;
  externalHooks.onRunStart?.(runId, command);

  await streamTerminalRun(runId, (ev) => handleStreamEvent(ev));
  activeRunId = null;
  externalHooks.onRunEnd?.(runId);
  await refreshTerminalHistoryForActiveChat();
  scheduleSaveSessions();
}

function handleStreamEvent(ev: TerminalStreamEvent): void {
  if (ev.type === 'stdout') {
    appendTerminalOutput(activeRunId ?? '', 'stdout', ev.text);
  } else if (ev.type === 'stderr') {
    appendTerminalOutput(activeRunId ?? '', 'stderr', ev.text);
  } else if (ev.type === 'error') {
    appendOutputText(`\nError: ${ev.message}\n`, 'stderr');
  }
}

/**
 * Run a command with live streaming (agent tools).
 * Returns the formatted tool result string when the run completes.
 */
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
    openTerminalPanel();
  }

  clearOutput();
  const label = options.displayLabel ?? command;
  appendOutputText(`$ ${label}\n`, 'stdout');

  const { runId } = await startTerminalRun({
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

/** Wire DOM events and load persisted layout prefs. */
export async function initTerminalPanel(): Promise<void> {
  getElements();
  if (!panelEl) return;

  const meta = await loadTerminalMeta();
  applyPanelHeight(meta.heightPx);
  setPanelOpen(meta.open);
  updateOfflineBanner();

  document.getElementById('btnTerminal')?.addEventListener('click', () => {
    toggleTerminalPanel();
  });

  document.getElementById('btnTerminalClear')?.addEventListener('click', () => {
    clearOutput();
  });

  document.getElementById('btnTerminalCollapse')?.addEventListener('click', () => {
    closeTerminalPanel();
  });

  formEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    const cmd = inputEl?.value.trim();
    if (!cmd) return;
    void runUserCommand(cmd).catch((err) => {
      appendOutputText(
        `\nError: ${err instanceof Error ? err.message : String(err)}\n`,
        'stderr',
      );
    });
    if (inputEl) inputEl.value = '';
  });

  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      inputEl?.blur();
    }
  });

  setupResizeHandle();
  setupOutputScroll();
  await refreshTerminalHistoryForActiveChat();
}

/** Ctrl+` toggles the terminal panel. */
export function registerTerminalKeyboardShortcut(): void {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      toggleTerminalPanel();
    }
  });
}

/** Called when local server availability changes. */
export function onTerminalServerAvailabilityChanged(): void {
  updateOfflineBanner();
}
