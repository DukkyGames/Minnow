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
  subscribeRun,
} from '../terminal-runner.js';
import {
  createProvider,
  LLAMA_CPP_LOCAL_ID,
  MINNOW_LIBRARY_PROVIDER_ID,
  listProviders,
  MLX_LM_LOCAL_ID,
  seedLlamaCppLocal,
  setActiveProviderId,
  updateProvider,
} from '../providers/store.js';
import {
  getManagedServerPort,
  isManagedServerRunning,
  startServer,
  stopServer,
  subscribeServerState,
} from '../servers/manager.js';
import {
  getInstallStatus as getMlxInstallStatus,
  isMlxSupported,
  MLX_LM_VERSION,
  MLX_UNSUPPORTED_MESSAGE,
} from '../servers/mlx-lm.js';
import { contextLengthFromTransformersConfig } from './mlx-context-length.js';
import { detectHardware } from '../system/hardware.js';
import { detectRuntimes } from './runtime-detect.js';
import {
  buildLlamaServerLaunch,
  buildLlamaServerSpawnEnv,
  findSiblingMmproj,
  readLlamaCppConfig,
  warnIfReasoningBudgetCliFlag,
  writeLlamaCppConfig,
} from './llama-args.js';
import { appendServeLog } from './serve-logs.js';
import { setProviderThinkingBudgetSupport } from '../providers/capabilities-store.js';
// Cached GGUF header parse — startServe threads this into buildLlamaServerArgs.
import { readGgufMetadata } from './gguf-metadata.js';
import { assertSplitGgufSiblings } from './split-gguf.js';
import { diagnoseLlamaFailure } from './diagnose-llama-failure.js';
import { geometryFromGgufMetadata } from '../../src/models/model-geometry.mjs';
import { parseSpecContextBytes, updateLoadRate } from '../../src/models/load-progress.mjs';
import {
  listServeActivity,
  startServeActivity,
  stopAllServeActivity,
  stopServeActivity,
} from './serve-activity.js';
import {
  getLaunchPrefs,
  llamaSettingsFromLaunchRow,
  mergeLaunchSettings,
  recordLaunchLoadPrior,
} from './launch-prefs.js';
import { getServesIndexPath, modelsLogDir } from './paths.js';
import { validatePort, validateRuntime, validateServeId } from './validate.js';
import { MODEL_LOAD_TIMEOUT_MS } from './timeouts.js';
import { waitForHealth as waitForEndpointHealth } from './wait-for-health.js';
import {
  classifyServeExit,
  resetClassifyServeExitOverrideForTests,
} from './classify-serve-exit.js';
import {
  estimatePlanMemoryBytes,
  pickEvictions,
  resolveResidencyLimits,
  SERVE_IDLE_TTL_MS,
  serveMatchesModelId,
} from './admit-serve.js';

export {
  classifyServeExit,
  setClassifyServeExitOverrideForTests,
  resetClassifyServeExitOverrideForTests,
} from './classify-serve-exit.js';
import {
  buildLlamaServerEnv,
  getInstalledLlamaVariant,
  llamaServerSpawnCwd,
  resolveLlamaServer,
  detectLlamaThinkingBudgetSupport,
  assertLlamaServerMatchesHostArch,
} from './llama-runtime.js';

/** @typedef {'starting' | 'running' | 'stopped' | 'error' | 'crashed' | 'unhealthy'} ServeStatus */

/**
 * @typedef {object} ServeFailure
 * @property {string} code
 * @property {string} [title]
 * @property {string} [detail]
 * @property {string} [remediation]
 * @property {boolean} [retryable]
 * @property {Record<string, unknown>} [suggestedSettings]
 * @property {string[]} [chatTemplateFields]
 * @property {number | null} [exitCode]
 */

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
 * @property {number} [lastHealthyAt]
 * @property {number} [exitCode]
 * @property {ServeFailure} [failure]
 * @property {number} [restartCount]
 * @property {string} [libraryId]
 * @property {Record<string, unknown>} [llamaSettings]
 * @property {MlxServeSettings} [mlxSettings] Snapshot the inspector shows for mlx-lm (no llama flags).
 * @property {object} [launchPlan] Planner output plus geometry/hardware for Phase 3 OOM replan.
 * @property {number} [lastUsedAt] Completions + successful load; LRU / idle TTL.
 */

/**
 * @typedef {object} MlxServeSettings
 * @property {string} snapshotPath Absolute weights directory mlx_lm.server loaded.
 * @property {string | null} quant e.g. `mlx-4bit`, from the library row or config.json.
 * @property {string} mlxLmVersion Pinned mlx-lm package this process is running.
 * @property {number} port
 * @property {number | null} contextLength From the snapshot's config.json.
 */

/** Statuses that still own a live (or wedged) process. */
function isLiveServeStatus(status) {
  return status === 'running' || status === 'starting' || status === 'unhealthy';
}

/** Auto-restart only these Phase-2/3 codes — never OOM. */
const AUTO_RESTART_CODES = new Set(['unknown', 'transient', 'port_conflict']);
const AUTO_RESTART_DELAY_MS = 2_000;
const AUTO_RESTART_MIN_HEALTHY_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_FAILS_TO_UNHEALTHY = 3;

/** @type {ServeRecord[]} */
let servesCache = [];
let loaded = false;

/** @type {Set<(payload: { serves: object[], reason: string }) => void>} */
const serveCommitListeners = new Set();

/** serveId → unsubscribe from terminal-runner subscribeRun */
/** @type {Map<string, () => void>} */
const llamaRunUnsubs = new Map();

/** Consecutive /health failures for running rows (heartbeat). */
/** @type {Map<string, number>} */
const heartbeatFailStreak = new Map();

/** serveId → pending auto-restart handle */
/** @type {Map<string, { cancelled: boolean, promise: Promise<void> }>} */
const pendingRestarts = new Map();

/** User stopServe in flight — exit events must not flip these to crashed. */
const userStoppingServeIds = new Set();

/**
 * Most recently idle-TTL-unloaded llama.cpp serve. JIT-reload on the next
 * completion that names it. In-memory only — user eject does not go here.
 * @type {{
 *   libraryId: string,
 *   modelPath: string,
 *   modelLabel: string,
 *   llamaSettings: Record<string, unknown> | null,
 *   hardware: object | null,
 *   weightsBytes: number,
 *   runtime: string,
 * } | null}
 */
let lastTtlEviction = null;

/** @type {ReturnType<typeof setInterval> | null} */
let heartbeatTimer = null;
let heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
let restartDelayMs = AUTO_RESTART_DELAY_MS;
let mlxCrashUnsub = null;

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
/** @type {((baseUrl: string) => Promise<boolean | { ok: boolean, error?: string, logTail?: string, exitCode?: number | null }>) | null} */
let waitForHealthOverrideForTests = null;
/** @type {((baseUrl: string, modelId: string) => Promise<void>) | null} */
let mlxWarmupOverrideForTests = null;

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

export function setMlxWarmupOverrideForTests(fn) {
  mlxWarmupOverrideForTests = fn;
}

export function resetMlxWarmupOverrideForTests() {
  mlxWarmupOverrideForTests = null;
}

/** @type {typeof subscribeRun | null} */
let subscribeRunOverrideForTests = null;
/** @type {typeof subscribeServerState | null} */
let subscribeServerStateOverrideForTests = null;
/** @type {((row: ServeRecord) => Promise<boolean>) | null} */
let heartbeatProbeOverrideForTests = null;
/** @type {((pid: number | null | undefined) => boolean) | null} */
let pidAliveOverrideForTests = null;

export function setSubscribeRunOverrideForTests(fn) {
  subscribeRunOverrideForTests = fn;
}

export function resetSubscribeRunOverrideForTests() {
  subscribeRunOverrideForTests = null;
}

export function setSubscribeServerStateOverrideForTests(fn) {
  subscribeServerStateOverrideForTests = fn;
}

export function resetSubscribeServerStateOverrideForTests() {
  subscribeServerStateOverrideForTests = null;
}

export function setServeHeartbeatProbeOverrideForTests(fn) {
  heartbeatProbeOverrideForTests = fn;
}

export function resetServeHeartbeatProbeOverrideForTests() {
  heartbeatProbeOverrideForTests = null;
}

export function setServePidAliveOverrideForTests(fn) {
  pidAliveOverrideForTests = fn;
}

export function resetServePidAliveOverrideForTests() {
  pidAliveOverrideForTests = null;
}

export function setServeHeartbeatIntervalMsForTests(ms) {
  heartbeatIntervalMs = Number(ms) > 0 ? Number(ms) : HEARTBEAT_INTERVAL_MS;
  if (heartbeatTimer) {
    stopServeHeartbeat();
    ensureServeHeartbeat();
  }
}

export function setServeRestartDelayMsForTests(ms) {
  restartDelayMs = Number.isFinite(ms) && ms >= 0 ? Number(ms) : AUTO_RESTART_DELAY_MS;
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
    if (row.status !== 'running' && row.status !== 'starting' && row.status !== 'unhealthy') continue;
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

  await commitServes('reconcile');

  for (const runtime of ['llama-cpp', 'mlx-lm']) {
    const providerId = runtime === 'llama-cpp' ? LLAMA_CPP_LOCAL_ID : MLX_LM_LOCAL_ID;
    const stillRunning = servesCache.some(
      (s) => s.runtime === runtime && isLiveServeStatus(s.status),
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
  // Restored running serves often skip commitServes (status unchanged). Still
  // start /slots + /metrics pollers so Local Server is not blank until the
  // next heartbeat write.
  reconcileServeActivityPollers();
  ensureServeHeartbeat();
  ensureMlxCrashWatch();
}

/**
 * Disk write only — callers that mutate `servesCache` must use `commitServes`
 * so SSE listeners cannot miss a snapshot.
 */
async function saveServes() {
  await fsp.mkdir(path.dirname(getServesIndexPath()), { recursive: true });
  await fsp.writeFile(
    getServesIndexPath(),
    `${JSON.stringify({ version: 1, serves: servesCache }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Persist + emit `{ serves, reason }` to in-process listeners (and therefore SSE).
 * @param {string} reason
 */
export async function commitServes(reason) {
  await saveServes();
  reconcileServeActivityPollers();
  const snapshot = { serves: servesCache.map(publicServe), reason: String(reason || 'update') };
  for (const listener of [...serveCommitListeners]) {
    try {
      listener(snapshot);
    } catch {
      /* listener must not break persistence */
    }
  }
}

/**
 * Keep the `/slots` pollers matched to what is actually running. Driven off
 * `commitServes` so a serve that starts, dies, is evicted, or is restored after a
 * restart all take the same path — there is no separate lifecycle to keep in step.
 */
function reconcileServeActivityPollers() {
  const wanted = new Set();
  for (const row of servesCache) {
    if (row.runtime !== 'llama-cpp') continue;
    if (row.status !== 'running' && row.status !== 'unhealthy') continue;
    wanted.add(row.id);
    startServeActivity({
      id: row.id,
      baseUrl: row.baseUrl,
      runtime: row.runtime,
      modelLabel: row.modelLabel,
      libraryId: row.libraryId,
    });
  }
  for (const activity of listServeActivity()) {
    if (!wanted.has(activity.serveId)) stopServeActivity(activity.serveId);
  }
}

/**
 * In-process serve snapshots — unit tests collect these without HTTP.
 * The SSE route uses the same bus.
 * @param {(payload: { serves: object[], reason: string }) => void} listener
 * @returns {() => void}
 */
export function subscribeServeEvents(listener) {
  serveCommitListeners.add(listener);
  listener({ serves: servesCache.map(publicServe), reason: 'subscribe' });
  return () => {
    serveCommitListeners.delete(listener);
  };
}

/**
 * @returns {Promise<number>}
 */
async function pickFreePort(preferred = 8085) {
  // Live rows may not be bound yet (tests mock the spawn; production has a
  // TOCTOU window before llama-server listens). Never reuse a claimed port.
  const claimed = new Set(
    servesCache
      .filter((row) => isLiveServeStatus(row.status) && Number.isInteger(row.port))
      .map((row) => row.port),
  );

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

  if (!claimed.has(preferred)) {
    try {
      const port = await tryPort(preferred);
      if (!claimed.has(port)) return port;
    } catch {
      /* preferred in use on the host — fall through to an ephemeral port */
    }
  }

  for (let i = 0; i < 8; i += 1) {
    const port = await tryPort(0);
    if (!claimed.has(port)) return port;
  }
  throw new Error('No free port for llama.cpp serve');
}

/**
 * Pull the fields the UI and restart policy need. Test overrides may only set `code`.
 * @param {{ code?: string, title?: string, detail?: string, remediation?: string, retryable?: boolean, suggestedSettings?: Record<string, unknown>, chatTemplateFields?: string[] } | null | undefined} diagnosis
 * @param {number | null} [exitCode]
 */
function publicFailure(diagnosis, exitCode) {
  const code = diagnosis?.code || 'unknown';
  const out = {
    code,
    exitCode: exitCode ?? null,
  };
  if (diagnosis?.title) out.title = diagnosis.title;
  if (diagnosis?.detail) out.detail = diagnosis.detail;
  if (diagnosis?.remediation) out.remediation = diagnosis.remediation;
  if (typeof diagnosis?.retryable === 'boolean') out.retryable = diagnosis.retryable;
  if (diagnosis?.suggestedSettings) out.suggestedSettings = diagnosis.suggestedSettings;
  // bad_template: first-class chat_template keys (no invented template string).
  if (Array.isArray(diagnosis?.chatTemplateFields) && diagnosis.chatTemplateFields.length) {
    out.chatTemplateFields = diagnosis.chatTemplateFields;
  }
  return out;
}

/**
 * @param {string} baseUrl
 * @param {number} [timeoutMs]
 * @param {string} [runId]
 * @returns {Promise<{ ok: true } | { ok: false, error: string, logTail?: string, exitCode?: number | null }>}
 */
async function waitForHealth(baseUrl, timeoutMs = MODEL_LOAD_TIMEOUT_MS, runId) {
  // Serve tests stub this so they never hit a real llama-server. Keep the same
  // boolean / structured-result contract as before the shared helper.
  if (waitForHealthOverrideForTests) {
    const result = await waitForHealthOverrideForTests(baseUrl);
    if (result === true) return { ok: true };
    if (result && typeof result === 'object' && result.ok === true) return { ok: true };
    if (result && typeof result === 'object' && result.ok === false) {
      return {
        ok: false,
        error: result.error || 'llama-server did not become healthy in time',
        logTail: result.logTail,
        exitCode: result.exitCode ?? null,
      };
    }
    return { ok: false, error: 'llama-server did not become healthy in time' };
  }
  return waitForEndpointHealth({
    healthPath: '/health',
    extraPaths: ['/v1/models'],
    baseUrl,
    timeoutMs,
    runId,
    getRun,
    readLogTail: (id) => readRunLogTail(id, 4096),
    label: 'llama-server',
  });
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
    mlxSettings: row.mlxSettings ?? null,
    // Overlay matching for MLX chips needs the library id on the wire; llama
    // activity already carries it from the server-side /slots poller.
    libraryId: row.libraryId ?? null,
    exitCode: row.exitCode ?? null,
    failure: row.failure ?? null,
  };
}

/**
 * @param {string} modelPath
 */
function labelFromPath(modelPath) {
  return path.basename(modelPath).replace(/\.gguf$/i, '');
}

/**
 * Snapshot enough of a TTL-unloaded row to call `startServe` again (JIT).
 * @param {ServeRecord} row
 */
function snapshotTtlEviction(row) {
  return {
    libraryId: typeof row.libraryId === 'string' ? row.libraryId : '',
    modelPath: row.modelPath,
    modelLabel: row.modelLabel,
    llamaSettings: row.llamaSettings ? { ...row.llamaSettings } : null,
    hardware: row.launchPlan?.hardware ?? null,
    weightsBytes: Number(row.launchPlan?.weightsBytes) || 0,
    runtime: 'llama-cpp',
  };
}

function clearTtlEvictionIfMatchesRow(row) {
  if (!lastTtlEviction) return;
  if (serveMatchesModelId(lastTtlEviction, row.libraryId || row.modelLabel)) {
    lastTtlEviction = null;
    return;
  }
  if (lastTtlEviction.modelPath === row.modelPath) lastTtlEviction = null;
}

/**
 * Evict LRU llama.cpp residents until the incoming plan fits `models_max` and
 * the byte budget. Replaces the old single-instance `stopExistingLlamaCppServes`.
 * MLX still uses `stopExistingMlxServes` — one process, one set of weights.
 *
 * @param {object} plan launch plan plus geometry / hardware / variant
 */
export async function admitServe(plan) {
  await loadServes();
  const hardware = plan?.hardware && typeof plan.hardware === 'object' ? plan.hardware : {};
  const variant = plan?.variant ?? 'cpu';
  const llamaConfig = await readLlamaCppConfig();
  const { modelsMax, budgetBytes } = resolveResidencyLimits({
    hardware,
    variant,
    userModelsMax: llamaConfig.models_max,
  });
  const live = servesCache.filter(
    (row) => row.runtime === 'llama-cpp' && isLiveServeStatus(row.status),
  );
  const residents = live.map((row) => ({
    id: row.id,
    lastUsedAt: row.lastUsedAt,
    estimateBytes: estimatePlanMemoryBytes(row.launchPlan),
  }));
  const evictions = pickEvictions({
    residents,
    incomingEstimateBytes: estimatePlanMemoryBytes(plan),
    modelsMax,
    budgetBytes,
  });
  for (const victim of evictions) {
    // cause:'admit' — LRU room-making, not a user eject and not JIT-eligible.
    await stopServe(victim.id, { cause: 'admit' });
  }
}

/**
 * Stop other MLX serve rows before loading a new model (single weights resident).
 */
async function stopExistingMlxServes() {
  await loadServes();
  for (const row of servesCache) {
    if (
      row.runtime === 'mlx-lm' &&
      isLiveServeStatus(row.status)
    ) {
      row.status = 'stopped';
      row.stoppedAt = Date.now();
    }
  }
  await commitServes('stop-existing-mlx');
}

/**
 * One upsert for llama-cpp-local / mlx-lm-local. `supportsExtendedSamplers` is
 * set on create AND update so a pre-Phase-4 row still keeps min_p after reload.
 * @param {{ id: string, label: string, baseUrl: string, enabled: boolean }} opts
 */
export async function upsertLocalRuntimeProvider(opts) {
  const patch = {
    baseUrl: opts.baseUrl,
    enabled: opts.enabled,
    supportsExtendedSamplers: true,
  };
  const create = () =>
    createProvider({
      id: opts.id,
      label: opts.label,
      baseUrl: opts.baseUrl,
      apiKind: 'openai-v1',
      enabled: opts.enabled,
      modelsPath: '/v1/models',
      chatCompletionsPath: '/v1/chat/completions',
      supportsModelLoadUnload: false,
      supportsExtendedSamplers: true,
    });

  try {
    await updateProvider(opts.id, patch);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code !== 'ENOENT') throw err;
    try {
      await create();
    } catch (createErr) {
      if (!String(createErr?.message || '').includes('already exists')) throw createErr;
      // capabilities.json can mkdir the provider dir first; llama.cpp seeds a full profile.
      if (opts.id === LLAMA_CPP_LOCAL_ID) await seedLlamaCppLocal();
      await updateProvider(opts.id, patch);
    }
  }
  if (opts.enabled) {
    await setActiveProviderId(opts.id);
  }
  return opts.id;
}

/**
 * Upsert the stable llama-cpp-local provider for all llama.cpp serves.
 * @param {{ baseUrl: string, enabled: boolean }} opts
 */
export async function upsertLlamaCppProvider(opts) {
  return upsertLocalRuntimeProvider({
    id: LLAMA_CPP_LOCAL_ID,
    label: 'llama.cpp (local)',
    baseUrl: opts.baseUrl,
    enabled: opts.enabled,
  });
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
  return upsertLocalRuntimeProvider({
    id: MLX_LM_LOCAL_ID,
    label: 'MLX (local)',
    baseUrl: opts.baseUrl,
    enabled: opts.enabled,
  });
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
 * Inspector snapshot for an mlx-lm serve. mlx-lm has no llamaSettings; this is
 * path / quant / pinned version / port / context from the weights' config.json.
 *
 * @param {string} modelPath
 * @param {number} port
 * @param {unknown} quantHint Client-supplied library quant, when present.
 * @returns {Promise<MlxServeSettings>}
 */
async function readMlxLoadedWith(modelPath, port, quantHint) {
  let contextLength = null;
  let quant =
    typeof quantHint === 'string' && quantHint.trim() ? quantHint.trim() : null;
  try {
    const raw = await fsp.readFile(path.join(modelPath, 'config.json'), 'utf8');
    const config = JSON.parse(raw);
    contextLength = contextLengthFromTransformersConfig(config) ?? null;
    if (!quant && config && typeof config === 'object') {
      const bits = Number(/** @type {{ quantization?: { bits?: unknown } }} */ (config).quantization?.bits);
      if (Number.isFinite(bits) && bits > 0) quant = `mlx-${bits}bit`;
    }
  } catch {
    // Best-effort: a missing config.json still shows path, version, and port.
  }
  return {
    snapshotPath: modelPath,
    quant,
    mlxLmVersion: MLX_LM_VERSION,
    port,
    contextLength,
  };
}

/**
 * mlx_lm loads weights on the first request, not at process start. Hold the
 * serve row at `starting` until a 1-token completion returns, bounded by the
 * same load timeout as llama.cpp. Tests inject the POST (Windows has no MLX).
 *
 * @param {string} baseUrl
 * @param {string} modelId Absolute snapshot directory mlx_lm.server expects.
 */
async function warmupMlxWeights(baseUrl, modelId) {
  if (mlxWarmupOverrideForTests) {
    await mlxWarmupOverrideForTests(baseUrl, modelId);
    return;
  }
  const url = `${baseUrl}/v1/chat/completions`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: '.' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(MODEL_LOAD_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `MLX model did not finish loading (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`,
      );
    }
  } catch (err) {
    const name = err && typeof err === 'object' ? /** @type {{ name?: string }} */ (err).name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(
        'MLX model did not finish loading within the load timeout — weights load on the first request',
      );
    }
    throw err;
  }
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
  // 4-byte "GGUF" stubs in serve tests make readGgufMetadata return null —
  // only refuse missing shards when the header actually reports a split.
  const meta = await readGgufMetadata(modelPath);
  if (meta && meta.splitCount > 1) {
    await assertSplitGgufSiblings(modelPath, meta.splitCount);
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
 * @param {{ modelPath: string, runtime?: string, port?: number, modelLabel?: string, profile?: string, hardware?: object, llama?: object, libraryId?: string, quant?: string, paramsB?: number, isMoe?: boolean, weightsGb?: number, async?: boolean, restartCount?: number }} body
 */
export async function startServe(body) {
  await loadServes();
  const runtime = validateRuntime(body.runtime || 'llama-cpp');
  const modelPath = await validateServeModelTarget(runtime, body.modelPath);

  // llama.cpp profiles prefer the on-disk GGUF header (exact nLayers / layerBytes /
  // swaWindow / trainCtx) over parameter-count guesses. readGgufMetadata is LRU-cached
  // and returns null for dummy/invalid files (the 4-byte "GGUF" stubs in serve tests)
  // rather than throwing — launch still proceeds on heuristics. MLX / Ollama / LM Studio
  // never consume this object.
  const ggufMeta = runtime === 'llama-cpp' ? await readGgufMetadata(modelPath) : null;

  const runtimes = await detectRuntimes();
  let llamaServerPath = null;
  let llamaVariant = 'cpu';
  if (runtime === 'llama-cpp') {
    // Only cancel a pending auto-restart of *this* weights — other residents keep theirs.
    for (const [id, handle] of pendingRestarts) {
      const pending = servesCache.find((row) => row.id === id);
      if (pending && pending.modelPath === modelPath) handle.cancelled = true;
    }
    llamaServerPath = (await resolveLlamaServer()).path;
    if (!llamaServerPath) {
      throw new Error(
        'llama-server is not installed — install from Models or Settings → Servers before serving',
      );
    }
    // Wrong-arch PE produces a 0-byte serve log (process never starts). Fail
    // here so Local Server shows the Settings remediation instead of silence.
    assertLlamaServerMatchesHostArch(llamaServerPath);
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

    // Parsed here because the llama libraryId block lives below this branch.
    const mlxLibraryId = typeof body.libraryId === 'string' ? body.libraryId.trim() : '';
    const mlxWeightsBytes = Number(body.weightsGb) > 0 ? Number(body.weightsGb) * 1024 ** 3 : 0;
    const mlxSettings = await readMlxLoadedWith(modelPath, port, body.quant);

    // Process is up but weights are not loaded until the first completion.
    // Commit `starting` first so the UI does not lie `running` during warmup.
    const row = /** @type {ServeRecord} */ ({
      id: serveId,
      runtime,
      modelPath,
      modelLabel,
      port,
      baseUrl,
      providerId: MINNOW_LIBRARY_PROVIDER_ID,
      status: 'starting',
      startedAt: Date.now(),
      mlxSettings,
    });
    // Same picker id chat/V2 Start match on — without it, live MLX rows only
    // match by snapshot path and a `mlx:repo` binding cannot find them.
    if (mlxLibraryId) row.libraryId = mlxLibraryId;
    servesCache.unshift(row);
    await commitServes('mlx-start');
    ensureMlxCrashWatch();

    const settleMlx = async () => {
      try {
        await warmupMlxWeights(baseUrl, modelPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        row.status = 'error';
        row.error = message;
        row.stoppedAt = Date.now();
        await commitServes('mlx-warmup-error');
        throw new Error(message);
      }
      // Record the load prior before flipping to running so a client that polls
      // status does not observe running with a stale lastLoadMs.
      const loadMs = Math.max(0, Date.now() - row.startedAt);
      if (mlxLibraryId) {
        try {
          await recordLaunchLoadPrior(mlxLibraryId, {
            lastLoadMs: loadMs,
            lastWeightsBytes: mlxWeightsBytes,
          });
        } catch (err) {
          console.warn('[mlx-lm] launch load prior persist failed:', err);
        }
      }
      row.status = 'running';
      row.lastHealthyAt = Date.now();
      await commitServes('mlx-running');
      ensureServeHeartbeat();
    };

    // Async start returns while warmup is still in flight; callers poll
    // GET /api/models/serve/:id. Sync (no async) waits so existing tests keep
    // asserting `running` on the returned row.
    if (body.async === true) {
      void settleMlx().catch(() => {
        /* row already carries status:'error' + error text */
      });
      return publicServe(row);
    }

    await settleMlx();
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
    await commitServes('external-start');
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
  // Optional library row id — picker / CLI / table Load pass this so saved
  // inspector drafts apply even when body.llama is {} (auto / untouched).
  const libraryId = typeof body.libraryId === 'string' ? body.libraryId.trim() : '';
  const savedLaunch = libraryId
    ? llamaSettingsFromLaunchRow((await getLaunchPrefs()).byLibraryId[libraryId])
    : undefined;
  const requestLlama =
    body.llama && typeof body.llama === 'object' ? body.llama : undefined;
  // Merge order: llama-cpp.json defaults (via buildLlamaServerLaunch) → saved
  // launch prefs → request body. Request wins so inspector Load can override.
  const userSettings = mergeLaunchSettings(savedLaunch, requestLlama);
  const mmprojPath = await findSiblingMmproj(modelPath);

  // Planner needs a byte size. Prefer the client figure (library already has sizeBytes);
  // fall back to statting the weights so CLI / onboarding loads still get a real plan.
  let weightsBytes = Number(body.weightsGb) > 0 ? Number(body.weightsGb) * 1024 ** 3 : 0;
  if (!(weightsBytes > 0)) {
    try {
      weightsBytes = (await fsp.stat(modelPath)).size;
    } catch {
      weightsBytes = 0;
    }
  }

  // A speculative draft model is a second set of weights on the same device. Stat it
  // here so the plan, the residency budget, and the OOM re-plan all see its cost.
  // MTP has no second file — its heads ship inside the main GGUF.
  let draftWeightsBytes = 0;
  const draftModelPath =
    typeof userSettings?.spec_draft_model === 'string' ? userSettings.spec_draft_model.trim() : '';
  if (draftModelPath) {
    try {
      draftWeightsBytes = (await fsp.stat(draftModelPath)).size;
    } catch {
      draftWeightsBytes = 0;
    }
  }

  const modelMeta = {
    name: modelLabel,
    quantization: body.quant,
    parameters_raw: body.paramsB,
    is_moe: body.isMoe,
    serveWeightsGb: body.weightsGb,
    serveQuant: body.quant,
  };
  const launchOpts = {
    modelPath,
    port,
    profileKey,
    hardware,
    modelMeta,
    settings: userSettings,
    defaults: llamaConfig.defaults,
    variant: llamaVariant,
    mmprojPath: mmprojPath ?? undefined,
    // Same ggufMeta GET /api/models/profiles already feeds computeServeProfiles.
    ggufMeta,
    weightsBytes,
    draftWeightsBytes,
    // Stable --alias for /v1/models. Empty when picker/CLI omitted libraryId.
    libraryId: libraryId || undefined,
  };
  let launch = buildLlamaServerLaunch(launchOpts);

  // Geometry + hardware stay on the plan so a VRAM OOM can re-plan at 85% budget,
  // and so admitServe can sum estimateRunMemory over residents + this load.
  const ggufGeometry = ggufMeta ? geometryFromGgufMetadata(ggufMeta) : null;
  const launchPlan = {
    ...launch.plan,
    geometry: ggufGeometry ?? undefined,
    weightsBytes,
    draftWeightsBytes,
    hardware,
    variant: llamaVariant,
    trainCtx: ggufMeta?.trainCtx,
    parallel: launch.settings?.parallel ?? 1,
    splitCount: ggufMeta?.splitCount ?? 1,
  };
  // Multi-serve: evict LRU until cap/budget fit. Must run before we insert this row
  // so we never treat the incoming serve as a victim.
  await admitServe(launchPlan);

  const loadedAt = Date.now();
  const row = /** @type {ServeRecord} */ ({
    id: serveId,
    runtime,
    modelPath,
    modelLabel,
    port,
    baseUrl,
    providerId,
    status: 'starting',
    startedAt: loadedAt,
    lastUsedAt: loadedAt,
    // Effective planned settings so Inference is not empty when the client sent {}.
    llamaSettings: launch.settings,
    restartCount: Number.isInteger(body.restartCount) ? Number(body.restartCount) : 0,
  });
  if (libraryId) row.libraryId = libraryId;
  row.launchPlan = launchPlan;
  servesCache.unshift(row);
  await commitServes('llama-starting');

  await fsp.mkdir(modelsLogDir(), { recursive: true });

  const spawnEnv = buildLlamaServerSpawnEnv(
    llamaServerPath,
    userSettings,
    process.env,
    buildLlamaServerEnv,
  );

  const createRun = createBackgroundRunOverrideForTests ?? createBackgroundRun;
  const spawnLlama = async (nextLaunch) => {
    const spawned = await createRun({
      command: llamaServerPath,
      args: nextLaunch.args,
      cwd: llamaServerSpawnCwd(llamaServerPath),
      env: spawnEnv,
      source: 'agent',
      // Model runtime is user-installed software — not agent-authored argv (MIN-553).
      sandbox: false,
      logSubdir: 'models',
    });
    row.runId = spawned.runId;
    row.pid = spawned.pid;
    await commitServes('llama-spawned');
    // After createRun so the path matches ~/.minnow/logs/models/{runId}.log. Phrase
    // `fit planner` is the Phase 3 grep needle.
    if (nextLaunch.warning) {
      await appendServeLog(spawned.runId, nextLaunch.warning);
    }
    return spawned;
  };

  let run = await spawnLlama(launch);

  /** Wait for health, then promote the row and register the provider. */
  const settle = async () => {
    let currentRun = run;
    let currentLaunch = launch;
    let currentBaseUrl = row.baseUrl;
    // One retry per load-failure class — port TOCTOU and a bad Jinja template.
    let portRetried = false;
    let jinjaRetried = false;

    const diagnoseLoad = (healthy) =>
      diagnoseLlamaFailure(
        healthy.logTail ?? '',
        healthy.exitCode ?? null,
        row.launchPlan ?? currentLaunch.plan,
      );

    let healthy = await waitForHealth(currentBaseUrl, MODEL_LOAD_TIMEOUT_MS, currentRun.runId);
    while (!healthy.ok) {
      await stopActiveRun(currentRun.runId);
      const diagnosis = diagnoseLoad(healthy);
      const retryPort = diagnosis.code === 'port_conflict' && !portRetried;
      const retryJinja = diagnosis.code === 'bad_template' && !jinjaRetried;
      if (!retryPort && !retryJinja) {
        // Never became healthy — status stays `error` (not crashed). UI reads failure.title.
        const exited = healthy.exitCode != null || Boolean(healthy.logTail);
        row.status = 'error';
        row.exitCode = healthy.exitCode ?? null;
        row.failure = publicFailure(diagnosis, healthy.exitCode ?? null);
        row.error = exited ? diagnosis.title : healthy.error;
        row.stoppedAt = Date.now();
        await commitServes('llama-error');
        throw new Error(row.error);
      }
      if (retryPort) {
        portRetried = true;
        const freshPort = await pickFreePort(0);
        row.port = freshPort;
        currentBaseUrl = `http://127.0.0.1:${freshPort}`;
        row.baseUrl = currentBaseUrl;
      }
      if (retryJinja) {
        jinjaRetried = true;
      }
      currentLaunch = buildLlamaServerLaunch({
        ...launchOpts,
        port: row.port,
        settings: {
          ...userSettings,
          skip_jinja: jinjaRetried ? true : userSettings?.skip_jinja,
        },
      });
      row.llamaSettings = currentLaunch.settings;
      currentRun = await spawnLlama(currentLaunch);
      healthy = await waitForHealth(currentBaseUrl, MODEL_LOAD_TIMEOUT_MS, currentRun.runId);
    }

    // Record the load-progress priors before flipping to `running` so a client
    // that polls status does not observe running with a stale lastLoadMs.
    const loadMs = Math.max(0, Date.now() - row.startedAt);
    if (libraryId) {
      try {
        await recordLaunchLoadPrior(libraryId, {
          lastLoadMs: loadMs,
          lastWeightsBytes: weightsBytes,
        });
      } catch (err) {
        console.warn('[llama-cpp] launch load prior persist failed:', err);
      }
    }
    // Rolling per-variant rate, so a model being loaded for the first time still gets
    // an ETA. Keyed by variant because a CUDA build and a CPU build are an order of
    // magnitude apart on the same file.
    try {
      const config = await readLlamaCppConfig();
      const table =
        config.loadRate && typeof config.loadRate === 'object' ? { ...config.loadRate } : {};
      const next = updateLoadRate(table[llamaVariant], { loadMs, weightsBytes });
      if (next > 0) {
        table[llamaVariant] = next;
        await writeLlamaCppConfig({ loadRate: table });
      }
    } catch (err) {
      console.warn('[llama-cpp] load rate persist failed:', err);
    }

    // llama-server reports what a speculative context actually cost
    // (`[spec] estimated memory usage of MTP context is N MiB`). Nothing Minnow parses
    // from the GGUF can predict that, so take the runtime's own figure and fold it into
    // the plan the residency budget is computed from.
    if (currentLaunch?.plan?.spec_type && currentRun?.runId) {
      try {
        const tail = (await readRunLogTail(currentRun.runId, 32768)) ?? '';
        const specBytes = parseSpecContextBytes(tail);
        if (specBytes != null && specBytes > 0 && row.launchPlan) {
          row.launchPlan.specContextBytes = specBytes;
        }
      } catch {
        /* the figure is a refinement, not a requirement */
      }
    }

    row.status = 'running';
    row.lastHealthyAt = Date.now();
    row.lastUsedAt = Date.now();
    // A successful load of this alias replaces the JIT snapshot.
    clearTtlEvictionIfMatchesRow(row);
    // Subscribe before the next await so a death during provider upsert is not missed.
    watchLlamaRun(row);
    ensureServeHeartbeat();
    warnIfReasoningBudgetCliFlag(userSettings, llamaConfig.defaults);
    // Register the provider before writing capabilities.json — that mkdir can
    // create providers/llama-cpp-local/ without profile.json, which then makes
    // createProvider throw "already exists" on JIT reload.
    await upsertLlamaCppProvider({ baseUrl: row.baseUrl, enabled: true });
    try {
      const supportsThinkingBudget = await detectLlamaThinkingBudgetSupport(llamaServerPath);
      await setProviderThinkingBudgetSupport(LLAMA_CPP_LOCAL_ID, supportsThinkingBudget);
    } catch (err) {
      console.warn('[llama-cpp] thinking budget feature detect failed:', err);
    }
    await commitServes('llama-running');
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
 * @param {{ cause?: 'user' | 'ttl' | 'admit' }} [opts]
 *   `user` (default) is an eject — not JIT. `ttl` records the JIT snapshot.
 *   `admit` is LRU room-making. All causes still suppress crash classification
 *   while the child is dying.
 */
export async function stopServe(serveId, opts = {}) {
  await loadServes();
  validateServeId(serveId);
  const row = servesCache.find((s) => s.id === serveId);
  if (!row) throw new Error('Serve session not found');

  const cause = opts.cause === 'ttl' || opts.cause === 'admit' ? opts.cause : 'user';
  if (cause === 'ttl' && row.runtime === 'llama-cpp') {
    lastTtlEviction = snapshotTtlEviction(row);
  }
  if (cause === 'user') {
    clearTtlEvictionIfMatchesRow(row);
  }
  userStoppingServeIds.add(serveId);
  cancelPendingRestart(serveId);
  llamaRunUnsubs.get(serveId)?.();
  llamaRunUnsubs.delete(serveId);

  try {
    if (row.runId) {
      await stopActiveRun(row.runId);
    }

    row.status = 'stopped';
    row.stoppedAt = Date.now();
    row.error = undefined;
    await commitServes('stop');

    // llama-cpp and mlx-lm share one provider row across every serve, so it only
    // gets disabled once the last serve for that runtime is gone. mlx_lm.server has
    // no unload endpoint — stopping the managed process is the only way to free
    // weights from RAM when the last MLX model is ejected.
    if (row.runtime === 'llama-cpp' || row.runtime === 'mlx-lm') {
      const sharedProviderId = row.runtime === 'llama-cpp' ? LLAMA_CPP_LOCAL_ID : MLX_LM_LOCAL_ID;
      const stillRunning = servesCache.some(
        (s) => s.runtime === row.runtime && s.id !== serveId && isLiveServeStatus(s.status),
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
  } finally {
    userStoppingServeIds.delete(serveId);
  }
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
    if (isLiveServeStatus(row.status)) {
      cancelPendingRestart(row.id);
      llamaRunUnsubs.get(row.id)?.();
      llamaRunUnsubs.delete(row.id);
      if (row.runId) await stopActiveRun(row.runId);
      row.status = 'stopped';
      row.stoppedAt = Date.now();
    }
  }
  await commitServes('shutdown');
  for (const providerId of [LLAMA_CPP_LOCAL_ID, MLX_LM_LOCAL_ID]) {
    try {
      await updateProvider(providerId, { enabled: false });
    } catch {
      /* never seeded, or removed manually */
    }
  }
  const mlxStillActive = servesCache.some(
    (s) => s.runtime === 'mlx-lm' && isLiveServeStatus(s.status),
  );
  if (!mlxStillActive) {
    try {
      await stopServer('mlx-lm');
    } catch {
      /* already stopped */
    }
  }
}

/**
 * Whether a crashed row should get one automatic restart.
 * OOM is never auto-restarted: the same weights and settings will OOM again and
 * a restart loop would hammer the GPU. User Retry (or Phase 3 suggested
 * settings) is the recovery path.
 *
 * @param {ServeRecord} row
 * @param {{ code: string }} classification
 * @param {number} [now]
 */
export function shouldAutoRestartServe(row, classification, now = Date.now()) {
  if (!row || !classification) return false;
  if (classification.code === 'oom_vram') return false;
  if (!AUTO_RESTART_CODES.has(classification.code)) return false;
  if ((row.restartCount ?? 0) >= 1) return false;
  const healthyAt = row.lastHealthyAt ?? row.startedAt;
  if (!healthyAt || now - healthyAt < AUTO_RESTART_MIN_HEALTHY_MS) return false;
  return true;
}

function cancelPendingRestart(serveId) {
  const pending = pendingRestarts.get(serveId);
  if (pending) pending.cancelled = true;
}

/**
 * Reload the same modelPath / settings / libraryId after a crash.
 * @param {string} serveId
 */
export async function restartServe(serveId) {
  await loadServes();
  validateServeId(serveId);
  const row = servesCache.find((s) => s.id === serveId);
  if (!row) throw new Error('Serve session not found');
  return startServe({
    modelPath: row.modelPath,
    runtime: row.runtime,
    modelLabel: row.modelLabel,
    llama: row.llamaSettings,
    libraryId: row.libraryId,
    restartCount: row.restartCount ?? 1,
    async: true,
  });
}

function scheduleAutoRestart(row) {
  if (pendingRestarts.has(row.id)) return;
  const handle = { cancelled: false, promise: Promise.resolve() };
  handle.promise = (async () => {
    await new Promise((resolve) => setTimeout(resolve, restartDelayMs));
    if (handle.cancelled) return;
    const current = servesCache.find((s) => s.id === row.id);
    if (!current || current.status !== 'crashed') return;
    await restartServe(row.id);
  })().catch((err) => {
    console.warn('[serve] auto-restart failed:', err);
  }).finally(() => {
    pendingRestarts.delete(row.id);
  });
  pendingRestarts.set(row.id, handle);
}

export function waitForServeRestartsForTests() {
  return Promise.all([...pendingRestarts.values()].map((h) => h.promise));
}

/**
 * Exit handlers persist then maybe schedule a restart. Tests drain this set so
 * commitServes cannot write after MINNOW_HOME is restored and the temp home is deleted.
 * @type {Set<Promise<void>>}
 */
const pendingCrashHandlers = new Set();

/** Track a fire-and-forget llama/MLX crash handler so tests can await it. */
function trackCrashHandler(promise) {
  pendingCrashHandlers.add(promise);
  void promise.finally(() => {
    pendingCrashHandlers.delete(promise);
  });
}

/** Wait until in-flight crash persist + restart scheduling has finished. */
export function waitForServeCrashHandlersForTests() {
  return Promise.all([...pendingCrashHandlers]);
}

function watchLlamaRun(row) {
  if (!row.runId) return;
  llamaRunUnsubs.get(row.id)?.();
  const subscribe = subscribeRunOverrideForTests ?? subscribeRun;
  if (typeof subscribe !== 'function') return;
  const unsub = subscribe(row.runId, (event) => {
    if (event?.type !== 'exit') return;
    trackCrashHandler(handleLlamaRunExit(row.id, event));
  });
  llamaRunUnsubs.set(row.id, typeof unsub === 'function' ? unsub : () => {});
}

/**
 * @param {string} serveId
 * @param {{ code?: number | null, stopped?: boolean }} event
 */
async function handleLlamaRunExit(serveId, event) {
  await loadServes();
  const row = servesCache.find((s) => s.id === serveId);
  if (!row) return;
  if (event?.stopped) return;
  if (userStoppingServeIds.has(serveId)) return;
  if (row.status === 'stopped' || row.status === 'error' || row.status === 'crashed') return;

  llamaRunUnsubs.get(serveId)?.();
  llamaRunUnsubs.delete(serveId);

  const exitCode = Number.isFinite(event?.code) ? Number(event.code) : event?.code ?? null;
  let logTail = '';
  if (row.runId) {
    try {
      logTail = (await readRunLogTail(row.runId, 4096)) ?? '';
    } catch {
      logTail = '';
    }
  }
  const classified = classifyServeExit({ exitCode, logTail, plan: row.launchPlan ?? null });
  row.status = 'crashed';
  row.exitCode = exitCode;
  row.failure = publicFailure(classified, exitCode);
  row.stoppedAt = Date.now();
  row.error = classified.title || undefined;
  heartbeatFailStreak.delete(serveId);

  const willRestart = shouldAutoRestartServe(row, classified);
  if (willRestart) {
    row.restartCount = (row.restartCount ?? 0) + 1;
  }
  await commitServes('llama-crash');

  const stillLive = servesCache.some(
    (s) => s.runtime === 'llama-cpp' && s.id !== serveId && isLiveServeStatus(s.status),
  );
  if (!stillLive) {
    try {
      await updateProvider(LLAMA_CPP_LOCAL_ID, { enabled: false });
    } catch {
      /* provider may have been removed */
    }
  }

  if (willRestart) scheduleAutoRestart(row);
}

function ensureMlxCrashWatch() {
  if (mlxCrashUnsub) return;
  const subscribe = subscribeServerStateOverrideForTests ?? subscribeServerState;
  if (typeof subscribe !== 'function') return;
  mlxCrashUnsub = subscribe('mlx-lm', (event) => {
    if (event?.type !== 'exit') return;
    trackCrashHandler(handleMlxServerExit(event));
  });
}

/**
 * @param {{ code?: number | null }} event
 */
async function handleMlxServerExit(event) {
  await loadServes();
  const exitCode = Number.isFinite(event?.code) ? Number(event.code) : event?.code ?? null;
  let changed = false;
  for (const row of servesCache) {
    if (row.runtime !== 'mlx-lm') continue;
    if (userStoppingServeIds.has(row.id)) continue;
    if (row.status === 'stopped' || row.status === 'error' || row.status === 'crashed') continue;
    if (!isLiveServeStatus(row.status)) continue;
    row.status = 'crashed';
    row.exitCode = exitCode;
    row.failure = { code: 'unknown', exitCode };
    row.stoppedAt = Date.now();
    row.error = undefined;
    heartbeatFailStreak.delete(row.id);
    changed = true;
  }
  if (!changed) return;
  await commitServes('mlx-crash');
  try {
    await updateProvider(MLX_LM_LOCAL_ID, { enabled: false });
  } catch {
    /* provider may have been removed */
  }
}

function isPidAlive(pid) {
  if (pidAliveOverrideForTests) return pidAliveOverrideForTests(pid);
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isServeProcessAlive(row) {
  if (row.runtime === 'mlx-lm') {
    try {
      return isManagedServerRunning('mlx-lm');
    } catch {
      return false;
    }
  }
  return isPidAlive(row.pid);
}

async function probeServeHealth(row) {
  if (heartbeatProbeOverrideForTests) return heartbeatProbeOverrideForTests(row);
  if (!row.baseUrl) return false;
  try {
    const res = await fetch(`${row.baseUrl}/health`, { signal: AbortSignal.timeout(2_500) });
    return res.ok;
  } catch {
    return false;
  }
}

function stopServeHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Idle unload window for one serve. Per-model `idle_ttl_ms` from the Load tab wins;
 * `0` means keep it loaded indefinitely. Falls back to the global 20-minute default.
 * @param {{ llamaSettings?: Record<string, unknown> | null }} row
 * @returns {number}
 */
function serveIdleTtlMs(row) {
  const raw = row?.llamaSettings?.idle_ttl_ms;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  return SERVE_IDLE_TTL_MS;
}

function ensureServeHeartbeat() {
  if (heartbeatTimer) return;
  // node:test sets NODE_TEST_CONTEXT — tests drive ticks via tickServeHeartbeatForTests
  // so a fake pid cannot flip a row to crashed 10s into an unrelated suite.
  if (process.env.NODE_TEST_CONTEXT && heartbeatIntervalMs === HEARTBEAT_INTERVAL_MS) return;
  heartbeatTimer = setInterval(() => {
    void tickServeHeartbeat();
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();
}

/**
 * One heartbeat tick: /health for running (and recovering unhealthy) rows.
 * Three consecutive failures with the PID still alive → `unhealthy`.
 */
export async function tickServeHeartbeatForTests() {
  await tickServeHeartbeat();
}

async function tickServeHeartbeat() {
  await loadServes();
  const now = Date.now();
  // Idle TTL before /health so a still-healthy but unused process unloads.
  const ttlIds = [];
  for (const row of servesCache) {
    if (row.runtime !== 'llama-cpp') continue;
    if (row.status !== 'running' && row.status !== 'unhealthy') continue;
    const usedAt = row.lastUsedAt ?? row.startedAt ?? 0;
    const ttl = serveIdleTtlMs(row);
    // 0 is the Load tab's "keep loaded" — never sweep it.
    if (ttl > 0 && now - usedAt >= ttl) ttlIds.push(row.id);
  }
  for (const id of ttlIds) {
    try {
      await stopServe(id, { cause: 'ttl' });
    } catch (err) {
      console.warn('[serve] idle TTL stop failed:', err);
    }
  }

  let changed = false;
  for (const row of servesCache) {
    if (row.status !== 'running' && row.status !== 'unhealthy') continue;
    const alive = isServeProcessAlive(row);
    if (!alive) {
      // Crash watcher should have flipped this; heal a missed subscribeRun.
      if (row.status !== 'crashed' && row.status !== 'stopped') {
        row.status = 'crashed';
        row.exitCode = row.exitCode ?? null;
        row.failure = row.failure ?? { code: 'unknown', exitCode: row.exitCode ?? null };
        row.stoppedAt = Date.now();
        heartbeatFailStreak.delete(row.id);
        changed = true;
      }
      continue;
    }
    const ok = await probeServeHealth(row);
    if (ok) {
      heartbeatFailStreak.delete(row.id);
      row.lastHealthyAt = Date.now();
      if (row.status === 'unhealthy') {
        row.status = 'running';
        changed = true;
      }
      continue;
    }
    const fails = (heartbeatFailStreak.get(row.id) ?? 0) + 1;
    heartbeatFailStreak.set(row.id, fails);
    if (fails >= HEARTBEAT_FAILS_TO_UNHEALTHY && row.status !== 'unhealthy') {
      row.status = 'unhealthy';
      changed = true;
    }
  }
  if (changed) await commitServes('heartbeat');
}

/**
 * Live llama.cpp row whose `--alias` / libraryId / filename matches `modelId`.
 * When several match, the most recently used wins.
 * @param {string} modelId
 * @returns {Promise<ServeRecord | null>}
 */
export async function findLiveLlamaCppServeForModel(modelId) {
  return findLiveServeForRuntime('llama-cpp', modelId);
}

/**
 * Live MLX row whose libraryId / snapshot path / label matches `modelId`.
 * When several match, the most recently used wins.
 * @param {string} modelId
 * @returns {Promise<ServeRecord | null>}
 */
export async function findLiveMlxServeForModel(modelId) {
  return findLiveServeForRuntime('mlx-lm', modelId);
}

/**
 * @param {'llama-cpp' | 'mlx-lm'} runtime
 * @param {string} modelId
 * @returns {Promise<ServeRecord | null>}
 */
async function findLiveServeForRuntime(runtime, modelId) {
  await loadServes();
  const live = servesCache.filter(
    (row) => row.runtime === runtime && isLiveServeStatus(row.status),
  );
  const id = String(modelId ?? '').trim();
  const matches = live.filter((row) => {
    if (serveMatchesModelId(row, id)) return true;
    // MLX completions key on the absolute snapshot directory; a picker id
    // `mlx:repo` will not match basename/stem, so also accept a path hit.
    if (runtime === 'mlx-lm' && row.modelPath && row.modelPath === id) return true;
    return false;
  });
  if (matches.length === 0) return null;
  let best = matches[0];
  for (const row of matches) {
    if ((row.lastUsedAt ?? 0) > (best.lastUsedAt ?? 0)) best = row;
  }
  return best;
}

/**
 * Bump LRU clock. In-memory only — committing every completion would flood serve SSE.
 * @param {string} serveId
 * @param {number} [at]
 */
export async function touchServeLastUsedAt(serveId, at = Date.now()) {
  await loadServes();
  const row = servesCache.find((s) => s.id === serveId);
  if (!row) return false;
  row.lastUsedAt = at;
  return true;
}

/** Most recently TTL-evicted llama.cpp snapshot (JIT), or null. */
export function getLastTtlEviction() {
  return lastTtlEviction;
}

/** Peek the in-memory row (restartCount / lastHealthyAt are not on publicServe). */
export function peekServeRowForTests(serveId) {
  return servesCache.find((s) => s.id === serveId) ?? null;
}

/** Mutate a live row so crash tests can set lastHealthyAt without waiting 30s. */
export function patchServeRowForTests(serveId, patch) {
  const row = servesCache.find((s) => s.id === serveId);
  if (!row) return null;
  Object.assign(row, patch);
  return row;
}

/** Test helper */
export async function resetServesForTests() {
  for (const unsub of llamaRunUnsubs.values()) {
    try {
      unsub();
    } catch {
      /* ignore */
    }
  }
  llamaRunUnsubs.clear();
  for (const handle of pendingRestarts.values()) handle.cancelled = true;
  pendingRestarts.clear();
  heartbeatFailStreak.clear();
  userStoppingServeIds.clear();
  lastTtlEviction = null;
  serveCommitListeners.clear();
  stopServeHeartbeat();
  stopAllServeActivity();
  if (typeof mlxCrashUnsub === 'function') {
    try {
      mlxCrashUnsub();
    } catch {
      /* ignore */
    }
  }
  mlxCrashUnsub = null;
  servesCache = [];
  loaded = false;
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
  restartDelayMs = AUTO_RESTART_DELAY_MS;
  resetServeBackgroundRunOverrideForTests();
  resetServeHealthOverrideForTests();
  resetMlxWarmupOverrideForTests();
  resetServeReachabilityProbeOverrideForTests();
  resetSubscribeRunOverrideForTests();
  resetSubscribeServerStateOverrideForTests();
  resetServeHeartbeatProbeOverrideForTests();
  resetServePidAliveOverrideForTests();
  resetClassifyServeExitOverrideForTests();
}
