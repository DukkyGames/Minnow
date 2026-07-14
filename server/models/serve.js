/**
 * Local model serve lifecycle — llama.cpp server + provider registration.
 */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  stopActiveRun,
} from '../terminal-runner.js';
import {
  createProvider,
  LLAMA_CPP_LOCAL_ID,
  listProviders,
  setActiveProviderId,
  updateProvider,
} from '../providers/store.js';
import { mapLlamaError } from './llama-errors.js';
import { probeLlamaRouterSupport } from './llama-args.js';
import {
  ensureRouter,
  loadModelOnRouter,
  ROUTER_MODELS_LOAD_PATH,
  ROUTER_MODELS_UNLOAD_PATH,
} from './llama-router.js';
import { writeLlamaPresetIni, presetSectionNameFromFilename } from './llama-preset.js';
import { getServesIndexPath } from './paths.js';
import { validateRuntime, validateServeId } from './validate.js';
import { resolveLlamaServer } from './llama-runtime.js';

/** @typedef {'starting' | 'running' | 'stopped' | 'error'} ServeStatus */

/**
 * @typedef {object} ServeRecord
 * @property {string} id
 * @property {string} runtime
 * @property {string} modelPath
 * @property {string} modelLabel
 * @property {number} port
 * @property {string} baseUrl
 * @property {string} providerId
 * @property {ServeStatus} status
 * @property {string} [runId]
 * @property {number | null} [pid]
 * @property {string} [error]
 * @property {number} startedAt
 * @property {number} [stoppedAt]
 * @property {Record<string, unknown>} [llamaSettings]
 */

/** @type {ServeRecord[]} */
let servesCache = [];
let loaded = false;

/** Test overrides retained for compatibility with older suites. */
export function setServeBackgroundRunOverrideForTests(_fn) {}

export function resetServeBackgroundRunOverrideForTests() {}

export function setServeHealthOverrideForTests(_fn) {}

export function resetServeHealthOverrideForTests() {}

async function loadServes() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fsp.readFile(getServesIndexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    servesCache = Array.isArray(parsed.serves) ? parsed.serves : [];
  } catch {
    servesCache = [];
  }
}

/**
 * Mark stale running serves stopped when the child PID is no longer alive.
 */
export async function reconcileServesOnBoot() {
  await loadServes();
  let changed = false;
  for (const row of servesCache) {
    if (row.status !== 'running' && row.status !== 'starting') continue;
    if (row.runtime === 'ollama' || row.runtime === 'lm-studio') {
      row.status = 'stopped';
      row.stoppedAt = Date.now();
      changed = true;
      continue;
    }
    const pid = row.pid;
    if (!pid) {
      row.status = 'stopped';
      row.stoppedAt = Date.now();
      changed = true;
      continue;
    }
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (!alive) {
      row.status = 'stopped';
      row.stoppedAt = Date.now();
      changed = true;
    }
  }
  if (changed) await saveServes();
}

async function saveServes() {
  await fsp.mkdir(path.dirname(getServesIndexPath()), { recursive: true });
  await fsp.writeFile(
    getServesIndexPath(),
    `${JSON.stringify({ version: 1, serves: servesCache }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * @param {ServeRecord} row
 */
function publicServe(row) {
  return {
    id: row.id,
    runtime: row.runtime,
    modelPath: row.modelPath,
    modelLabel: row.modelLabel,
    port: row.port,
    baseUrl: row.baseUrl,
    providerId: row.providerId,
    status: row.status,
    runId: row.runId ?? null,
    pid: row.pid ?? null,
    error: row.error ?? null,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt ?? null,
    llamaSettings: row.llamaSettings ?? null,
  };
}

/**
 * @param {string} modelPath
 */
function labelFromPath(modelPath) {
  return path.basename(modelPath).replace(/\.gguf$/i, '');
}

/**
 * Stop prior llama-cpp serve records (legacy per-model spawns only).
 * @param {boolean} [killProcesses]
 */
async function stopExistingLlamaCppServes(killProcesses = true) {
  await loadServes();
  for (const row of servesCache) {
    if (
      row.runtime === 'llama-cpp' &&
      (row.status === 'running' || row.status === 'starting')
    ) {
      if (killProcesses && row.runId) stopActiveRun(row.runId);
      row.status = 'stopped';
      row.stoppedAt = Date.now();
    }
  }
  await saveServes();
}

/**
 * Upsert the stable llama-cpp-local provider for all llama.cpp serves.
 * @param {{ baseUrl: string, enabled: boolean, supportsModelLoadUnload?: boolean, modelsLoadPath?: string, modelsUnloadPath?: string }} opts
 */
export async function upsertLlamaCppProvider(opts) {
  const existing = await listProviders();
  const found = existing.providers.find((p) => p.id === LLAMA_CPP_LOCAL_ID);
  if (found) {
    await updateProvider(LLAMA_CPP_LOCAL_ID, {
      baseUrl: opts.baseUrl,
      enabled: opts.enabled,
      supportsModelLoadUnload: opts.supportsModelLoadUnload ?? true,
      modelsLoadPath: opts.modelsLoadPath ?? ROUTER_MODELS_LOAD_PATH,
      modelsUnloadPath: opts.modelsUnloadPath ?? ROUTER_MODELS_UNLOAD_PATH,
    });
  } else {
    await createProvider({
      id: LLAMA_CPP_LOCAL_ID,
      label: 'llama.cpp (local)',
      baseUrl: opts.baseUrl,
      apiKind: 'openai-v1',
      enabled: opts.enabled,
      modelsPath: '/v1/models',
      chatCompletionsPath: '/v1/chat/completions',
      supportsModelLoadUnload: opts.supportsModelLoadUnload ?? true,
      modelsLoadPath: opts.modelsLoadPath ?? ROUTER_MODELS_LOAD_PATH,
      modelsUnloadPath: opts.modelsUnloadPath ?? ROUTER_MODELS_UNLOAD_PATH,
    });
  }
  if (opts.enabled) {
    await setActiveProviderId(LLAMA_CPP_LOCAL_ID);
  }
  return LLAMA_CPP_LOCAL_ID;
}

/**
 * @param {{ modelPath: string, runtime?: string, port?: number, modelLabel?: string, profile?: string, hardware?: object, llama?: object, quant?: string, paramsB?: number, isMoe?: boolean, weightsGb?: number }} body
 */
export async function startServe(body) {
  await loadServes();
  const runtime = validateRuntime(body.runtime || 'llama-cpp');
  const modelPath = path.resolve(String(body.modelPath || ''));
  try {
    const stat = await fsp.stat(modelPath);
    if (!stat.isFile()) throw new Error('Model path is not a file');
  } catch {
    throw new Error('Model file not found');
  }
  if (!modelPath.toLowerCase().endsWith('.gguf')) {
    throw new Error('Only local .gguf files can be served in v1');
  }

  if (runtime !== 'llama-cpp') {
    throw new Error(
      'Only llama-cpp runtime is supported — use Ollama or LM Studio providers directly from Settings → Providers',
    );
  }

  const llamaServerPath = (await resolveLlamaServer()).path;
  if (!llamaServerPath) {
    throw new Error(
      'llama-server is not installed — install from Models or Settings → Servers before serving',
    );
  }

  const routerSupported = await probeLlamaRouterSupport(llamaServerPath);
  if (!routerSupported) {
    throw new Error(
      mapLlamaError('Installed llama-server does not support router mode'),
    );
  }

  await stopExistingLlamaCppServes(false);

  const serveId = crypto.randomUUID();
  const modelLabel =
    typeof body.modelLabel === 'string' && body.modelLabel.trim()
      ? body.modelLabel.trim()
      : labelFromPath(modelPath);

  const providerId = LLAMA_CPP_LOCAL_ID;
  const userSettings =
    body.llama && typeof body.llama === 'object' ? body.llama : undefined;

  // Router mode: one persistent llama-server handles all local GGUF models.
  await writeLlamaPresetIni();
  const routerStatus = await ensureRouter();
  const routerModelName = presetSectionNameFromFilename(path.basename(modelPath));
  try {
    await loadModelOnRouter(routerModelName);
  } catch {
    /* router may autoload on first chat request */
  }

  const baseUrl = routerStatus.baseUrl;
  const row = /** @type {ServeRecord} */ ({
    id: serveId,
    runtime,
    modelPath,
    modelLabel,
    port: routerStatus.port,
    baseUrl,
    providerId,
    status: 'running',
    startedAt: Date.now(),
    llamaSettings: userSettings ?? null,
  });
  servesCache.unshift(row);
  await upsertLlamaCppProvider({
    baseUrl,
    enabled: true,
    supportsModelLoadUnload: true,
    modelsLoadPath: ROUTER_MODELS_LOAD_PATH,
    modelsUnloadPath: ROUTER_MODELS_UNLOAD_PATH,
  });
  await saveServes();
  return publicServe(row);
}

/**
 * @param {string} serveId
 */
export async function stopServe(serveId) {
  await loadServes();
  validateServeId(serveId);
  const row = servesCache.find((s) => s.id === serveId);
  if (!row) throw new Error('Serve session not found');

  if (row.runId) {
    stopActiveRun(row.runId);
  }

  row.status = 'stopped';
  row.stoppedAt = Date.now();
  await saveServes();

  // Disable llama-cpp-local when no active llama-cpp serves remain.
  if (row.runtime === 'llama-cpp') {
    const stillRunning = servesCache.some(
      (s) =>
        s.runtime === 'llama-cpp' &&
        s.id !== serveId &&
        (s.status === 'running' || s.status === 'starting'),
    );
    if (!stillRunning) {
      try {
        await updateProvider(LLAMA_CPP_LOCAL_ID, { enabled: false });
      } catch {
        /* provider may have been removed manually */
      }
    }
  } else if (row.providerId) {
    try {
      await updateProvider(row.providerId, { enabled: false });
    } catch {
      /* provider may have been removed manually */
    }
  }

  return publicServe(row);
}

export async function listServes() {
  await loadServes();
  return servesCache.map(publicServe);
}

export async function shutdownAllModelServes() {
  await loadServes();
  for (const row of servesCache) {
    if (row.status === 'running' || row.status === 'starting') {
      if (row.runId) stopActiveRun(row.runId);
      row.status = 'stopped';
      row.stoppedAt = Date.now();
    }
  }
  await saveServes();
  try {
    await updateProvider(LLAMA_CPP_LOCAL_ID, { enabled: false });
  } catch {
    /* ignore */
  }
}

/** Test helper */
export async function resetServesForTests() {
  servesCache = [];
  loaded = false;
  resetServeBackgroundRunOverrideForTests();
  resetServeHealthOverrideForTests();
}
