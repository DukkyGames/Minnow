/**
 * Local model serve lifecycle — llama.cpp server + provider registration.
 */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  createBackgroundRun,
  getRun,
  readRunLogTail,
  stopActiveRun,
} from '../terminal-runner.js';
import {
  createProvider,
  LLAMA_CPP_LOCAL_ID,
  MINNOW_LIBRARY_PROVIDER_ID,
  listProviders,
  MLX_LM_LOCAL_ID,
  setActiveProviderId,
  updateProvider,
} from '../providers/store.js';
import { getManagedServerPort, isManagedServerRunning, startServer, stopServer } from '../servers/manager.js';
import {
  getInstallStatus as getMlxInstallStatus,
  isMlxSupported,
  MLX_UNSUPPORTED_MESSAGE,
} from '../servers/mlx-lm.js';
import { detectHardware } from '../system/hardware.js';
import { detectRuntimes } from './runtime-detect.js';
import {
  buildLlamaServerArgs,
  buildLlamaServerSpawnEnv,
  findSiblingMmproj,
  readLlamaCppConfig,
  warnIfReasoningBudgetCliFlag,
} from './llama-args.js';
import { setProviderThinkingBudgetSupport } from '../providers/capabilities-store.js';
import { getServesIndexPath, modelsLogDir } from './paths.js';
import { validatePort, validateRuntime, validateServeId } from './validate.js';
import {
  buildLlamaServerEnv,
  getInstalledLlamaVariant,
  llamaServerSpawnCwd,
  resolveLlamaServer,
  detectLlamaThinkingBudgetSupport,
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

/** User-facing error for serves left starting when the tool server restarts. */
export const INTERRUPTED_SERVE_ERROR = 'Model load interrupted (Minnow restarted)';

/** @type {((baseUrl: string) => Promise<boolean>) | null} */
let reachabilityProbeOverrideForTests = null;

export function setServeReachabilityProbeOverrideForTests(fn) {
  reachabilityProbeOverrideForTests = fn;
}

export function resetServeReachabilityProbeOverrideForTests() {
  reachabilityProbeOverrideForTests = null;
}

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

/**
 * Best-effort probe that a serve's HTTP surface is up (llama.cpp, mlx-lm, Ollama, …).
 * @param {string} baseUrl
 */
async function isServeEndpointReachable(baseUrl) {
  if (reachabilityProbeOverrideForTests) {
    return reachabilityProbeOverrideForTests(baseUrl);
  }
  const urls = [`${baseUrl}/health`, `${baseUrl}/v1/models`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_500) });
      if (res.ok) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/**
 * Whether a persisted row still reflects a live process after a server restart.
 * @param {ServeRecord} row
 */
async function isServeStillLive(row) {
  if (row.runtime === 'mlx-lm') {
    return isManagedServerRunning('mlx-lm');
  }
  if (row.runtime === 'llama-cpp' && row.runId) {
    const run = getRun(row.runId);
    if (run && !run.finished) return true;
  }
  if (row.baseUrl) {
    return isServeEndpointReachable(row.baseUrl);
  }
  return false;
}

/**
 * Mark queued/running serves from a previous server process as stopped (or error
 * when still "starting"). Child processes and in-memory terminal runs do not
 * survive a Minnow restart, but `serves.json` often still lists them as loaded.
 */
async function reconcileInterruptedServes() {
  let changed = false;
  for (const row of servesCache) {
    if (row.status !== 'running' && row.status !== 'starting') continue;
    if (await isServeStillLive(row)) continue;

    if (row.status === 'starting') {
      row.status = 'error';
      row.error = INTERRUPTED_SERVE_ERROR;
    } else {
      row.status = 'stopped';
      row.error = undefined;
    }
    row.stoppedAt = Date.now();
    row.runId = undefined;
    row.pid = undefined;
    changed = true;
  }
  if (!changed) return;

  await saveServes();

  for (const runtime of ['llama-cpp', 'mlx-lm']) {
    const providerId = runtime === 'llama-cpp' ? LLAMA_CPP_LOCAL_ID : MLX_LM_LOCAL_ID;
    const stillRunning = servesCache.some(
      (s) =>
        s.runtime === runtime && (s.status === 'running' || s.status === 'starting'),
    );
    if (!stillRunning) {
      try {
        await updateProvider(providerId, { enabled: false });
      } catch {
        /* provider may have been removed manually */
      }
    }
  }
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
  await reconcileInterruptedServes();
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
 * Pull a short, user-facing snippet from llama-server stderr/stdout.
 * @param {string | null} tail
 */
function summarizeLlamaLogTail(tail) {
  if (!tail) return '';
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const interesting = lines
    .filter((line) => /error|fatal|usage:/i.test(line))
    .slice(-3);
  const excerpt = (interesting.length ? interesting : lines.slice(-2)).join(' ');
  return excerpt.slice(0, 280);
}

/**
 * @param {string} baseUrl
 * @param {number} [timeoutMs]
 * @param {string} [runId]
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function waitForHealth(baseUrl, timeoutMs = 60_000, runId) {
  if (waitForHealthOverrideForTests) {
    const ok = await waitForHealthOverrideForTests(baseUrl);
    if (ok) return { ok: true };
    return { ok: false, error: 'llama-server did not become healthy in time' };
  }
  const deadline = Date.now() + timeoutMs;
  const urls = [`${baseUrl}/health`, `${baseUrl}/v1/models`];
  while (Date.now() < deadline) {
    if (runId) {
      const run = getRun(runId);
      if (run?.finished) {
        const tail = await readRunLogTail(runId, 4096);
        const detail = summarizeLlamaLogTail(tail);
        return {
          ok: false,
          error: detail
            ? `llama-server exited: ${detail}`
            : 'llama-server exited before becoming healthy',
        };
      }
    }
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2_500) });
        if (res.ok) return { ok: true };
      } catch {
        /* retry */
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { ok: false, error: 'llama-server did not become healthy in time' };
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
      if (row.runId) await stopActiveRun(row.runId);
      row.status = 'stopped';
      row.stoppedAt = Date.now();
    }
  }
  await saveServes();
}

/**
 * Stop other MLX serve rows before loading a new model (single weights resident).
 */
async function stopExistingMlxServes() {
  await loadServes();
  for (const row of servesCache) {
    if (
      row.runtime === 'mlx-lm' &&
      (row.status === 'running' || row.status === 'starting')
    ) {
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
 * Upsert the stable mlx-lm-local provider shared by every MLX serve.
 *
 * One provider for N models: `mlx_lm.server` hosts whichever model each request
 * names, so switching models is a `selectProviderModel` call rather than a new
 * provider row.
 * @param {{ baseUrl: string, enabled: boolean }} opts
 */
export async function upsertMlxLmProvider(opts) {
  const existing = await listProviders();
  const found = existing.providers.find((p) => p.id === MLX_LM_LOCAL_ID);
  if (found) {
    await updateProvider(MLX_LM_LOCAL_ID, {
      baseUrl: opts.baseUrl,
      enabled: opts.enabled,
    });
  } else {
    await createProvider({
      id: MLX_LM_LOCAL_ID,
      label: 'MLX (local)',
      baseUrl: opts.baseUrl,
      apiKind: 'openai-v1',
      enabled: opts.enabled,
      modelsPath: '/v1/models',
      chatCompletionsPath: '/v1/chat/completions',
      supportsModelLoadUnload: false,
    });
  }
  if (opts.enabled) {
    await setActiveProviderId(MLX_LM_LOCAL_ID);
  }
  return MLX_LM_LOCAL_ID;
}

/**
 * Bring the shared mlx-lm process up if it is not already serving.
 * `startServer` is idempotent — it returns `{ alreadyRunning: true }` when the
 * process is healthy, so a second model load costs a request, not a restart.
 * @returns {Promise<number>} the port it is listening on
 */
async function ensureMlxLmServerRunning() {
  if (!isMlxSupported()) {
    throw new Error(MLX_UNSUPPORTED_MESSAGE);
  }
  const status = await getMlxInstallStatus();
  if (!status.installed) {
    throw new Error(
      'The MLX runtime is not installed — install it from Models or Settings → Servers before loading MLX weights',
    );
  }
  await startServer('mlx-lm');
  const port = await getManagedServerPort('mlx-lm');
  if (!port) {
    throw new Error('mlx-lm has no configured port');
  }
  return port;
}

/**
 * Resolve and check the serve target for a runtime.
 *
 * Split out of startServe because the checks are runtime-specific: llama.cpp
 * serves a single `.gguf` *file*, while mlx-lm serves a whole snapshot
 * *directory*. Running the file/suffix checks over every runtime rejected every
 * MLX load before it reached its branch.
 * @param {string} runtime
 * @param {unknown} rawModelPath
 * @returns {Promise<string>} the resolved absolute path
 */
async function validateServeModelTarget(runtime, rawModelPath) {
  const modelPath = path.resolve(String(rawModelPath || ''));

  if (runtime === 'mlx-lm') {
    try {
      const stat = await fsp.stat(modelPath);
      if (!stat.isDirectory()) throw new Error('not a directory');
    } catch {
      throw new Error('MLX model directory not found');
    }
    return modelPath;
  }

  try {
    const stat = await fsp.stat(modelPath);
    if (!stat.isFile()) throw new Error('Model path is not a file');
  } catch {
    throw new Error('Model file not found');
  }
  if (!modelPath.toLowerCase().endsWith('.gguf')) {
    throw new Error('Only local .gguf files can be served in v1');
  }
  return modelPath;
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
 * @param {{ modelPath: string, runtime?: string, port?: number, modelLabel?: string, profile?: string, hardware?: object, llama?: object, quant?: string, paramsB?: number, isMoe?: boolean, weightsGb?: number, async?: boolean }} body
 */
export async function startServe(body) {
  await loadServes();
  const runtime = validateRuntime(body.runtime || 'llama-cpp');
  const modelPath = await validateServeModelTarget(runtime, body.modelPath);

  const runtimes = await detectRuntimes();
  let llamaServerPath = null;
  let llamaVariant = 'cpu';
  if (runtime === 'llama-cpp') {
    await stopExistingLlamaCppServes();
    llamaServerPath = (await resolveLlamaServer()).path;
    if (!llamaServerPath) {
      throw new Error(
        'llama-server is not installed — install from Models or Settings → Servers before serving',
      );
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

  if (runtime === 'mlx-lm') {
    await stopExistingMlxServes();
    const port = await ensureMlxLmServerRunning();
    const baseUrl = `http://127.0.0.1:${port}`;
    await upsertMlxLmProvider({ baseUrl, enabled: true });

    // No spawn, no health wait, no port picking — the managed process is
    // already up and `modelLabel` selects which weights it loads.
    const row = /** @type {ServeRecord} */ ({
      id: serveId,
      runtime,
      modelPath,
      modelLabel,
      port,
      baseUrl,
      providerId: MINNOW_LIBRARY_PROVIDER_ID,
      status: 'running',
      startedAt: Date.now(),
    });
    servesCache.unshift(row);
    await saveServes();
    return publicServe(row);
  }

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
  // Picker + chat binding use minnow-library; llama-cpp-local is upserted for upstream HTTP.
  const providerId = MINNOW_LIBRARY_PROVIDER_ID;

  const profileKey =
    typeof body.profile === 'string' && body.profile.trim() ? body.profile.trim() : 'balanced';

  const hardware =
    body.hardware && typeof body.hardware === 'object'
      ? body.hardware
      : await detectHardware();

  const llamaConfig = await readLlamaCppConfig();
  const userSettings =
    body.llama && typeof body.llama === 'object' ? body.llama : undefined;
  const mmprojPath = await findSiblingMmproj(modelPath);

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
    mmprojPath: mmprojPath ?? undefined,
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
    // Model runtime is user-installed software — not agent-authored argv (MIN-553).
    sandbox: false,
    logSubdir: 'models',
  });

  row.runId = run.runId;
  row.pid = run.pid;
  await saveServes();

  /** Wait for health, then promote the row and register the provider. */
  const settle = async () => {
    const healthy = await waitForHealth(baseUrl, 60_000, run.runId);
    if (!healthy.ok) {
      await stopActiveRun(run.runId);
      row.status = 'error';
      row.error = healthy.error;
      row.stoppedAt = Date.now();
      await saveServes();
      throw new Error(row.error);
    }

    row.status = 'running';
    warnIfReasoningBudgetCliFlag(userSettings, llamaConfig.defaults);
    try {
      const supportsThinkingBudget = await detectLlamaThinkingBudgetSupport(llamaServerPath);
      await setProviderThinkingBudgetSupport(LLAMA_CPP_LOCAL_ID, supportsThinkingBudget);
    } catch (err) {
      console.warn('[llama-cpp] thinking budget feature detect failed:', err);
    }
    await upsertLlamaCppProvider({ baseUrl, enabled: true });
    await saveServes();
  };

  // Async start returns while the model is still loading; callers poll
  // GET /api/models/serve/:id and follow the log stream for progress.
  if (body.async === true) {
    void settle().catch(() => {
      /* row already carries status:'error' + error text */
    });
    return publicServe(row);
  }

  await settle();
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
    await stopActiveRun(row.runId);
  }

  row.status = 'stopped';
  row.stoppedAt = Date.now();
  await saveServes();

  // llama-cpp and mlx-lm share one provider row across every serve, so it only
  // gets disabled once the last serve for that runtime is gone. mlx_lm.server has
  // no unload endpoint — stopping the managed process is the only way to free
  // weights from RAM when the last MLX model is ejected.
  if (row.runtime === 'llama-cpp' || row.runtime === 'mlx-lm') {
    const sharedProviderId = row.runtime === 'llama-cpp' ? LLAMA_CPP_LOCAL_ID : MLX_LM_LOCAL_ID;
    const stillRunning = servesCache.some(
      (s) =>
        s.runtime === row.runtime &&
        s.id !== serveId &&
        (s.status === 'running' || s.status === 'starting'),
    );
    if (!stillRunning) {
      try {
        await updateProvider(sharedProviderId, { enabled: false });
      } catch {
        /* provider may have been removed manually */
      }
      if (row.runtime === 'mlx-lm') {
        try {
          await stopServer('mlx-lm');
        } catch {
          /* process may already be gone */
        }
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

/**
 * Single serve record — used to poll a starting model until it is running.
 * @param {string} serveId
 */
export async function getServe(serveId) {
  await loadServes();
  validateServeId(serveId);
  const row = servesCache.find((s) => s.id === serveId);
  return row ? publicServe(row) : null;
}

export async function shutdownAllModelServes() {
  await loadServes();
  for (const row of servesCache) {
    if (row.status === 'running' || row.status === 'starting') {
      if (row.runId) await stopActiveRun(row.runId);
      row.status = 'stopped';
      row.stoppedAt = Date.now();
    }
  }
  await saveServes();
  for (const providerId of [LLAMA_CPP_LOCAL_ID, MLX_LM_LOCAL_ID]) {
    try {
      await updateProvider(providerId, { enabled: false });
    } catch {
      /* never seeded, or removed manually */
    }
  }
  const mlxStillActive = servesCache.some(
    (s) => s.runtime === 'mlx-lm' && (s.status === 'running' || s.status === 'starting'),
  );
  if (!mlxStillActive) {
    try {
      await stopServer('mlx-lm');
    } catch {
      /* already stopped */
    }
  }
}

/** Test helper */
export async function resetServesForTests() {
  servesCache = [];
  loaded = false;
  resetServeBackgroundRunOverrideForTests();
  resetServeHealthOverrideForTests();
  resetServeReachabilityProbeOverrideForTests();
}
