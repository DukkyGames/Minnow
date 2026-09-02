/**
 * Interactive PTY session registry (node-pty via @lydell/node-pty prebuilds).
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import pty from '@lydell/node-pty';
import { getMinnowHome } from '../config/home.js';
import { logChildProcessDiagnostic } from '../diagnostics/process-handlers.js';
import { formatServerMessage } from './pty-protocol.js';
import {
  getShellProfileById,
  getDefaultShellProfileId,
  resolvePtySpawnForProfile,
} from './shell-profiles.js';
import { resolveShellProfileId, readTerminalShellConfig } from './shell-config.js';
import { buildPtySpawnEnv } from './pty-env.js';

const MAX_SESSIONS = 8;
const MAX_SCROLLBACK_BYTES = 512 * 1024;

/** @type {Map<string, PtySessionRecord>} */
const sessions = new Map();

/** Drop exited sessions from the registry (frees slots after shell exit or reload leaks). */
function pruneExitedPtySessions() {
  for (const [sessionId, session] of sessions) {
    if (session.exited) {
      destroyPtySession(sessionId);
    }
  }
}

/** Count sessions that still hold a live PTY process. */
function countActivePtySessions() {
  let n = 0;
  for (const session of sessions.values()) {
    if (!session.exited) n += 1;
  }
  return n;
}

/**
 * @typedef {object} PtySessionRecord
 * @property {string} sessionId
 * @property {string} shellProfileId
 * @property {string} shell
 * @property {string} cwd
 * @property {number} cols
 * @property {number} rows
 * @property {string | null} chatId
 * @property {import('@lydell/node-pty').IPty} pty
 * @property {number} scrollbackBytes
 * @property {string} scrollback
 * @property {Set<(msg: string) => void>} listeners
 * @property {boolean} exited
 * @property {number | null} exitCode
 */

function auditLog(line) {
  try {
    const dir = path.join(getMinnowHome(), 'logs', 'terminal');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'pty-sessions.log'),
      `${new Date().toISOString()} ${line}\n`,
      'utf8',
    );
  } catch {
    /* best effort */
  }
}

/**
 * @param {PtySessionRecord} session
 * @param {string} chunk
 */
function appendScrollback(session, chunk) {
  const add = Buffer.byteLength(chunk, 'utf8');
  session.scrollback += chunk;
  session.scrollbackBytes += add;
  if (session.scrollbackBytes > MAX_SCROLLBACK_BYTES) {
    const trim = session.scrollbackBytes - MAX_SCROLLBACK_BYTES;
    session.scrollback = session.scrollback.slice(trim);
    session.scrollbackBytes = MAX_SCROLLBACK_BYTES;
  }
}

/**
 * @param {PtySessionRecord} session
 * @param {string} message
 */
function broadcast(session, message) {
  for (const listener of session.listeners) {
    try {
      listener(message);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @returns {{ available: boolean; error?: string }}
 */
export function getPtyAvailability() {
  try {
    if (!pty?.spawn) {
      return { available: false, error: 'PTY module not loaded' };
    }
    return { available: true };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// On exit, free the slot so reloads do not hit the 8-session cap.
/**
 * @param {object} options
 * @param {string} [options.shellProfileId]
 * @param {string} options.cwd
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @param {string | null} [options.chatId]
 */
export async function createPtySession(options) {
  pruneExitedPtySessions();
  if (countActivePtySessions() >= MAX_SESSIONS) {
    throw new Error('Maximum PTY sessions reached (8)');
  }

  const avail = getPtyAvailability();
  if (!avail.available) {
    throw new Error(avail.error ?? 'PTY unavailable');
  }

  const terminalConfig = await readTerminalShellConfig();
  const profileId =
    options.shellProfileId ??
    resolveShellProfileId(terminalConfig, options.cwd) ??
    getDefaultShellProfileId();
  const profile = getShellProfileById(profileId);
  if (!profile) {
    throw new Error(`Unknown shell profile: ${profileId}`);
  }

  const cols = options.cols ?? 80;
  const rows = options.rows ?? 24;
  const cwd = options.cwd;
  const spawnTarget = resolvePtySpawnForProfile(profile, cwd);

  const env = buildPtySpawnEnv(process.env, {
    term: 'xterm-256color',
    workspaceRoot: cwd,
  });

  const ptyProcess = pty.spawn(spawnTarget.shell, spawnTarget.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: spawnTarget.cwd,
    env,
    encoding: 'utf8',
  });

  const sessionId = randomUUID();
  /** @type {PtySessionRecord} */
  const session = {
    sessionId,
    shellProfileId: profile.id,
    shell: profile.label,
    cwd,
    cols,
    rows,
    chatId: options.chatId ?? null,
    pty: ptyProcess,
    scrollbackBytes: 0,
    scrollback: '',
    listeners: new Set(),
    exited: false,
    exitCode: null,
  };

  ptyProcess.onData((data) => {
    appendScrollback(session, data);
    broadcast(session, formatServerMessage('output', { data }));
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode ?? 0;
    broadcast(session, formatServerMessage('exit', { code: session.exitCode }));
    auditLog(`exit sessionId=${sessionId} code=${session.exitCode}`);
    if (session.exitCode !== 0) {
      void logChildProcessDiagnostic({
        kind: 'pty-exit',
        message: `PTY session ${sessionId} exited with code ${session.exitCode}`,
        extra: { sessionId, shell: profile.id, exitCode: session.exitCode },
      });
    }
    destroyPtySession(sessionId);
  });

  sessions.set(sessionId, session);
  auditLog(
    `create sessionId=${sessionId} shell=${profile.id} cwd=${cwd} pid=${ptyProcess.pid}`,
  );

  return {
    sessionId,
    shell: profile.label,
    shellProfileId: profile.id,
    cwd,
    pid: ptyProcess.pid,
    cols,
    rows,
  };
}

/**
 * @param {string} sessionId
 * @returns {PtySessionRecord | null}
 */
export function getPtySession(sessionId) {
  return sessions.get(sessionId) ?? null;
}

/**
 * @param {string} sessionId
 * @param {(msg: string) => void} listener
 * @returns {() => void}
 */
export function subscribePtySession(sessionId, listener) {
  const session = sessions.get(sessionId);
  if (!session) return () => {};
  session.listeners.add(listener);
  return () => session.listeners.delete(listener);
}

/**
 * @param {string} sessionId
 * @param {string} data
 */
export function writePtySession(sessionId, data) {
  const session = sessions.get(sessionId);
  if (!session || session.exited) {
    throw new Error('Session not found or exited');
  }
  session.pty.write(data);
}

/**
 * @param {string} sessionId
 * @param {number} cols
 * @param {number} rows
 */
export function resizePtySession(sessionId, cols, rows) {
  const session = sessions.get(sessionId);
  if (!session || session.exited) {
    throw new Error('Session not found or exited');
  }
  session.cols = cols;
  session.rows = rows;
  session.pty.resize(cols, rows);
}

/**
 * @param {string} sessionId
 */
export function destroyPtySession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    session.pty.kill();
  } catch {
    /* already dead */
  }
  session.listeners.clear();
  sessions.delete(sessionId);
  auditLog(`kill sessionId=${sessionId}`);
  return true;
}

/** Kill every PTY (server shutdown). */
export function destroyAllPtySessions() {
  for (const id of [...sessions.keys()]) {
    destroyPtySession(id);
  }
}

/**
 * @param {{ chatId?: string }} [filter]
 */
export function listPtySessionMeta(filter = {}) {
  const list = [];
  for (const session of sessions.values()) {
    if (filter.chatId && session.chatId !== filter.chatId) continue;
    list.push({
      sessionId: session.sessionId,
      shellProfileId: session.shellProfileId,
      shell: session.shell,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      chatId: session.chatId,
      exited: session.exited,
      exitCode: session.exitCode,
    });
  }
  return list;
}
