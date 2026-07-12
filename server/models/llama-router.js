/**
 * Singleton llama-server router process manager.
 * Spawns one persistent router instead of per-model llama-server instances.
 */

import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  createBackgroundRun,
  getRun,
  stopActiveRun,
  subscribeRun,
} from '../terminal-runner.js';
import { detectHardware } from '../system/hardware.js';
import {
  buildLlamaRouterArgs,
  buildLlamaServerSpawnEnv,
  probeLlamaRouterSupport,
  readLlamaCppConfig,
} from './llama-args.js';
import { writeLlamaPresetIni } from './llama-preset.js';
import {
  buildLlamaServerEnv,
  llamaServerSpawnCwd,
  resolveLlamaServer,
} from './llama-runtime.js';
import { getArtifactsDir, getLlamaPresetIniPath, getRouterStatePath, modelsLogDir } from './paths.js';
import { presetSectionNameFromFilename } from './llama-preset.js';
import { validatePort } from './validate.js';

/** llama-server router management endpoints (not OpenAI /v1/*). */
export const ROUTER_MODELS_LOAD_PATH = '/models/load';
export const ROUTER_MODELS_UNLOAD_PATH = '/models/unload';

/** @typedef {'starting' | 'running' | 'stopped' | 'error'} RouterStatusPhase */

/**
 * @typedef {object} RouterStatus
 * @property {RouterStatusPhase} status
 * @property {number} port
 * @property {string} baseUrl
 * @property {string | null} runId
 * @property {number | null} pid
 * @property {number | null} startedAt
 * @property {number} modelsMax
 * @property {boolean} routerSupported
 * @property {string | null} [error]
 * @property {string | null} [logTail]
 */

/** @type {RouterStatus | null} */
let memoryState = null;

/** Prevent concurrent startRouter calls. */
/** @type {Promise<RouterStatus> | null} */
let startPromise = null;

/** Crash-restart attempt counter for the current boot cycle. */
let crashRestartAttempts = 0;

const MAX_CRASH_RESTARTS = 3;
const LOG_TAIL_BYTES = 4_096;

/** Test overrides — avoid spawning real llama-server in unit tests. */
/** @type {typeof createBackgroundRun | null} */
let createBackgroundRunOverrideForTests = null;
/** @type {((baseUrl: string) => Promise<boolean>) | null} */
let waitForHealthOverrideForTests = null;

export function setRouterBackgroundRunOverrideForTests(fn) {
  createBackgroundRunOverrideForTests = fn;
}

export function resetRouterBackgroundRunOverrideForTests() {
  createBackgroundRunOverrideForTests = null;
}

export function setRouterHealthOverrideForTests(fn) {
  waitForHealthOverrideForTests = fn;
}

export function resetRouterHealthOverrideForTests() {
  waitForHealthOverrideForTests = null;
}

/**
 * @param {number} pid
 */
function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {number} preferred
 */
async function pickFreePort(preferred = 8085) {
  const tryPort = (port) =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        const address = server.address();
        const chosen = typeof address === 'object' && address ? address.port : port;
        server.close(() => resolve(chosen));
      });
    });

  try {
    return await tryPort(preferred);
  } catch {
    return tryPort(0);
  }
}

/**
 * VRAM heuristic for --models-max when config does not override.
 * @param {Record<string, unknown>} hardware
 */
export function computeModelsMaxFromVram(hardware) {
  const vram = Number(hardware.gpuVramGb ?? hardware.gpu_vram_gb ?? 0);
  if (vram > 0 && vram < 12) return 1;
  if (vram >= 12 && vram < 24) return 2;
  if (vram >= 24) return 3;
  return 1;
}

/**
 * @returns {Promise<{ port: number, modelsMax: number }>}
 */
async function resolveRouterConfig() {
  const config = await readLlamaCppConfig();
  const router =
    config.router && typeof config.router === 'object' ? config.router : {};
  const port =
    typeof router.port === 'number' && router.port > 0
      ? validatePort(router.port)
      : 8085;
  let modelsMax =
    typeof router.modelsMax === 'number' && router.modelsMax >= 0
      ? router.modelsMax
      : null;
  if (modelsMax == null) {
    const hardware = await detectHardware();
    modelsMax = computeModelsMaxFromVram(hardware);
  }
  return { port: /** @type {number} */ (port), modelsMax };
}

/**
 * @param {Partial<RouterStatus>} patch
 */
async function persistRouterState(patch) {
  const prev = memoryState ?? {
    status: 'stopped',
    port: 8085,
    baseUrl: 'http://127.0.0.1:8085',
    runId: null,
    pid: null,
    startedAt: null,
    modelsMax: 1,
    routerSupported: false,
    error: null,
    logTail: null,
  };
  memoryState = {
    ...prev,
    ...patch,
    baseUrl: `http://127.0.0.1:${patch.port ?? prev.port}`,
  };
  await fsp.mkdir(path.dirname(getRouterStatePath()), { recursive: true });
  await fsp.writeFile(
    getRouterStatePath(),
    `${JSON.stringify(
      {
        version: 1,
        port: memoryState.port,
        pid: memoryState.pid,
        runId: memoryState.runId,
        startedAt: memoryState.startedAt,
        status: memoryState.status,
        modelsMax: memoryState.modelsMax,
        error: memoryState.error ?? null,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return memoryState;
}

async function loadRouterStateFromDisk() {
  try {
    const raw = await fsp.readFile(getRouterStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const port = typeof parsed.port === 'number' ? parsed.port : 8085;
    memoryState = {
      status: parsed.status === 'running' ? 'running' : 'stopped',
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      runId: typeof parsed.runId === 'string' ? parsed.runId : null,
      pid: typeof parsed.pid === 'number' ? parsed.pid : null,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : null,
      modelsMax: typeof parsed.modelsMax === 'number' ? parsed.modelsMax : 1,
      routerSupported: true,
      error: typeof parsed.error === 'string' ? parsed.error : null,
      logTail: null,
    };
  } catch {
    /* no persisted state */
  }
}

/**
 * @param {string | null | undefined} runId
 */
async function readLogTail(runId) {
  if (!runId) return null;
  const logPath = path.join(modelsLogDir(), `${runId}.log`);
  try {
    const buf = await fsp.readFile(logPath);
    if (buf.length <= LOG_TAIL_BYTES) return buf.toString('utf8');
    return buf.subarray(buf.length - LOG_TAIL_BYTES).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * @param {string} baseUrl
 */
async function waitForRouterHealth(baseUrl, timeoutMs = 60_000) {
  if (waitForHealthOverrideForTests) {
    return waitForHealthOverrideForTests(baseUrl);
  }
  const deadline = Date.now() + timeoutMs;
  const urls = [`${baseUrl}/health`, `${baseUrl}/v1/models`];
  while (Date.now() < deadline) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2_500) });
        if (res.ok) return true;
      } catch {
        /* retry */
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

/**
 * @param {string} runId
 */
function attachCrashRestartListener(runId) {
  const unsubscribe = subscribeRun(runId, (event) => {
    if (event.type !== 'exit') return;
    unsubscribe();
    const run = getRun(runId);
    if (run?.stoppedByUser) return;
    if (crashRestartAttempts >= MAX_CRASH_RESTARTS) {
      void (async () => {
        const logTail = await readLogTail(runId);
        await persistRouterState({
          status: 'error',
          error: 'llama-server router exited unexpectedly',
          logTail,
        });
      })();
      return;
    }
    crashRestartAttempts += 1;
    const backoffMs = Math.min(1_000 * 2 ** (crashRestartAttempts - 1), 8_000);
    setTimeout(() => {
      startPromise = null;
      void startRouter().catch(() => {
        /* surfaced via router status */
      });
    }, backoffMs);
  });
}

/**
 * @returns {Promise<RouterStatus>}
 */
export async function getRouterStatus() {
  await loadRouterStateFromDisk();
  const resolved = await resolveLlamaServer();
  const routerSupported = await probeLlamaRouterSupport(resolved.path ?? '');
  if (!memoryState) {
    const { port, modelsMax } = await resolveRouterConfig();
    return {
      status: 'stopped',
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      runId: null,
      pid: null,
      startedAt: null,
      modelsMax,
      routerSupported,
      error: null,
      logTail: null,
    };
  }
  return {
    ...memoryState,
    routerSupported,
  };
}

/**
 * Start the singleton llama-server router process.
 * @returns {Promise<RouterStatus>}
 */
export async function startRouter() {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const llamaServerPath = (await resolveLlamaServer()).path;
    if (!llamaServerPath) {
      throw new Error(
        'llama-server is not installed — install from Models or Settings → Servers before serving',
      );
    }

    const routerSupported = await probeLlamaRouterSupport(llamaServerPath);
    if (!routerSupported) {
      throw new Error('Installed llama-server does not support router mode');
    }

    const { port: preferredPort, modelsMax } = await resolveRouterConfig();
    const port = await pickFreePort(preferredPort);
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeLlamaPresetIni();
    const presetPath = path.resolve(getLlamaPresetIniPath());
    const modelsDir = getArtifactsDir();

    const args = buildLlamaRouterArgs({
      port,
      modelsDir,
      presetPath,
      modelsMax,
    });

    await persistRouterState({
      status: 'starting',
      port,
      baseUrl,
      runId: null,
      pid: null,
      startedAt: Date.now(),
      modelsMax,
      routerSupported: true,
      error: null,
      logTail: null,
    });

    await fsp.mkdir(modelsLogDir(), { recursive: true });
    const config = await readLlamaCppConfig();
    const defaults =
      config.defaults && typeof config.defaults === 'object' ? config.defaults : {};
    const spawnEnv = buildLlamaServerSpawnEnv(
      llamaServerPath,
      defaults,
      process.env,
      buildLlamaServerEnv,
    );

    const createRun = createBackgroundRunOverrideForTests ?? createBackgroundRun;
    const run = await createRun({
      command: llamaServerPath,
      args,
      cwd: llamaServerSpawnCwd(llamaServerPath),
      env: spawnEnv,
      source: 'agent',
      logSubdir: 'models',
    });

    await persistRouterState({
      runId: run.runId,
      pid: run.pid,
    });

    attachCrashRestartListener(run.runId);

    const healthy = await waitForRouterHealth(baseUrl);
    if (!healthy) {
      stopActiveRun(run.runId);
      const logTail = await readLogTail(run.runId);
      await persistRouterState({
        status: 'error',
        error: 'llama-server router did not become healthy in time',
        logTail,
      });
      throw new Error('llama-server router did not become healthy in time');
    }

    crashRestartAttempts = 0;
    await persistRouterState({ status: 'running', error: null, logTail: null });

    // Keep llama-cpp-local provider in sync with router baseUrl and load/unload paths.
    const { upsertLlamaCppProvider } = await import('./serve.js');
    await upsertLlamaCppProvider({
      baseUrl,
      enabled: true,
      supportsModelLoadUnload: true,
      modelsLoadPath: ROUTER_MODELS_LOAD_PATH,
      modelsUnloadPath: ROUTER_MODELS_UNLOAD_PATH,
    });

    return /** @type {RouterStatus} */ (memoryState);
  })();

  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

/**
 * Stop the router process when running.
 * @returns {Promise<RouterStatus>}
 */
export async function stopRouter() {
  await loadRouterStateFromDisk();
  if (memoryState?.runId) {
    stopActiveRun(memoryState.runId);
  }
  await persistRouterState({
    status: 'stopped',
    runId: null,
    pid: null,
    startedAt: null,
    error: null,
    logTail: null,
  });
  return getRouterStatus();
}

/**
 * Restart the router (stop then start).
 * @returns {Promise<RouterStatus>}
 */
export async function restartRouter() {
  await stopRouter();
  return startRouter();
}

/**
 * Ensure the router is running and healthy; start if needed.
 * @returns {Promise<RouterStatus>}
 */
export async function ensureRouter() {
  const status = await getRouterStatus();
  if (!status.routerSupported) {
    throw new Error('Installed llama-server does not support router mode');
  }
  if (status.status === 'running' && status.pid && isPidAlive(status.pid)) {
    const healthy = await waitForRouterHealth(status.baseUrl, 5_000);
    if (healthy) return status;
  }
  return startRouter();
}

/**
 * Regenerate preset INI and ask a running router to reload it.
 * @param {string} baseUrl
 */
async function syncRouterPreset(baseUrl) {
  await writeLlamaPresetIni();
  try {
    await fetch(`${baseUrl}/models/reload`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    /* /models/reload is optional on older router builds */
  }
}

/**
 * Resolve a user-facing model name to the router catalog id.
 * @param {string} baseUrl
 * @param {string} candidate
 */
async function resolveRouterModelId(baseUrl, candidate) {
  const trimmed = candidate.trim();
  if (!trimmed) return trimmed;

  try {
    const res = await fetch(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return trimmed;
    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : [];
    const ids = rows.map((row) => row?.id).filter((id) => typeof id === 'string');
    if (ids.includes(trimmed)) return trimmed;

    const withGguf = trimmed.toLowerCase().endsWith('.gguf') ? trimmed : `${trimmed}.gguf`;
    if (ids.includes(withGguf)) return withGguf;

    const sectionKey = presetSectionNameFromFilename(path.basename(trimmed));
    if (ids.includes(sectionKey)) return sectionKey;

    const baseKey = presetSectionNameFromFilename(path.basename(withGguf));
    const fuzzy = ids.find(
      (id) => presetSectionNameFromFilename(id) === baseKey || id === baseKey,
    );
    return fuzzy ?? sectionKey;
  } catch {
    return presetSectionNameFromFilename(path.basename(trimmed));
  }
}

/**
 * Proxy load request to the running router.
 * @param {string} model
 */
export async function loadModelOnRouter(model) {
  const status = await ensureRouter();
  await syncRouterPreset(status.baseUrl);
  const modelId = await resolveRouterModelId(status.baseUrl, model);
  const res = await fetch(`${status.baseUrl}${ROUTER_MODELS_LOAD_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model: modelId }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Router load HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Proxy unload request to the running router.
 * @param {string} model
 */
export async function unloadModelFromRouter(model) {
  const status = await ensureRouter();
  const modelId = await resolveRouterModelId(status.baseUrl, model);
  const res = await fetch(`${status.baseUrl}${ROUTER_MODELS_UNLOAD_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model: modelId }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Router unload HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Fetch router catalog + load state from GET /models (falls back to /v1/models).
 */
export async function fetchRouterLoadedModels() {
  const status = await getRouterStatus();
  if (status.status !== 'running') return null;
  try {
    const res = await fetch(`${status.baseUrl}/models`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) return res.json();
  } catch {
    /* try OpenAI-compatible list */
  }
  try {
    const res = await fetch(`${status.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Mark stale running state stopped; clear dead PIDs on boot.
 */
export async function reconcileRouterOnBoot() {
  await loadRouterStateFromDisk();
  if (!memoryState) return;
  if (memoryState.status !== 'running' && memoryState.status !== 'starting') {
    return;
  }
  const alive = memoryState.pid ? isPidAlive(memoryState.pid) : false;
  if (!alive) {
    if (memoryState.pid) {
      try {
        process.kill(memoryState.pid, 'SIGTERM');
      } catch {
        /* already dead */
      }
    }
    await persistRouterState({
      status: 'stopped',
      runId: null,
      pid: null,
      error: null,
    });
  }
}

/** Test helper — reset in-memory router state. */
export async function resetRouterForTests() {
  memoryState = null;
  startPromise = null;
  crashRestartAttempts = 0;
  resetRouterBackgroundRunOverrideForTests();
  resetRouterHealthOverrideForTests();
  try {
    await fsp.rm(getRouterStatePath(), { force: true });
  } catch {
    /* ignore */
  }
}
