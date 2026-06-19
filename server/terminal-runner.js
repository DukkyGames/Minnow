/**
 * Terminal run registry: spawn commands, SSE stream stdout/stderr, persist history + logs.
 */

import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getMinnowHome } from './config/home.js';
import { readConfigJson, updateConfigJson } from './config/store.js';
import { validateSessionState } from './config/validators.js';
import {
  COMMAND_TIMEOUT_MS,
  formatProcessOutput,
  runProcess,
} from './process-runner.js';

/** Max in-memory bytes per run before UI/log truncation marker. */
export const MAX_TERMINAL_BUFFER_BYTES = 2 * 1024 * 1024;

/** Max terminal run records stored per chat. */
const MAX_TERMINAL_HISTORY = 50;

/** Grace period before evicting finished runs from the active map (ms). */
const RUN_EVICTION_MS = 60_000;

/** @typedef {'user' | 'agent'} TerminalSource */

/**
 * @typedef {object} TerminalRunRecord
 * @property {string} id
 * @property {string} command
 * @property {string} cwd
 * @property {TerminalSource} source
 * @property {string} [toolCallId]
 * @property {number} startedAt
 * @property {number} finishedAt
 * @property {number | null} exitCode
 * @property {boolean} timedOut
 * @property {string} logPath
 */

/**
 * @typedef {object} RunState
 * @property {string} runId
 * @property {string} command
 * @property {string} cwd
 * @property {TerminalSource} source
 * @property {string} [chatId]
 * @property {string} [toolCallId]
 * @property {number} startedAt
 * @property {import('node:child_process').ChildProcess | null} child
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} bufferBytes
 * @property {boolean} truncated
 * @property {boolean} timedOut
 * @property {number | null} exitCode
 * @property {boolean} finished
 * @property {string} logPath
 * @property {Set<(event: object) => void>} listeners
 * @property {Promise<string>} completion
 * @property {(value: string) => void} resolveCompletion
 */

/** @type {Map<string, RunState>} */
const activeRuns = new Map();

function terminalLogDir() {
  return path.join(getMinnowHome(), 'logs', 'terminal');
}

function relativeLogPath(runId) {
  return `logs/terminal/${runId}.log`;
}

function appendBuffer(state, stream, text) {
  if (!text) return;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (state.bufferBytes + bytes > MAX_TERMINAL_BUFFER_BYTES) {
    if (!state.truncated) {
      const marker = '\n…[truncated]\n';
      if (stream === 'stdout') state.stdout += marker;
      else state.stderr += marker;
      state.bufferBytes += Buffer.byteLength(marker, 'utf8');
      state.truncated = true;
    }
    return;
  }
  state.bufferBytes += bytes;
  if (stream === 'stdout') state.stdout += text;
  else state.stderr += text;
}

function emit(state, event) {
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

async function appendLogFile(logPath, text) {
  if (!text) return;
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, text, 'utf8');
}

/**
 * @param {string} chatId
 * @param {TerminalRunRecord} record
 */
async function persistTerminalHistory(chatId, record) {
  if (!chatId) return;

  try {
    await updateConfigJson('sessions/state.json', (raw) => {
      const base = raw ?? { version: 3, chats: [] };
      let state;
      try {
        state = validateSessionState(base);
      } catch {
        return base;
      }

      const chat = state.chats.find((c) => c.id === chatId);
      if (!chat) return state;

      const history = Array.isArray(chat.terminalHistory) ? [...chat.terminalHistory] : [];
      history.push(record);
      while (history.length > MAX_TERMINAL_HISTORY) {
        history.shift();
      }
      chat.terminalHistory = history;
      chat.updatedAt = Date.now();
      return state;
    });
  } catch (err) {
    console.warn('[terminal-runner] persistTerminalHistory failed:', err);
  }
}

/**
 * @param {object} params
 * @param {string} params.command
 * @param {string[]} [params.args]
 * @param {string} params.cwd
 * @param {boolean} [params.shell]
 * @param {TerminalSource} [params.source]
 * @param {string} [params.chatId]
 * @param {string} [params.toolCallId]
 * @returns {Promise<{ runId: string, startedAt: number }>}
 */
export async function createRun({
  command,
  args = [],
  cwd,
  shell = false,
  source = 'agent',
  chatId,
  toolCallId,
}) {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const logPath = path.join(terminalLogDir(), `${runId}.log`);
  const relLog = relativeLogPath(runId);

  /** @type {(value: string) => void} */
  let resolveCompletion = () => {};
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });

  /** @type {RunState} */
  const state = {
    runId,
    command,
    cwd,
    source,
    chatId,
    toolCallId,
    startedAt,
    child: null,
    stdout: '',
    stderr: '',
    bufferBytes: 0,
    truncated: false,
    timedOut: false,
    exitCode: null,
    finished: false,
    logPath,
    listeners: new Set(),
    completion,
    resolveCompletion,
  };

  activeRuns.set(runId, state);

  emit(state, { type: 'meta', runId, command, cwd });

  const runChild = async () => {
    try {
      const winOneShot =
        process.platform === 'win32' && args.length === 0 && typeof command === 'string';
      const execCommand = winOneShot ? 'cmd.exe' : command;
      const execArgs = winOneShot ? ['/d', '/s', '/c', command] : args;
      const useShell = winOneShot ? false : shell === true;

      const result = await runProcess(execCommand, execArgs, {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        shell: useShell,
        onSpawn: (child) => {
          state.child = child;
        },
        onStdout: (text) => {
          appendBuffer(state, 'stdout', text);
          emit(state, { type: 'stdout', text });
          void appendLogFile(logPath, text);
        },
        onStderr: (text) => {
          appendBuffer(state, 'stderr', text);
          emit(state, { type: 'stderr', text });
          void appendLogFile(logPath, text);
        },
      });

      state.exitCode = result.code;
      state.timedOut = result.timedOut;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('timed out')) {
        state.timedOut = true;
        state.exitCode = null;
      } else {
        state.exitCode = 1;
        emit(state, { type: 'error', message });
        await appendLogFile(logPath, `\nError: ${message}\n`);
      }
    } finally {
      await finishRun(runId);
    }
  };

  void runChild();

  return { runId, startedAt, logPath: relLog };
}

/**
 * Spawn a long-running command (no timeout). Used for dev servers and background tools.
 * @param {object} params
 * @param {string} params.command
 * @param {string[]} [params.args]
 * @param {string} params.cwd
 * @param {TerminalSource} [params.source]
 * @param {string} [params.chatId]
 * @param {string} [params.toolCallId]
 * @param {boolean} [params.shell]
 * @param {string} [params.logSubdir] logs subdirectory under ~/.minnow/logs/
 * @param {Record<string, string>} [params.env] merged over process.env for the child
 * @returns {Promise<{ runId: string, startedAt: number, logPath: string, pid: number | null }>}
 */
export async function createBackgroundRun({
  command,
  args = [],
  cwd,
  shell = false,
  source = 'agent',
  chatId,
  toolCallId,
  logSubdir = 'terminal',
  env: envOverrides,
}) {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const logDir = path.join(getMinnowHome(), 'logs', logSubdir);
  const logPath = path.join(logDir, `${runId}.log`);
  const relLog = `logs/${logSubdir}/${runId}.log`;

  /** @type {(value: string) => void} */
  let resolveCompletion = () => {};
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });

  /** @type {RunState} */
  const state = {
    runId,
    command,
    cwd,
    source,
    chatId,
    toolCallId,
    startedAt,
    child: null,
    stdout: '',
    stderr: '',
    bufferBytes: 0,
    truncated: false,
    timedOut: false,
    exitCode: null,
    finished: false,
    logPath,
    listeners: new Set(),
    completion,
    resolveCompletion,
  };

  activeRuns.set(runId, state);
  emit(state, { type: 'meta', runId, command, cwd });

  const winOneShot =
    process.platform === 'win32' && args.length === 0 && typeof command === 'string';
  const execCommand = winOneShot ? 'cmd.exe' : command;
  const execArgs = winOneShot ? ['/d', '/s', '/c', command] : args;
  const useShell = winOneShot ? false : shell === true;

  const childEnv =
    envOverrides && typeof envOverrides === 'object'
      ? { ...process.env, ...envOverrides }
      : process.env;

  const child = spawn(execCommand, execArgs, {
    cwd,
    env: childEnv,
    shell: useShell,
    // detached on Windows spawns a separate console window; windowsHide cannot hide it.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  state.child = child;
  child.unref();

  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    appendBuffer(state, 'stdout', text);
    emit(state, { type: 'stdout', text });
    void appendLogFile(logPath, text);
  });

  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    appendBuffer(state, 'stderr', text);
    emit(state, { type: 'stderr', text });
    void appendLogFile(logPath, text);
  });

  // Force-killing the process (taskkill /F) tears down these pipes abruptly and
  // can emit a stream 'error' (EPIPE/ECONNRESET). Without a listener Node rethrows
  // it as an uncaughtException, which crashes the host process running the API.
  child.stdout?.on('error', () => {});
  child.stderr?.on('error', () => {});

  child.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    emit(state, { type: 'error', message });
    void appendLogFile(logPath, `\nError: ${message}\n`);
    state.exitCode = 1;
    void finishRun(runId);
  });

  child.on('close', (code) => {
    state.exitCode = code;
    void finishRun(runId);
  });

  return { runId, startedAt, logPath: relLog, pid: child.pid ?? null };
}

/**
 * @param {string} runId
 */
export async function finishRun(runId) {
  const state = activeRuns.get(runId);
  if (!state || state.finished) return;

  state.finished = true;
  const finishedAt = Date.now();

  emit(state, {
    type: 'exit',
    code: state.exitCode,
    timedOut: state.timedOut,
  });

  const formatted = formatProcessOutput(state.command, {
    code: state.exitCode ?? 1,
    stdout: state.stdout,
    stderr: state.stderr,
    timedOut: state.timedOut,
  });
  state.resolveCompletion(formatted);

  const record = {
    id: runId,
    command: state.command,
    cwd: state.cwd,
    source: state.source,
    ...(state.toolCallId ? { toolCallId: state.toolCallId } : {}),
    startedAt: state.startedAt,
    finishedAt,
    exitCode: state.exitCode,
    timedOut: state.timedOut,
    logPath: relativeLogPath(runId),
  };

  if (state.chatId) {
    await persistTerminalHistory(state.chatId, record);
  }

  setTimeout(() => {
    activeRuns.delete(runId);
  }, RUN_EVICTION_MS);
}

/**
 * @param {string} runId
 * @returns {RunState | undefined}
 */
export function getRun(runId) {
  return activeRuns.get(runId);
}

/**
 * Wait until a run completes and return the formatted tool-result string.
 * @param {string} runId
 * @returns {Promise<string>}
 */
export function waitForRun(runId) {
  const state = activeRuns.get(runId);
  if (!state) {
    return Promise.reject(new Error('Unknown run'));
  }
  return state.completion;
}

/**
 * Subscribe to run events (used by SSE handler).
 * @param {string} runId
 * @param {(event: object) => void} listener
 * @returns {() => void}
 */
export function subscribeRun(runId, listener) {
  const state = activeRuns.get(runId);
  if (!state) return () => {};

  state.listeners.add(listener);
  listener({
    type: 'meta',
    runId: state.runId,
    command: state.command,
    cwd: state.cwd,
  });

  if (state.stdout) {
    listener({ type: 'stdout', text: state.stdout });
  }
  if (state.stderr) {
    listener({ type: 'stderr', text: state.stderr });
  }

  if (state.finished) {
    listener({
      type: 'exit',
      code: state.exitCode,
      timedOut: state.timedOut,
    });
  }

  return () => {
    state.listeners.delete(listener);
  };
}

/**
 * @param {string} runId
 */
export function cancelRun(runId) {
  const state = activeRuns.get(runId);
  if (!state || state.finished || !state.child) return false;
  killProcessTree(state.child);
  return true;
}

/**
 * Stop an active run by runId (background or foreground agent runs).
 * @param {string} runId
 * @returns {{ ok: boolean, runId: string, alreadyStopped?: boolean, error?: string }}
 */
export function stopActiveRun(runId) {
  const state = activeRuns.get(runId);
  if (!state) {
    return { ok: false, runId, error: `unknown run_id ${runId}` };
  }
  if (state.finished) {
    return { ok: true, runId, alreadyStopped: true };
  }
  if (state.child) {
    killProcessTree(state.child);
  } else {
    cancelRun(runId);
  }
  return { ok: true, runId };
}

/**
 * Non-finished runs still in the active registry.
 * @param {{ source?: TerminalSource, chatId?: string }} [filter]
 */
export function listActiveRuns(filter = {}) {
  /** @type {Array<{ runId: string, command: string, cwd: string, pid: number | null, startedAt: number, chatId?: string, source: TerminalSource }>} */
  const rows = [];
  for (const state of activeRuns.values()) {
    if (state.finished) continue;
    if (filter.source && state.source !== filter.source) continue;
    if (filter.chatId && state.chatId !== filter.chatId) continue;
    rows.push({
      runId: state.runId,
      command: state.command,
      cwd: state.cwd,
      pid: state.child?.pid ?? null,
      startedAt: state.startedAt,
      source: state.source,
      ...(state.chatId ? { chatId: state.chatId } : {}),
    });
  }
  return rows;
}

function formatRunOutputTail(state) {
  let out = `${state.stdout}${state.stderr}`;
  if (state.truncated && !out.includes('…[truncated]')) {
    out += '\n…[truncated]\n';
  }
  return out;
}

/**
 * Wait up to maxMs for stdout/stderr from an active run (process may keep running).
 * @param {string} runId
 * @param {number} maxMs
 * @returns {Promise<string>}
 */
export function waitForRunOutput(runId, maxMs) {
  const state = activeRuns.get(runId);
  if (!state) {
    return Promise.reject(new Error('Unknown run'));
  }
  const clamped = Math.max(0, Math.min(maxMs, 120_000));
  if (clamped === 0) {
    return Promise.resolve(formatRunOutputTail(state));
  }

  return new Promise((resolve) => {
    const deadline = Date.now() + clamped;
    const finish = () => resolve(formatRunOutputTail(state));
    let timer = null;
    let unsubscribe = () => {};
    const cleanup = () => {
      if (timer) clearInterval(timer);
      unsubscribe();
    };
    unsubscribe = subscribeRun(runId, (event) => {
      if (event.type === 'exit' || event.type === 'error') {
        cleanup();
        finish();
      }
    });
    timer = setInterval(() => {
      if (state.finished || Date.now() >= deadline) {
        cleanup();
        finish();
      }
    }, 50);
  });
}

/**
 * Snapshot output + lifecycle fields for read_command_log.
 * @param {string} runId
 * @param {number} [maxBytes]
 */
export async function readCommandLogSnapshot(runId, maxBytes = 64 * 1024) {
  const state = activeRuns.get(runId);
  const fileTail = await readRunLogTail(runId, maxBytes);
  const memory = state ? formatRunOutputTail(state) : '';
  const output = memory.length >= (fileTail?.length ?? 0) ? memory : (fileTail ?? memory);
  return {
    runId,
    output: output ?? '',
    finished: state?.finished ?? true,
    exitCode: state?.exitCode ?? null,
    timedOut: state?.timedOut ?? false,
    truncated: state?.truncated ?? false,
  };
}

/** Append one line to ~/.minnow/logs/kill-debug.log synchronously. Never throws. */
function logKillDebug(entry) {
  try {
    const dir = path.join(getMinnowHome(), 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      path.join(dir, 'kill-debug.log'),
      `${JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, ...entry })}\n`,
      'utf8',
    );
  } catch {
    /* diagnostics are best-effort */
  }
}

/** @type {Set<number> | null} */
let cachedAncestorPids = null;

/**
 * Build the ancestor PID chain of the current process (Windows only).
 * Used to make sure we never taskkill /T a process that we are descended from —
 * doing so would terminate the dev host (server.js) itself. The ancestor chain is
 * fixed for the lifetime of the process, so it is computed once and cached.
 * @returns {Set<number>}
 */
function selfAncestorPids() {
  if (cachedAncestorPids) return cachedAncestorPids;
  const ancestors = new Set([process.pid]);
  cachedAncestorPids = ancestors;
  if (process.platform !== 'win32') {
    if (typeof process.ppid === 'number') ancestors.add(process.ppid);
    return ancestors;
  }
  try {
    const out = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 4000 },
    );
    if (out.status !== 0 || !out.stdout) {
      if (typeof process.ppid === 'number') ancestors.add(process.ppid);
      return ancestors;
    }
    /** @type {Map<number, number>} */
    const parentOf = new Map();
    for (const line of out.stdout.split(/\r?\n/).slice(1)) {
      const m = line.match(/^"?(\d+)"?,"?(\d+)"?/);
      if (m) parentOf.set(Number(m[1]), Number(m[2]));
    }
    let cur = process.pid;
    for (let i = 0; i < 64; i++) {
      const parent = parentOf.get(cur);
      if (parent == null || parent === 0 || ancestors.has(parent)) break;
      ancestors.add(parent);
      cur = parent;
    }
  } catch {
    if (typeof process.ppid === 'number') ancestors.add(process.ppid);
  }
  return ancestors;
}

/**
 * SIGTERM / taskkill the process tree for a spawned child.
 * @param {import('node:child_process').ChildProcess} child
 */
export function killProcessTree(child) {
  if (!child?.pid) return;
  const targetPid = child.pid;

  // Guard: a stale/reused pid that resolves to our own process or one of our
  // ancestors would let `taskkill /T /F` tear down the dev host (server.js) — the
  // process that exited with code 1 with no handlers running. Refuse those.
  const ancestors = selfAncestorPids();
  if (ancestors.has(targetPid)) {
    logKillDebug({
      kind: 'kill-refused-ancestor',
      targetPid,
      ancestors: [...ancestors],
    });
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    return;
  }

  logKillDebug({ kind: 'kill', targetPid, parentPid: process.ppid });

  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(targetPid), '/T', '/F'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      // Without an 'error' listener a failed taskkill spawn (e.g. ENOENT) emits an
      // unhandled 'error' that crashes the host process.
      killer.on('error', () => {
        try {
          child.kill('SIGTERM');
        } catch {
          /* process already gone */
        }
      });
      killer.unref();
    } catch {
      child.kill('SIGTERM');
    }
    return;
  }
  try {
    process.kill(-targetPid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/**
 * @param {string} chatId
 * @returns {Promise<TerminalRunRecord[]>}
 */
export async function getTerminalHistoryForChat(chatId) {
  const raw = (await readConfigJson('sessions/state.json')) ?? { version: 3, chats: [] };
  let state;
  try {
    state = validateSessionState(raw);
  } catch {
    return [];
  }
  const chat = state.chats.find((c) => c.id === chatId);
  if (!chat || !Array.isArray(chat.terminalHistory)) return [];
  return chat.terminalHistory;
}

/**
 * @param {string} runId
 * @returns {Promise<string | null>}
 */
export async function readRunLogTail(runId, maxBytes = 64 * 1024) {
  const state = activeRuns.get(runId);
  const logPath = state?.logPath ?? path.join(terminalLogDir(), `${runId}.log`);
  try {
    const stat = await fs.stat(logPath);
    const start = Math.max(0, stat.size - maxBytes);
    const handle = await fs.open(logPath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      await handle.read(buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Blocking execute_command via the shared runner (no SSE subscribers required).
 * @param {object} params
 * @param {string} params.command
 * @param {string} params.cwd
 * @param {string} [params.chatId]
 * @param {string} [params.toolCallId]
 */
export async function executeCommandBlocking({
  command,
  args = [],
  cwd,
  shell,
  chatId,
  toolCallId,
}) {
  const { runId } = await createRun({
    command,
    args,
    cwd,
    shell,
    source: 'agent',
    chatId,
    toolCallId,
  });
  return waitForRun(runId);
}
