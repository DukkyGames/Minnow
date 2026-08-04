/**
 * Managed local server process manager (install, spawn, health, logs).
 */

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readResource, writeResource } from '../config/store.js';
import { getServerDef, listServerDefs } from './catalog.js';
import { getServerLogPath, getServersRoot } from './paths.js';

/** @typedef {'pending'|'installing'|'starting'|'running'|'stopped'|'error'} ServerRuntimePhase */

/**
 * @typedef {object} ServerJob
 * @property {string} serverId
 * @property {'pending'|'installing'|'done'|'error'} phase
 * @property {number} percent
 * @property {string} message
 * @property {string | undefined} error
 */

/**
 * @typedef {object} ManagedProcessState
 * @property {import('node:child_process').ChildProcess} child
 * @property {number} port
 * @property {boolean} healthy
 * @property {ServerRuntimePhase} phase
 */

/** @type {Map<string, Promise<void>>} */
const serverLogWriteQueues = new Map();


/** @type {Map<string, ManagedProcessState>} */
const processes = new Map();

/** @type {Map<string, ServerJob>} */
const jobs = new Map();

/** In-flight background install promises (one per server id). */
/** @type {Map<string, Promise<{ ok: boolean; error?: string; alreadyInstalled?: boolean; job?: ServerJob | null }>>} */
const installPromises = new Map();

/** @type {Map<string, string[]>} */
const logRingBuffers = new Map();

const LOG_RING_MAX_LINES = 500;

/** @type {typeof spawn | null} */
let spawnOverrideForTests = null;

/** @type {typeof fetch | null} */
let fetchOverrideForTests = null;

/**
 * When set, replaces provisioner.provision during installServer (unit tests only).
 * @type {((serverId: string, onProgress?: (message: string) => void) => Promise<void>) | null}
 */
let installProvisionOverrideForTests = null;

/** Replace child_process.spawn for unit tests. */
export function setManagerSpawnOverrideForTests(fn) {
  spawnOverrideForTests = fn;
}

export function resetManagerSpawnOverrideForTests() {
  spawnOverrideForTests = null;
}

/** Replace global fetch for health-check unit tests. */
export function setManagerFetchOverrideForTests(fn) {
  fetchOverrideForTests = fn;
}

export function resetManagerFetchOverrideForTests() {
  fetchOverrideForTests = null;
}

/** Replace install provision step for unit tests. */
export function setInstallProvisionOverrideForTests(fn) {
  installProvisionOverrideForTests = fn;
}

export function resetInstallProvisionOverrideForTests() {
  installProvisionOverrideForTests = null;
}

/** Clear runtime maps and stop mocked children between tests. */
export function resetManagerStateForTests() {
  for (const [, state] of processes) {
    killServerChild(state.child);
  }
  processes.clear();
  jobs.clear();
  installPromises.clear();
  logRingBuffers.clear();
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import('node:child_process').SpawnOptions} options
 */
function spawnManaged(command, args, options) {
  if (spawnOverrideForTests) {
    return spawnOverrideForTests(command, args, options);
  }
  return spawn(command, args, options);
}

function updateJob(serverId, patch) {
  const prev = jobs.get(serverId) ?? {
    serverId,
    phase: 'pending',
    percent: 0,
    message: '',
  };
  const next = { ...prev, ...patch, serverId };
  jobs.set(serverId, next);
  return next;
}

/**
 * @param {string} serverId
 * @param {string} chunk
 */
async function appendServerLog(serverId, chunk) {
  const text = String(chunk);
  if (!text) return;

  const lines = logRingBuffers.get(serverId) ?? [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    lines.push(line);
  }
  while (lines.length > LOG_RING_MAX_LINES) {
    lines.shift();
  }
  logRingBuffers.set(serverId, lines);

  const logPath = getServerLogPath(serverId);
  const prev = serverLogWriteQueues.get(logPath) ?? Promise.resolve();
  const next = prev.then(async () => {
    await fsp.mkdir(path.dirname(logPath), { recursive: true });
    await fsp.appendFile(logPath, text, 'utf8');
  }).catch(() => {}).finally(() => {
    if (serverLogWriteQueues.get(logPath) === next) {
      serverLogWriteQueues.delete(logPath);
    }
  });
  serverLogWriteQueues.set(logPath, next);
  return next;
}

/**
 * @param {string} serverId
 * @param {number} port
 * @param {string} healthPath
 */
async function waitForHealth(serverId, port, healthPath) {
  const url = `http://127.0.0.1:${port}${healthPath}`;
  let delayMs = 250;
  const maxAttempts = 40;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const fetchImpl = fetchOverrideForTests ?? fetch;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      if (res.status === 200) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(delayMs * 1.5, 3000);
  }

  throw new Error(`Health check timed out for ${serverId} (${url})`);
}

/**
 * @param {string} serverId
 */
export function getServerJob(serverId) {
  return jobs.get(serverId) ?? null;
}

/**
 * @param {string} serverId
 */
export async function getInstallStatus(serverId) {
  const def = getServerDef(serverId);
  if (!def) {
    return { serverId, found: false, installed: false };
  }
  const status = await def.provisioner.getInstallStatus();
  const job = getServerJob(serverId);
  return {
    serverId,
    found: true,
    kind: def.kind,
    label: def.label,
    ...status,
    job,
  };
}

/**
 * List catalog entries merged with servers.json and runtime state.
 */
export async function listServers() {
  const config = await readResource('servers');
  const defs = listServerDefs();
  const out = [];

  for (const def of defs) {
    const entry = config[def.id] ?? {
      enabled: false,
      autoStart: def.defaultAutoStart,
      port: def.defaultPort,
    };
    const install = await getInstallStatus(def.id);
    const proc = processes.get(def.id);
    out.push({
      id: def.id,
      label: def.label,
      description: def.description,
      kind: def.kind,
      healthPath: def.healthPath,
      enabled: entry.enabled === true,
      autoStart: entry.autoStart === true,
      port: entry.port,
      defaultPort: def.defaultPort,
      installed: install.installed,
      version: install.version,
      running: proc?.phase === 'running' && proc?.healthy === true,
      phase: proc?.phase ?? (install.installed ? 'stopped' : 'pending'),
      job: install.job,
    });
  }

  return out;
}

/**
 * Run provision + settings for a server (updates in-memory install job).
 * @param {string} serverId
 */
async function runInstallServer(serverId) {
  const def = getServerDef(serverId);
  if (!def) throw new Error(`Unknown server: ${serverId}`);

  const config = await readResource('servers');
  const port = config[serverId]?.port ?? def.defaultPort;
  if (installProvisionOverrideForTests) {
    await installProvisionOverrideForTests(serverId, (msg) => {
      updateJob(serverId, { phase: 'installing', percent: 50, message: msg });
    });
  } else {
    await def.provisioner.provision((msg) => {
      updateJob(serverId, { phase: 'installing', percent: 50, message: msg });
    });
  }
  if (serverId === 'searxng' && def.provisioner.writeSearxngSettings) {
    await def.provisioner.writeSearxngSettings(port);
  }
  updateJob(serverId, { phase: 'done', percent: 100, message: 'Installed', error: undefined });
}

/**
 * Kick off install in the background; returns immediately with the current job.
 * @param {string} serverId
 */
export async function startInstallServer(serverId) {
  const def = getServerDef(serverId);
  if (!def) throw new Error(`Unknown server: ${serverId}`);

  const existingPromise = installPromises.get(serverId);
  if (existingPromise) {
    return { ok: true, inProgress: true, job: getServerJob(serverId) };
  }

  const status = await def.provisioner.getInstallStatus();
  if (status.installed) {
    updateJob(serverId, { phase: 'done', percent: 100, message: 'Already installed' });
    return { ok: true, alreadyInstalled: true, job: getServerJob(serverId) };
  }

  const inFlight = jobs.get(serverId);
  if (inFlight?.phase === 'installing') {
    return { ok: true, inProgress: true, job: inFlight };
  }

  updateJob(serverId, { phase: 'installing', percent: 0, message: 'Starting install' });
  const promise = runInstallServer(serverId)
    .then(() => ({ ok: true, alreadyInstalled: false, job: getServerJob(serverId) }))
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      updateJob(serverId, { phase: 'error', percent: 0, message, error: message });
      console.error(`[servers] install ${serverId} failed: ${message}`);
      return { ok: false, error: message, job: getServerJob(serverId) };
    })
    .finally(() => {
      installPromises.delete(serverId);
    });
  installPromises.set(serverId, promise);
  return { ok: true, started: true, job: getServerJob(serverId) };
}

/**
 * Await install completion (used by tests and synchronous callers).
 * @param {string} serverId
 */
export async function installServer(serverId) {
  const def = getServerDef(serverId);
  if (!def) throw new Error(`Unknown server: ${serverId}`);

  const existing = await def.provisioner.getInstallStatus();
  if (existing.installed) {
    updateJob(serverId, { phase: 'done', percent: 100, message: 'Already installed' });
    return { ok: true, alreadyInstalled: true };
  }

  const kick = await startInstallServer(serverId);
  if (kick.ok === false) {
    throw new Error(kick.error ?? 'Install failed');
  }
  if (kick.alreadyInstalled) return kick;

  const pending = installPromises.get(serverId);
  if (!pending) return kick;

  const result = await pending;
  if (result.ok === false) {
    throw new Error(result.error ?? 'Install failed');
  }
  return result;
}

/**
 * @param {string} serverId
 */
export async function startServer(serverId) {
  const def = getServerDef(serverId);
  if (!def) throw new Error(`Unknown server: ${serverId}`);

  if (def.kind === 'native-binary') {
    throw new Error(
      `"${serverId}" is a native binary runtime — serve a model from Models instead of starting here`,
    );
  }

  const install = await def.provisioner.getInstallStatus();
  if (!install.installed) {
    throw new Error(`Server "${serverId}" is not installed`);
  }

  if (processes.has(serverId)) {
    const state = processes.get(serverId);
    if (state?.healthy) return { ok: true, alreadyRunning: true };
    await stopServer(serverId);
  }

  const config = await readResource('servers');
  const port = config[serverId]?.port ?? def.defaultPort;
  const spec = await def.provisioner.getSpawnSpec(port);

  const child = spawnManaged(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });

  processes.set(serverId, {
    child,
    port,
    healthy: false,
    phase: 'starting',
  });

  child.stdout?.on('data', (chunk) => {
    void appendServerLog(serverId, chunk.toString());
  });
  child.stderr?.on('data', (chunk) => {
    void appendServerLog(serverId, chunk.toString());
  });

  child.on('exit', (code) => {
    const state = processes.get(serverId);
    if (state?.child === child) {
      processes.delete(serverId);
      void appendServerLog(serverId, `\n[exit] code=${code ?? 'null'}\n`);
    }
  });

  child.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    void appendServerLog(serverId, `\n[spawn error] ${message}\n`);
    processes.delete(serverId);
  });

  await waitForHealth(serverId, port, def.healthPath);
  const state = processes.get(serverId);
  if (state) {
    state.healthy = true;
    state.phase = 'running';
  }

  return { ok: true, port };
}

/**
 * @param {string} serverId
 */
export async function stopServer(serverId) {
  const state = processes.get(serverId);
  if (!state?.child) {
    return { ok: true, wasRunning: false };
  }

  killServerChild(state.child);
  processes.delete(serverId);
  return { ok: true, wasRunning: true };
}

/**
 * @param {import('node:child_process').ChildProcess} child
 */
function killServerChild(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } catch {
      child.kill();
    }
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/**
 * @param {string} serverId
 */
export async function restartServer(serverId) {
  await stopServer(serverId);
  return startServer(serverId);
}

/**
 * @param {string} serverId
 */
export async function uninstallServer(serverId) {
  const def = getServerDef(serverId);
  if (!def) throw new Error(`Unknown server: ${serverId}`);
  await stopServer(serverId);
  await def.provisioner.uninstall();
  jobs.delete(serverId);
  logRingBuffers.delete(serverId);
  return { ok: true };
}

/** Start installed servers that are enabled with autoStart (never auto-install). */
export async function autoStartEnabledServers() {
  const config = await readResource('servers');
  for (const def of listServerDefs()) {
    const entry = config[def.id];
    if (!entry?.enabled || !entry?.autoStart) continue;
    const install = await def.provisioner.getInstallStatus();
    if (!install.installed) continue;
    try {
      await startServer(def.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[servers] auto-start ${def.id} failed: ${message}`);
    }
  }
}

/** Provision then start enabled+autoStart servers flagged for auto-provision when not yet installed. */
export async function autoProvisionEnabledServers() {
  const config = await readResource('servers');
  for (const def of listServerDefs()) {
    if (!def.defaultAutoProvision) continue;
    const entry = config[def.id];
    if (!entry?.enabled || !entry?.autoStart) continue;
    const install = await def.provisioner.getInstallStatus();
    if (install.installed) continue;
    void (async () => {
      try {
        await installServer(def.id);
        await startServer(def.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[servers] auto-provision ${def.id} failed: ${message}`);
      }
    })();
  }
}

/** Stop every managed server process (server shutdown). */
export function shutdownAllServers() {
  for (const [, state] of processes) {
    killServerChild(state.child);
  }
  processes.clear();
}

/**
 * @param {string} serverId
 * @param {number} [tailLines]
 */
export function getServerLogs(serverId, tailLines = 200) {
  const ring = logRingBuffers.get(serverId) ?? [];
  const n = Math.max(1, Math.min(tailLines, LOG_RING_MAX_LINES));
  return ring.slice(-n);
}

/**
 * Managed SearXNG base URL when enabled and running; otherwise null.
 */
export async function getManagedSearxngUrl() {
  const config = await readResource('servers');
  const entry = config.searxng;
  if (!entry?.enabled) return null;

  const state = processes.get('searxng');
  if (!state || state.phase !== 'running' || !state.healthy) return null;

  return `http://127.0.0.1:${entry.port}`;
}

/**
 * Configured port for a managed server, falling back to its catalog default.
 * @param {string} serverId
 * @returns {Promise<number | null>}
 */
export async function getManagedServerPort(serverId) {
  const def = getServerDef(serverId);
  if (!def) return null;
  const config = await readResource('servers');
  const port = config[serverId]?.port;
  return typeof port === 'number' ? port : def.defaultPort;
}

/**
 * True when the managed process is up and passing health checks.
 *
 * Deliberately does not consult the `enabled` flag: mlx-lm is started on demand
 * by a model load rather than by the Settings toggle, so "enabled" and "running"
 * are independent for it.
 * @param {string} serverId
 */
export function isManagedServerRunning(serverId) {
  const state = processes.get(serverId);
  return state?.phase === 'running' && state?.healthy === true;
}

/**
 * @param {string} serverId
 * @param {boolean} enabled
 */
export async function setServerEnabled(serverId, enabled) {
  const def = getServerDef(serverId);
  if (!def) throw new Error(`Unknown server: ${serverId}`);
  const config = await readResource('servers');
  if (!config[serverId]) throw new Error(`Unknown server config: ${serverId}`);
  config[serverId].enabled = enabled === true;
  await writeResource('servers', config);
  if (!enabled) await stopServer(serverId);
  return config[serverId];
}

/**
 * @param {string} serverId
 * @param {boolean} autoStart
 */
export async function setServerAutoStart(serverId, autoStart) {
  const def = getServerDef(serverId);
  if (!def) throw new Error(`Unknown server: ${serverId}`);
  const config = await readResource('servers');
  if (!config[serverId]) throw new Error(`Unknown server config: ${serverId}`);
  config[serverId].autoStart = autoStart === true;
  await writeResource('servers', config);
  return config[serverId];
}

/**
 * @param {string} serverId
 * @param {number} port
 */
export async function setServerPort(serverId, port) {
  const def = getServerDef(serverId);
  if (!def) throw new Error(`Unknown server: ${serverId}`);
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1024 || n > 65_535) {
    throw new Error('Port must be an integer between 1024 and 65535');
  }
  const config = await readResource('servers');
  if (!config[serverId]) throw new Error(`Unknown server config: ${serverId}`);
  config[serverId].port = n;
  await writeResource('servers', config);
  if (serverId === 'searxng') {
    const { writeSearxngSettings } = await import('./searxng.js');
    await writeSearxngSettings(n);
  }
  const running = processes.get(serverId);
  if (running) {
    await restartServer(serverId);
  }
  return config[serverId];
}

/** Ensure managed server directories exist under ~/.minnow. */
export async function ensureServersLayout() {
  await fsp.mkdir(getServersRoot(), { recursive: true });
  await fsp.mkdir(path.dirname(getServerLogPath('_')), { recursive: true });
}
