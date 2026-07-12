/**
 * Workspace dev-server lifecycle (startup.md → detached process).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readConfigJson, writeConfigJson } from '../config/store.js';
import { mergeConfigMeta } from '../config/validators.js';
import { COMMAND_TIMEOUT_MS, runProcess } from '../process-runner.js';
import {
  cancelRun,
  createBackgroundRun,
  getRun,
  killProcessTree,
  stopActiveRun,
} from '../terminal-runner.js';
import { resolveSafePath } from '../runtime/path-access.js';
import { getWorkspaceRoot, normalizeWorkspacePathKey } from '../workspace/root.js';
import { parseStartupMarkdown, startupFilePath } from './parse-startup.js';
import {
  buildDevServerSpawnEnv,
  resolveEffectiveGuide,
} from './effective-guide.js';
import { readDevServerSettings } from './settings.js';
import { assessHostKillCommand } from '../tools/host-kill-guard.js';
import { assessHostPortBindCommand } from '../tools/host-port-bind-guard.js';

/** @typedef {'no_guide' | 'stopped' | 'starting' | 'running' | 'stopping' | 'error'} DevServerStatus */

/**
 * @typedef {object} ManagedDevServer
 * @property {string} workspaceKey
 * @property {string} workspaceRoot
 * @property {DevServerStatus} status
 * @property {string} [runId]
 * @property {number | null} [pid]
 * @property {string} [command]
 * @property {string} [healthUrl]
 * @property {number} [port]
 * @property {string} [error]
 * @property {number} [startedAt]
 */

/** @type {Map<string, ManagedDevServer>} */
const byWorkspaceKey = new Map();

const HEALTH_TIMEOUT_MS = 4_000;
/** Max time to wait in `starting` before promoting to error when health never passes. */
const STARTING_TIMEOUT_MS = 120_000;

/**
 * @param {string} workspaceRoot
 */
function workspaceKey(workspaceRoot) {
  return normalizeWorkspacePathKey(path.resolve(workspaceRoot));
}

/**
 * @param {string} key
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readPersistedRecord(key) {
  const meta = (await readConfigJson('config.json')) ?? {};
  const ws =
    meta.workspace && typeof meta.workspace === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.workspace)
      : null;
  const byPath =
    ws?.devServerByPath && typeof ws.devServerByPath === 'object'
      ? /** @type {Record<string, unknown>} */ (ws.devServerByPath)
      : null;
  const row = byPath?.[key];
  return row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : null;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} record
 */
async function persistRecord(key, record) {
  const meta = (await readConfigJson('config.json')) ?? {};
  const existingWs =
    meta.workspace && typeof meta.workspace === 'object'
      ? { .../** @type {Record<string, unknown>} */ (meta.workspace) }
      : {};
  const byPath =
    existingWs.devServerByPath && typeof existingWs.devServerByPath === 'object'
      ? { .../** @type {Record<string, unknown>} */ (existingWs.devServerByPath) }
      : {};
  byPath[key] = record;
  existingWs.devServerByPath = byPath;
  const merged = mergeConfigMeta(meta, { workspace: existingWs });
  if (merged.workspace && typeof merged.workspace === 'object') {
    /** @type {Record<string, unknown>} */ (merged.workspace).devServerByPath = byPath;
  }
  await writeConfigJson('config.json', merged);
}

/**
 * @param {ManagedDevServer} row
 */
async function saveState(row) {
  byWorkspaceKey.set(row.workspaceKey, row);
  await persistRecord(row.workspaceKey, {
    status: row.status,
    runId: row.runId ?? null,
    pid: row.pid ?? null,
    command: row.command ?? null,
    healthUrl: row.healthUrl ?? null,
    port: row.port ?? null,
    error: row.error ?? null,
    startedAt: row.startedAt ?? null,
  });
}

/**
 * @param {string} root
 * @returns {Promise<ManagedDevServer>}
 */
async function getOrInitRow(root) {
  const key = workspaceKey(root);
  const existing = byWorkspaceKey.get(key);
  if (existing) return existing;

  const persisted = await readPersistedRecord(key);
  /** @type {ManagedDevServer} */
  const row = {
    workspaceKey: key,
    workspaceRoot: path.resolve(root),
    status: 'stopped',
    runId: typeof persisted?.runId === 'string' ? persisted.runId : undefined,
    pid: typeof persisted?.pid === 'number' ? persisted.pid : null,
    command: typeof persisted?.command === 'string' ? persisted.command : undefined,
    healthUrl: typeof persisted?.healthUrl === 'string' ? persisted.healthUrl : undefined,
    port: typeof persisted?.port === 'number' ? persisted.port : undefined,
    error: typeof persisted?.error === 'string' ? persisted.error : undefined,
    startedAt: typeof persisted?.startedAt === 'number' ? persisted.startedAt : undefined,
  };

  if (persisted?.status === 'running' || persisted?.status === 'starting') {
    row.status = /** @type {DevServerStatus} */ (persisted.status);
  }

  byWorkspaceKey.set(key, row);
  return row;
}

/**
 * Reconcile stale PID / finished runs.
 * @param {ManagedDevServer} row
 */
async function reconcileRow(row) {
  if (!row.runId) {
    if (row.status === 'running' || row.status === 'starting') {
      row.status = 'stopped';
      row.error = undefined;
      await saveState(row);
    }
    return row;
  }

  const run = getRun(row.runId);
  if (run?.finished) {
    row.status = 'stopped';
    row.runId = undefined;
    row.pid = null;
    row.error = undefined;
    await saveState(row);
    return row;
  }

  if (!run && row.status !== 'stopping') {
    // Background spawn can lag before the terminal registry sees the child (esp. Windows).
    if (row.startedAt && Date.now() - row.startedAt < 2_000) {
      return row;
    }
    row.status = 'stopped';
    row.runId = undefined;
    row.pid = null;
    await saveState(row);
  }

  return row;
}

/**
 * @param {string} [healthUrl]
 * @returns {Promise<boolean>}
 */
async function probeHealth(healthUrl) {
  if (!healthUrl || typeof healthUrl !== 'string') return true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Apply a successful background run to the managed dev-server row.
 * @param {ManagedDevServer} row
 * @param {{ runId: string, pid: number, startedAt: number }} started
 * @param {{ command: string, healthUrl?: string, port?: number }} guide
 */
async function applyStartedRun(row, started, guide) {
  row.runId = started.runId;
  row.pid = started.pid;
  row.startedAt = started.startedAt;
  row.command = guide.command;
  row.healthUrl = guide.healthUrl;
  row.port = guide.port;
  row.error = undefined;

  if (guide.healthUrl) {
    const ok = await probeHealth(guide.healthUrl);
    row.status = ok ? 'running' : 'starting';
  } else {
    row.status = 'running';
  }

  await saveState(row);
}

/**
 * Whether a background tool invocation should register as the managed dev server.
 * @param {Record<string, unknown>} args
 * @param {{ command: string }} guide
 */
function shouldRegisterDevServerFromTool(args, guide) {
  if (args?.register_dev_server === true) return true;
  const command = typeof args?.command === 'string' ? args.command.trim() : '';
  return command.length > 0 && command === guide.command.trim();
}

/**
 * @param {string} [workspaceRoot]
 */
export async function readStartupGuide(workspaceRoot = getWorkspaceRoot()) {
  const filePath = startupFilePath(workspaceRoot);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = parseStartupMarkdown(content);
    return {
      exists: true,
      path: filePath,
      guide: parsed.guide,
      parseError: parsed.error,
      body: parsed.body,
    };
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
    if (code === 'ENOENT') {
      return { exists: false, path: filePath, guide: null, parseError: undefined, body: '' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { exists: false, path: filePath, guide: null, parseError: message, body: '' };
  }
}

/**
 * @param {string} [workspaceRoot]
 */
export async function getDevServerStatus(workspaceRoot = getWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const startup = await readStartupGuide(root);
  const settings = await readDevServerSettings(root);
  const effective =
    startup.guide != null
      ? resolveEffectiveGuide(startup.guide, settings)
      : null;
  let row = await getOrInitRow(root);
  row = await reconcileRow(row);

  let healthOk = null;
  const healthUrl = row.healthUrl ?? effective?.healthUrl ?? startup.guide?.healthUrl;
  if ((row.status === 'running' || row.status === 'starting') && healthUrl) {
    healthOk = await probeHealth(healthUrl);
    if (row.status === 'starting' && healthOk) {
      const run = row.runId ? getRun(row.runId) : null;
      if (run && !run.finished) {
        row.status = 'running';
        await saveState(row);
      }
    } else if (
      row.status === 'starting' &&
      healthOk === false &&
      row.startedAt &&
      Date.now() - row.startedAt > STARTING_TIMEOUT_MS
    ) {
      if (row.runId) {
        const run = getRun(row.runId);
        if (run?.child && !run.finished) {
          killProcessTree(run.child);
        } else {
          cancelRun(row.runId);
        }
      }
      row.status = 'error';
      row.error = 'Health check timed out';
      row.runId = undefined;
      row.pid = null;
      await saveState(row);
    }
  }

  return {
    workspacePath: root,
    startupExists: startup.exists,
    guide: startup.guide,
    effectiveGuide: effective,
    settings,
    parseError: startup.parseError,
    status: startup.exists && startup.guide ? row.status : 'no_guide',
    runId: row.runId ?? null,
    pid: row.pid ?? null,
    port: row.port ?? effective?.port ?? startup.guide?.port ?? null,
    network: effective?.network ?? settings.network ?? null,
    healthUrl: row.healthUrl ?? effective?.healthUrl ?? startup.guide?.healthUrl ?? null,
    healthOk,
    error: row.error ?? startup.parseError ?? null,
    command: row.command ?? effective?.command ?? startup.guide?.command ?? null,
    startedAt: row.startedAt ?? null,
  };
}

/**
 * @param {string} [workspaceRoot]
 */
export async function startDevServer(workspaceRoot = getWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const startup = await readStartupGuide(root);
  if (!startup.exists) {
    return { ok: false, error: 'startup.md not found in workspace root' };
  }
  if (!startup.guide) {
    return { ok: false, error: startup.parseError ?? 'Invalid startup.md' };
  }

  const settings = await readDevServerSettings(root);
  const effective = resolveEffectiveGuide(startup.guide, settings);

  let row = await getOrInitRow(root);
  row = await reconcileRow(row);

  if (row.status === 'running' && row.runId && getRun(row.runId) && !getRun(row.runId)?.finished) {
    return { ok: true, status: row.status, runId: row.runId, alreadyRunning: true };
  }

  const cwdRel = effective.cwd ?? '.';
  const cwd = resolveSafePath(cwdRel, { write: false });

  row.status = 'starting';
  row.command = effective.command;
  row.healthUrl = effective.healthUrl;
  row.port = effective.port;
  row.error = undefined;
  await saveState(row);

  try {
    const started = await createBackgroundRun({
      command: effective.command,
      cwd,
      shell: process.platform === 'win32',
      source: 'agent',
      logSubdir: 'dev-server',
      env: buildDevServerSpawnEnv(effective.port, effective.network),
    });

    await applyStartedRun(row, started, effective);
    return {
      ok: true,
      status: row.status,
      runId: row.runId,
      pid: row.pid,
      alreadyRunning: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    row.status = 'error';
    row.error = message;
    row.runId = undefined;
    row.pid = null;
    await saveState(row);
    return { ok: false, error: message };
  }
}

/**
 * @param {string} [workspaceRoot]
 */
export async function stopDevServer(workspaceRoot = getWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const startup = await readStartupGuide(root);
  let row = await getOrInitRow(root);

  if (!row.runId && row.status !== 'running' && row.status !== 'starting') {
    row.status = startup.exists && startup.guide ? 'stopped' : 'no_guide';
    await saveState(row);
    return { ok: true, status: row.status };
  }

  row.status = 'stopping';
  await saveState(row);

  const stopCmd = startup.guide?.stop?.command;
  if (stopCmd) {
    try {
      const cwd = resolveSafePath(startup.guide?.cwd ?? '.', { write: false });
      await runProcess(
        process.platform === 'win32' ? 'cmd.exe' : 'sh',
        process.platform === 'win32'
          ? ['/d', '/s', '/c', stopCmd]
          : ['-c', stopCmd],
        { cwd, timeout: COMMAND_TIMEOUT_MS, shell: false },
      );
    } catch {
      /* fall through to PID kill */
    }
  }

  if (row.runId) {
    const run = getRun(row.runId);
    if (run?.child && !run.finished) {
      killProcessTree(run.child);
    } else {
      cancelRun(row.runId);
    }
  }

  row.status = startup.exists && startup.guide ? 'stopped' : 'no_guide';
  row.runId = undefined;
  row.pid = null;
  row.error = undefined;
  await saveState(row);

  return { ok: true, status: row.status };
}

/**
 * Server tool: start_background_command
 * @param {Record<string, unknown>} args
 */
export async function toolStartBackgroundCommand(args) {
  const command = typeof args?.command === 'string' ? args.command.trim() : '';
  if (!command) return 'Error: command is required';

  const hostKill = assessHostKillCommand(command);
  if (hostKill) return hostKill;
  const portBind = assessHostPortBindCommand(command);
  if (portBind) return portBind;

  const cwdUser = typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : '.';
  let cwd;
  try {
    cwd = resolveSafePath(cwdUser, { write: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }

  try {
    const chatId = typeof args?.chatId === 'string' ? args.chatId : undefined;
    let spawnEnv;
    try {
      const { resolveBoardTaskSpawnEnvForCommand } = await import(
        '../workspace/board-task-ports.js'
      );
      spawnEnv = await resolveBoardTaskSpawnEnvForCommand({ chatId, cwd });
    } catch {
      spawnEnv = undefined;
    }

    const started = await createBackgroundRun({
      command,
      cwd,
      shell: process.platform === 'win32',
      source: 'agent',
      chatId,
      logSubdir: 'dev-server',
      ...(spawnEnv ? { env: spawnEnv } : {}),
    });

    const root = path.resolve(getWorkspaceRoot());
    const startup = await readStartupGuide(root);
    if (startup.guide && shouldRegisterDevServerFromTool(args, startup.guide)) {
      const settings = await readDevServerSettings(root);
      const effective = resolveEffectiveGuide(startup.guide, settings);
      const row = await getOrInitRow(root);
      row.command = effective.command;
      row.healthUrl = effective.healthUrl;
      row.port = effective.port;
      await applyStartedRun(row, started, effective);
    }

    return JSON.stringify(
      {
        ok: true,
        runId: started.runId,
        pid: started.pid,
        logPath: started.logPath,
        startedAt: started.startedAt,
      },
      null,
      2,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

/**
 * Server tool: stop_background_command
 * @param {Record<string, unknown>} args
 */
export async function toolStopBackgroundCommand(args) {
  const runId = typeof args?.run_id === 'string' ? args.run_id.trim() : '';
  if (!runId) return 'Error: run_id is required';

  const stopped = stopActiveRun(runId);
  if (!stopped.ok) {
    return `Error: ${stopped.error}`;
  }

  const key = workspaceKey(getWorkspaceRoot());
  const row = byWorkspaceKey.get(key);
  if (row?.runId === runId) {
    row.status = 'stopped';
    row.runId = undefined;
    row.pid = null;
    await saveState(row);
  }

  return JSON.stringify(
    { ok: true, runId, ...(stopped.alreadyStopped ? { alreadyStopped: true } : {}) },
    null,
    2,
  );
}

/** Server tool: stop_command — any active agent terminal run. */
export async function toolStopCommand(args) {
  const runId = typeof args?.run_id === 'string' ? args.run_id.trim() : '';
  if (!runId) return 'Error: run_id is required';

  const stopped = stopActiveRun(runId);
  if (!stopped.ok) {
    return `Error: ${stopped.error}`;
  }

  const key = workspaceKey(getWorkspaceRoot());
  const row = byWorkspaceKey.get(key);
  if (row?.runId === runId) {
    row.status = 'stopped';
    row.runId = undefined;
    row.pid = null;
    await saveState(row);
  }

  return JSON.stringify(
    { ok: true, runId, ...(stopped.alreadyStopped ? { alreadyStopped: true } : {}) },
    null,
    2,
  );
}

/** Clear in-memory dev-server rows between tests (does not touch persisted config). */
export function resetDevServerManagerForTests() {
  byWorkspaceKey.clear();
}
