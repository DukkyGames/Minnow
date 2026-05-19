/**
 * Terminal run registry: spawn commands, SSE stream stdout/stderr, persist history + logs.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSpeedChatHome } from './config/home.js';
import { readConfigJson, writeConfigJson } from './config/store.js';
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
  return path.join(getSpeedChatHome(), 'logs', 'terminal');
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

  const raw = (await readConfigJson('sessions/state.json')) ?? { version: 1, chats: [] };
  let state;
  try {
    state = validateSessionState(raw);
  } catch {
    return;
  }

  const chat = state.chats.find((c) => c.id === chatId);
  if (!chat) return;

  const history = Array.isArray(chat.terminalHistory) ? [...chat.terminalHistory] : [];
  history.push(record);
  while (history.length > MAX_TERMINAL_HISTORY) {
    history.shift();
  }
  chat.terminalHistory = history;
  chat.updatedAt = Date.now();

  await writeConfigJson('sessions/state.json', state);
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
      const result = await runProcess(command, args, {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        shell: shell || (args.length === 0 && process.platform === 'win32'),
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
  state.child.kill('SIGTERM');
  return true;
}

/**
 * @param {string} chatId
 * @returns {Promise<TerminalRunRecord[]>}
 */
export async function getTerminalHistoryForChat(chatId) {
  const raw = (await readConfigJson('sessions/state.json')) ?? { version: 1, chats: [] };
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
  const logPath = path.join(terminalLogDir(), `${runId}.log`);
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
