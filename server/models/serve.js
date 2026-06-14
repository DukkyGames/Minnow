/**
 * Local model serve lifecycle — llama.cpp server + provider registration.
 */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  createBackgroundRun,
  stopActiveRun,
} from '../terminal-runner.js';
import {
  createProvider,
  LLAMA_CPP_LOCAL_ID,
  listProviders,
  setActiveProviderId,
  updateProvider,
} from '../providers/store.js';
import { detectHardware } from '../system/hardware.js';
import { detectRuntimes } from './runtime-detect.js';
import {
  buildLlamaServerArgs,
  buildLlamaServerSpawnEnv,
  readLlamaCppConfig,
} from './llama-args.js';
import { getServesIndexPath, modelsLogDir } from './paths.js';
import { validatePort, validateRuntime, validateServeId } from './validate.js';
import {
  buildLlamaServerEnv,
  ensureLlamaServer,
  getInstalledLlamaVariant,
  llamaServerSpawnCwd,
  resolveLlamaServer,
} from './llama-runtime.js';

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

/** Test overrides — avoid spawning real llama-server in unit tests. */
/** @type {typeof createBackgroundRun | null} */
let createBackgroundRunOverrideForTests = null;
/** @type {((baseUrl: string) => Promise<boolean>) | null} */
let waitForHealthOverrideForTests = null;

export function setServeBackgroundRunOverrideForTests(fn) {
  createBackgroundRunOverrideForTests = fn;
}

export function resetServeBackgroundRunOverrideForTests() {
  createBackgroundRunOverrideForTests = null;
}

export function setServeHealthOverrideForTests(fn) {
  waitForHealthOverrideForTests = fn;
}

export function resetServeHealthOverrideForTests() {
  waitForHealthOverrideForTests = null;
}

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

async function saveServes() {
  await fsp.mkdir(path.dirname(getServesIndexPath()), { recursive: true });
  await fsp.writeFile(
    getServesIndexPath(),
    `${JSON.stringify({ version: 1, serves: servesCache }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * @returns {Promise<number>}
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
 * @param {string} baseUrl
 */
async function waitForHealth(baseUrl, timeoutMs = 60_000) {
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
 * Stop any running llama-cpp serve before starting a new one (single instance).
 */
async function stopExistingLlamaCppServes() {
  await loadServes();
  for (const row of servesCache) {
    if (
      row.runtime === 'llama-cpp' &&
      (row.status === 'running' || row.status === 'starting')
    ) {
      if (row.runId) stopActiveRun(row.runId);
      row.status = 'stopped';
      row.stoppedAt = Date.now();
    }
  }
  await saveServes();
}

/**
 * Upsert the stable llama-cpp-local provider for all llama.cpp serves.
 * @param {{ baseUrl: string, enabled: boolean }} opts
 */
export async function upsertLlamaCppProvider(opts) {
  const existing = await listProviders();
  const found = existing.providers.find((p) => p.id === LLAMA_CPP_LOCAL_ID);
  if (found) {
    await updateProvider(LLAMA_CPP_LOCAL_ID, {
      baseUrl: opts.baseUrl,
      enabled: opts.enabled,
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
      supportsModelLoadUnload: false,
    });
  }
  if (opts.enabled) {
    await setActiveProviderId(LLAMA_CPP_LOCAL_ID);
  }
  return LLAMA_CPP_LOCAL_ID;
}

/**
 * @param {{ serveId: string, baseUrl: string, modelLabel: string, apiKind: string, providerId?: string }} opts
 */
async function registerServeProvider(opts) {
  const providerId = opts.providerId || `models-${opts.serveId.slice(0, 8)}`;
  const existing = await listProviders();
  if (!existing.providers.some((p) => p.id === providerId)) {
    const isOpenAi = opts.apiKind === 'openai-v1';
    await createProvider({
      id: providerId,
      label: `Models · ${opts.modelLabel}`,
      baseUrl: opts.baseUrl,
      apiKind: opts.apiKind,
      enabled: true,
      modelsPath: isOpenAi ? '/v1/models' : '/api/v0/models',
      chatCompletionsPath: isOpenAi ? '/v1/chat/completions' : '/api/v0/chat/completions',
      supportsModelLoadUnload: false,
    });
  }
  await setActiveProviderId(providerId);
  return providerId;
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

  const runtimes = await detectRuntimes();
  let llamaServerPath = null;
  let llamaVariant = 'cpu';
  if (runtime === 'llama-cpp') {
    await stopExistingLlamaCppServes();
    llamaServerPath = (await resolveLlamaServer()).path ?? (await ensureLlamaServer());
    if (!llamaServerPath) {
      throw new Error('llama-server not found — install llama.cpp server binaries');
    }
    llamaVariant = (await getInstalledLlamaVariant()) ?? 'cpu';
  }
  if (runtime === 'ollama' && !runtimes.ollama.serving) {
    throw new Error('Ollama is not running on http://127.0.0.1:11434');
  }
  if (runtime === 'lm-studio' && !runtimes.lmStudio.available) {
    throw new Error('LM Studio server is not reachable on http://127.0.0.1:1234');
  }

  const serveId = crypto.randomUUID();
  const modelLabel =
    typeof body.modelLabel === 'string' && body.modelLabel.trim()
      ? body.modelLabel.trim()
      : labelFromPath(modelPath);

  if (runtime === 'ollama' || runtime === 'lm-studio') {
    const baseUrl =
      runtime === 'ollama' ? runtimes.ollama.baseUrl : runtimes.lmStudio.baseUrl;
    const providerId = await registerServeProvider({
      serveId,
      baseUrl,
      modelLabel,
      apiKind: runtime === 'ollama' ? 'openai-v1' : 'lm-studio-v0',
    });
    const row = /** @type {ServeRecord} */ ({
      id: serveId,
      runtime,
      modelPath,
      modelLabel,
      port: runtime === 'ollama' ? 11434 : 1234,
      baseUrl,
      providerId,
      status: 'running',
      startedAt: Date.now(),
    });
    servesCache.unshift(row);
    await saveServes();
    return publicServe(row);
  }

  const port = body.port ? validatePort(body.port) : await pickFreePort(8085);
  const baseUrl = `http://127.0.0.1:${port}`;
  const providerId = LLAMA_CPP_LOCAL_ID;

  const profileKey =
    typeof body.profile === 'string' && body.profile.trim() ? body.profile.trim() : 'balanced';

  const hardware =
    body.hardware && typeof body.hardware === 'object'
      ? body.hardware
      : await detectHardware();

  const llamaConfig = await readLlamaCppConfig();
  const userSettings =
    body.llama && typeof body.llama === 'object' ? body.llama : undefined;

  const args = buildLlamaServerArgs({
    modelPath,
    port,
    profileKey,
    hardware,
    modelMeta: {
      name: modelLabel,
      quantization: body.quant,
      parameters_raw: body.paramsB,
      is_moe: body.isMoe,
      serveWeightsGb: body.weightsGb,
      serveQuant: body.quant,
    },
    settings: userSettings,
    defaults: llamaConfig.defaults,
    variant: llamaVariant,
  });

  const row = /** @type {ServeRecord} */ ({
    id: serveId,
    runtime,
    modelPath,
    modelLabel,
    port,
    baseUrl,
    providerId,
    status: 'starting',
    startedAt: Date.now(),
    llamaSettings: userSettings ?? null,
  });
  servesCache.unshift(row);
  await saveServes();

  await fsp.mkdir(modelsLogDir(), { recursive: true });

  const spawnEnv = buildLlamaServerSpawnEnv(
    llamaServerPath,
    userSettings,
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

  row.runId = run.runId;
  row.pid = run.pid;
  await saveServes();

  const healthy = await waitForHealth(baseUrl);
  if (!healthy) {
    await stopActiveRun(run.runId);
    row.status = 'error';
    row.error = 'llama-server did not become healthy in time';
    row.stoppedAt = Date.now();
    await saveServes();
    throw new Error(row.error);
  }

  row.status = 'running';
  await upsertLlamaCppProvider({ baseUrl, enabled: true });
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
