/**
 * Models workbench store — one source of truth for the library, running serves,
 * downloads, and the inspector selection.
 *
 * My Models, Local Server, and the inspector all render from this, so loading a
 * model in one surface is visible in the others without a refetch.
 */

import { selectProviderModel } from '../../api/models';
import {
  isLibraryModelProviderId,
  LIBRARY_MODEL_PROVIDER_ID,
} from '../../models/model-select-library';
import {
  getLibrarySamplerForId,
  saveLibraryInferenceSampler,
} from '../../config/library-inference-meta';
import { getLibraryLaunchSettingsForId } from '../../config/library-launch-meta';
import {
  cancelModelDownload,
  fetchCachedModels,
  fetchInstalledModels,
  fetchRuntimes,
  listModelServes,
  startModelDownload,
  fetchLlamaRuntime,
  startModelServe,
  stopModelServe,
  subscribeDownloadProgress,
  subscribeServeEvents,
  subscribeServeLog,
  type ServeActivity,
  type DownloadJob,
  type LlamaServeSettings,
  type ModelDownloadFormat,
  type RuntimeDetection,
  type ServeRecord,
} from '../../models/api-client';
import { fetchHardware } from '../../models/hardware-client';
import { subscribeServeActivityFeed } from '../../models/serve-activity-feed';
import { activeServeFor, buildLibrary, type LibraryModel } from '../../models/library';
import { isLiveServeStatus, isRetryableServeStatus, settingsForServeRetry } from '../../models/serve-status';
import { foldServeLogEvent, parseLoadProgress } from '../../models/serve-log';
import { computeLoadProgress, formatLoadPercentLabel, resolveBytesPerMs } from '../../models/load-progress.mjs';
import type { HardwareSnapshot } from '../../models/types';

/** Live loading state for a serve that started asynchronously. */
export interface LoadProgress {
  serveId: string;
  modelId: string | null;
  /**
   * 0–100, monotonic. Null only for the sub-second window before the first tick,
   * when there is genuinely nothing to draw. llama.cpp prints no percentage of its
   * own, so this is modelled — see `src/models/load-progress.mjs`.
   */
  percent: number | null;
  phase: string;
  /** Stable phase id (`weights`, `context`, …) for anything that must not match on prose. */
  phaseKey: string;
  /** Predicted milliseconds remaining, or null when no rate prior applies. */
  etaMs: number | null;
  /** Weights being loaded, when known — the denominator of the time model. */
  bytesTotal: number | null;
  startedAt: number;
  error: string | null;
}

export interface ModelsState {
  library: LibraryModel[];
  serves: ServeRecord[];
  /**
   * Live `/slots` telemetry by serve id. Reflects every client hitting the runtime,
   * not just Minnow's own chat — that is the whole point of polling it server-side.
   */
  activity: Map<string, ServeActivity>;
  downloads: DownloadJob[];
  runtimes: RuntimeDetection | null;
  hardware: HardwareSnapshot | null;
  selectedId: string | null;
  /** Local Server card under inspection; bind by serve id, not library path. */
  selectedServeId: string | null;
  loads: LoadProgress[];
  scanning: boolean;
  error: string | null;
}

const state: ModelsState = {
  library: [],
  serves: [],
  activity: new Map(),
  downloads: [],
  runtimes: null,
  hardware: null,
  selectedId: null,
  selectedServeId: null,
  loads: [],
  scanning: false,
  error: null,
};

type Listener = (snapshot: ModelsState) => void;
const listeners = new Set<Listener>();
const logUnsubs = new Map<string, () => void>();
/** Latest log text per tracked load — the ticker re-reads it without a new SSE event. */
const loadLogText = new Map<string, string>();
/** Elapsed ms on the last compute tick, for skipped-phase catch-up. */
const loadLastElapsedMs = new Map<string, number>();
/** Redraw cadence for in-flight loads. */
const LOAD_TICK_MS = 250;
/** @type {number | null} handle for the in-flight-load ticker. */
let loadTicker: number | null = null;
/**
 * Rolling bytes-per-ms for the installed llama.cpp variant, from the runtime status.
 * Fetched once; it only changes after a load completes, and a stale value costs an ETA
 * that is slightly off, not a wrong bar.
 */
let variantLoadRate = 0;
let variantLoadRateFetched = false;
const downloadUnsubs = new Map<string, () => void>();
let refreshInFlight: Promise<void> | null = null;
/** Batches high-frequency download byte updates to one store notification per frame. */
let emitRaf: number | null = null;
let serveEventsUnsub: (() => void) | null = null;
let serveActivityUnsub: (() => void) | null = null;
/** RAF handle coalescing a burst of activity samples into one repaint. */
let activityEmitRaf: number | null = null;

function scheduleActivityEmit(): void {
  if (activityEmitRaf != null) return;
  activityEmitRaf = requestAnimationFrame(() => {
    activityEmitRaf = null;
    emit();
  });
}
let serveReconcileTimer: number | null = null;
/** Fallback when SSE drops — keep this slow; live updates come from commitServes. */
const SERVE_RECONCILE_MS = 15_000;

function scheduleEmit(): void {
  if (emitRaf != null) return;
  emitRaf = window.requestAnimationFrame(() => {
    emitRaf = null;
    emit();
  });
}

function emitNow(): void {
  if (emitRaf != null) {
    window.cancelAnimationFrame(emitRaf);
    emitRaf = null;
  }
  emit();
}

/** Current snapshot. Treat as read-only. */
export function getModelsState(): ModelsState {
  return state;
}

export function subscribeModelsStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of [...listeners]) listener(state);
}

/** Currently selected library row. */
export function getSelectedModel(): LibraryModel | null {
  if (!state.selectedId) return null;
  return state.library.find((m) => m.id === state.selectedId) ?? null;
}

export function selectModel(id: string | null): void {
  if (state.selectedId === id) return;
  state.selectedId = id;
  if (id) {
    const model = state.library.find((m) => m.id === id);
    const serve = model ? serveForModel(model) : undefined;
    state.selectedServeId = serve?.id ?? null;
  } else {
    state.selectedServeId = null;
  }
  emit();
}

/**
 * Library row for a serve: exact path, then the load's model id.
 * Name matching is how JIT path mismatch used to no-op the card click — skip it.
 */
export function libraryModelForServe(serve: ServeRecord): LibraryModel | undefined {
  if (serve.modelPath) {
    const want = normalizeServePath(serve.modelPath);
    const byPath = state.library.find((m) => m.path && normalizeServePath(m.path) === want);
    if (byPath) return byPath;
  }
  const load = state.loads.find((l) => l.serveId === serve.id);
  if (load?.modelId) {
    const byId = state.library.find((m) => m.id === load.modelId);
    if (byId) return byId;
  }
  return undefined;
}

function normalizeServePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** Serve the inspector is bound to (Local Server card click). */
export function getInspectedServe(): ServeRecord | undefined {
  if (!state.selectedServeId) return undefined;
  return state.serves.find((s) => s.id === state.selectedServeId);
}

/** Select a serve for the inspector. Repeat clicks keep the inspector open. */
export function selectServe(serveId: string): void {
  state.selectedServeId = serveId;
  const serve = state.serves.find((s) => s.id === serveId);
  const model = serve ? libraryModelForServe(serve) : undefined;
  // Clear the library selection when this serve has no row (JIT path mismatch)
  // so render() opens the serve-only inspector instead of the previous model.
  state.selectedId = model?.id ?? null;
  emit();
}

/** Serve currently holding a library row (live, or crashed/error for Retry). */
export function serveForModel(model: LibraryModel): ServeRecord | undefined {
  return (
    activeServeFor(model, state.serves) ??
    state.serves.find(
      (s) =>
        (s.status === 'crashed' || s.status === 'unhealthy' || s.status === 'error') &&
        (model.path
          ? s.modelPath === model.path
          : s.modelLabel === model.repoId || s.modelLabel === model.name),
    )
  );
}

/** In-flight load for a library row, if any. */
export function loadForModel(model: LibraryModel): LoadProgress | undefined {
  const serve = serveForModel(model);
  return state.loads.find((l) => l.modelId === model.id || (serve && l.serveId === serve.id));
}

export function runningServes(): ServeRecord[] {
  return state.serves.filter((s) => isLiveServeStatus(s.status));
}

/**
 * Models header copy while a local serve is starting.
 * Empty percent stays "Loading" so we never print a stuck 0%.
 */
export function formatModelsHeaderLoadingLabel(loads: LoadProgress[] = state.loads): string {
  const live = loads.filter((l) => !l.error);
  for (const load of live) {
    const pct = formatLoadPercentLabel(load.percent);
    if (pct) return `Loading ${pct}`;
  }
  return 'Loading';
}

/**
 * Switch to Local Server when the user is already in Models. JIT load from
 * Code must not yank them out of the chat.
 */
function revealLocalServerIfModelsActive(): void {
  void import('../../os/instances').then(({ getForegroundAppId }) => {
    if (getForegroundAppId() !== 'models') return;
    void import('../models-page').then((m) => m.openModels('server'));
  });
}

/** Crashed / error / unhealthy rows the Local Server list should still show. */
export function attentionServes(): ServeRecord[] {
  return state.serves.filter(
    (s) => s.status === 'crashed' || s.status === 'unhealthy' || s.status === 'error',
  );
}

/**
 * Refresh library, serves, downloads, and runtimes.
 * Concurrent callers share one in-flight pass.
 */
export function refreshModels(options?: { hardware?: boolean; fresh?: boolean }): Promise<void> {
  if (refreshInFlight && !options?.fresh) return refreshInFlight;

  state.scanning = true;
  state.error = null;
  emit();

  refreshInFlight = (async () => {
    try {
      const [cached, installed, serves, runtimes] = await Promise.all([
        fetchCachedModels(),
        fetchInstalledModels().catch(() => ({ artifacts: [], downloads: [] as DownloadJob[] })),
        listModelServes().catch(() => [] as ServeRecord[]),
        fetchRuntimes().catch(() => null),
      ]);

      state.library = await buildLibrary(cached);
      state.downloads = installed.downloads;
      state.serves = serves;
      state.runtimes = runtimes;
      state.error = null;
      ensureServeListWatch();

      if (state.selectedId) {
        const selected = state.library.find((m) => m.id === state.selectedId);
        if (!selected || !selected.servable) state.selectedId = null;
      }
      // Resume tracking work that was still in flight when the app reopened.
      for (const serve of serves) {
        if (serve.status === 'starting' && !logUnsubs.has(serve.id)) {
          trackLoad(serve, null);
        }
      }
      for (const job of state.downloads) {
        if (job.status === 'queued' || job.status === 'running') trackDownload(job);
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : 'Failed to scan local models.';
    } finally {
      state.scanning = false;
      emit();
    }
  })();

  const settled = refreshInFlight.finally(() => {
    refreshInFlight = null;
  });

  if (options?.hardware !== false && !state.hardware) {
    void fetchHardware({ fresh: options?.fresh })
      .then((hw) => {
        state.hardware = hw;
        emit();
      })
      .catch(() => {
        /* hardware panel degrades to unknown */
      });
  }

  return settled;
}

/** Re-probe hardware (used by the Discover rescan control). */
export async function refreshHardware(): Promise<void> {
  try {
    state.hardware = await fetchHardware({ fresh: true });
  } catch {
    /* keep the previous snapshot */
  }
  emit();
}

function stopTracking(serveId: string): void {
  logUnsubs.get(serveId)?.();
  logUnsubs.delete(serveId);
  loadLogText.delete(serveId);
  loadLastElapsedMs.delete(serveId);
}

function updateLoad(serveId: string, patch: Partial<LoadProgress>): void {
  const entry = state.loads.find((l) => l.serveId === serveId);
  if (!entry) return;
  Object.assign(entry, patch);
  emit();
}

function applyServes(serves: ServeRecord[]): void {
  state.serves = serves;
  for (const serve of serves) {
    if (serve.status === 'starting' && !logUnsubs.has(serve.id)) {
      trackLoad(serve, null);
    }
    void settleTrackedLoad(serve);
  }
  emit();
}

function upsertServe(serve: ServeRecord): void {
  const index = state.serves.findIndex((s) => s.id === serve.id);
  if (index >= 0) state.serves[index] = serve;
  else state.serves.unshift(serve);
}

function ensureServeListWatch(): void {
  if (!serveEventsUnsub) {
    serveEventsUnsub = subscribeServeEvents((payload) => {
      applyServes(payload.serves);
    });
  }
  if (!serveActivityUnsub) {
    serveActivityUnsub = subscribeServeActivityFeed((activity) => {
      state.activity.set(activity.serveId, activity);
      // A busy slot ticks every ~400 ms per serve. Coalesce into one frame so
      // telemetry cannot thrash the whole models page.
      scheduleActivityEmit();
    });
  }
  if (serveReconcileTimer == null) {
    serveReconcileTimer = window.setInterval(() => {
      void listModelServes()
        .then(applyServes)
        .catch(() => {
          /* SSE is the live path; this is only a reconciling fallback */
        });
    }, SERVE_RECONCILE_MS);
  }
}

/**
 * When an async load leaves `starting`, bind the picker (running) or surface
 * the error/crash on the load card. Driven by SSE, not a 1s poll.
 */
async function settleTrackedLoad(next: ServeRecord): Promise<void> {
  const load = state.loads.find((l) => l.serveId === next.id);
  if (!load || next.status === 'starting') return;

  if (next.status === 'running') {
    const modelId = load.modelId;
    // Paint 100 on this tick so the last modelled frame is not ~35% when
    // /health wins the race against the log follow.
    const logText = loadLogText.get(next.id) ?? '';
    const elapsedMs = Date.now() - load.startedAt;
    const done = computeLoadProgress({
      logText,
      elapsedMs,
      weightsBytes: load.bytesTotal ?? 0,
      bytesPerMs: bytesPerMsForLoad(load.modelId, next),
      previousPercent: load.percent,
      lastElapsedMs: loadLastElapsedMs.get(next.id) ?? null,
      reportedPercent: parseLoadProgress(logText),
      runtime: next.runtime,
      healthy: true,
    });
    updateLoad(next.id, {
      percent: done.percent,
      phase: done.label,
      phaseKey: done.phaseKey,
      etaMs: 0,
    });
    stopTracking(next.id);
    state.loads = state.loads.filter((l) => l.serveId !== next.id);
    if (isLibraryModelProviderId(next.providerId) && modelId?.trim()) {
      await selectProviderModel(LIBRARY_MODEL_PROVIDER_ID, modelId).catch(() => false);
    } else {
      await selectProviderModel(next.providerId, next.modelLabel).catch(() => false);
    }
    emit();
    return;
  }

  if (isRetryableServeStatus(next.status)) {
    stopTracking(next.id);
    updateLoad(next.id, {
      error:
        next.failure?.title ??
        next.error ??
        (next.status === 'crashed' ? 'Runtime crashed' : 'Model failed to load'),
    });
  }
}

/**
 * Follow an async serve start: stream the log for progress, and let serve SSE
 * (plus a 15s fallback poll) tell us when the row leaves `starting`.
 */
function trackLoad(serve: ServeRecord, modelId: string | null): void {
  const mlx = serve.runtime === 'mlx-lm';
  if (!state.loads.some((l) => l.serveId === serve.id)) {
    state.loads.push({
      serveId: serve.id,
      modelId,
      percent: null,
      phase: mlx ? 'Loading weights' : 'Starting runtime',
      phaseKey: mlx ? 'mlx-weights' : 'spawning',
      etaMs: null,
      bytesTotal: weightsBytesForLoad(serve, modelId),
      startedAt: serve.startedAt || Date.now(),
      error: null,
    });
  }

  if (!logUnsubs.has(serve.id)) {
    logUnsubs.set(
      serve.id,
      subscribeServeLog(serve.id, (event) => {
        // Tail then deltas. Replacing here drops phase markers and freezes the bar.
        loadLogText.set(serve.id, foldServeLogEvent(loadLogText.get(serve.id) ?? '', event));
        recomputeLoad(serve.id);
      }),
    );
  }

  ensureLoadTicker();
  ensureServeListWatch();
  emit();
}

/**
 * Recompute one load's bar from its log tail and the elapsed clock.
 * Cheap and idempotent — the ticker and the log stream both call it.
 */
function recomputeLoad(serveId: string): void {
  const entry = state.loads.find((l) => l.serveId === serveId);
  if (!entry || entry.error) return;
  const logText = loadLogText.get(serveId) ?? '';
  const elapsedMs = Date.now() - entry.startedAt;
  const serve = state.serves.find((s) => s.id === serveId);
  const next = computeLoadProgress({
    logText,
    elapsedMs,
    weightsBytes: entry.bytesTotal ?? 0,
    bytesPerMs: bytesPerMsForLoad(entry.modelId, serve),
    previousPercent: entry.percent,
    lastElapsedMs: loadLastElapsedMs.get(serveId) ?? null,
    reportedPercent: parseLoadProgress(logText),
    runtime: serve?.runtime,
  });
  loadLastElapsedMs.set(serveId, elapsedMs);
  updateLoad(serveId, {
    percent: next.percent,
    phase: next.label,
    phaseKey: next.phaseKey,
    etaMs: next.etaMs,
  });
}

/**
 * Library row for the load bar: launch id, serve.libraryId, then a slash/case
 * normalised path so `E:\Models\...` still finds the GGUF size.
 */
function libraryRowForLoad(serve: ServeRecord, modelId: string | null): LibraryModel | undefined {
  const id = modelId?.trim() || serve.libraryId?.trim() || '';
  if (id) {
    const byId = state.library.find((m) => m.id === id);
    if (byId) return byId;
  }
  if (!serve.modelPath) return undefined;
  const want = normalizeServePath(serve.modelPath);
  return state.library.find((m) => m.path && normalizeServePath(m.path) === want);
}

/**
 * Weights size for the time model. The library row is authoritative; a serve resumed
 * after a restart has no model id, and then we still match on libraryId / path so a
 * 13 GiB extra-folder GGUF is not timed against a 25s clock (35% at Ready).
 */
function weightsBytesForLoad(serve: ServeRecord, modelId: string | null): number | null {
  const row = libraryRowForLoad(serve, modelId);
  return row && row.sizeBytes > 0 ? row.sizeBytes : null;
}

/**
 * Fetch the installed runtime's rolling load rate once. Failure is silent: the bar
 * falls back to stepping between phase floors, which is the pre-prior behaviour.
 */
function ensureVariantLoadRate(): void {
  if (variantLoadRate > 0 || variantLoadRateFetched) return;
  variantLoadRateFetched = true;
  void fetchLlamaRuntime()
    .then((status) => {
      variantLoadRate = Number(status.loadRateBytesPerMs) || 0;
    })
    .catch(() => {
      /* no prior; phase floors still move the bar */
    });
}

/** Per-model prior first, then the rolling per-variant rate from the installed runtime. */
function bytesPerMsForLoad(modelId: string | null, serve?: ServeRecord | null): number {
  const row = serve ? libraryRowForLoad(serve, modelId) : undefined;
  const id = row?.id ?? modelId;
  const saved = id ? getLibraryLaunchSettingsForId(id) : null;
  return resolveBytesPerMs({
    lastLoadMs: saved?.lastLoadMs,
    lastWeightsBytes: saved?.lastWeightsBytes,
    variantBytesPerMs: variantLoadRate,
  });
}

/**
 * ~250 ms redraw while any load is in flight. The server panel otherwise only
 * re-renders on its 5 s elapsed clock, which is far too coarse for a bar.
 */
function ensureLoadTicker(): void {
  ensureVariantLoadRate();
  if (loadTicker != null) return;
  loadTicker = window.setInterval(() => {
    const live = state.loads.filter((l) => !l.error);
    if (!live.length) {
      window.clearInterval(loadTicker as number);
      loadTicker = null;
      return;
    }
    for (const entry of live) recomputeLoad(entry.serveId);
  }, LOAD_TICK_MS);
}

/** Remove a failed load row and stop the underlying serve session. */
export async function dismissLoad(serveId: string): Promise<void> {
  await unloadServe(serveId);
}

/**
 * Start a model. Resolves as soon as the process spawns; readiness arrives
 * through the tracked load.
 */
export async function loadModel(
  model: LibraryModel,
  settings?: LlamaServeSettings,
  options?: { profile?: string },
): Promise<ServeRecord> {
  if (model.source === 'ollama') {
    const serve = await startModelServe({
      modelPath: model.path ?? model.repoId,
      runtime: 'ollama',
      modelLabel: model.repoId,
    });
    upsertServe(serve);
    await selectProviderModel(serve.providerId, serve.modelLabel).catch(() => false);
    const sampler = getLibrarySamplerForId(model.id);
    if (sampler) {
      void saveLibraryInferenceSampler({
        libraryId: model.id,
        sampler,
        aliases: [serve.modelLabel, model.name, model.fileName ?? undefined].filter(
          (value): value is string => Boolean(value?.trim()),
        ),
      }).catch(() => undefined);
    }
    emit();
    return serve;
  }

  if (model.format === 'MLX') {
    if (!model.path) throw new Error('No MLX snapshot directory resolved for this model.');
    const serve = await startModelServe({
      modelPath: model.path,
      runtime: 'mlx-lm',
      // This becomes mlx_lm.server's `model` key, so it has to be the directory,
      // not the repo id: Minnow keeps MLX repos under ~/.minnow/models/artifacts,
      // which is not an HF cache layout, and a repo id would send the server to
      // the Hub instead of the copy already on disk.
      modelLabel: model.path,
      libraryId: model.id,
      quant: model.quant || undefined,
      weightsGb: model.sizeBytes / 1024 ** 3,
      async: true,
    });
    upsertServe(serve);
    trackLoad(serve, model.id);
    revealLocalServerIfModelsActive();
    ensureServeListWatch();
    const mlxSampler = getLibrarySamplerForId(model.id);
    if (mlxSampler) {
      void saveLibraryInferenceSampler({
        libraryId: model.id,
        sampler: mlxSampler,
        aliases: [model.repoId, model.name].filter((value): value is string =>
          Boolean(value?.trim()),
        ),
      }).catch(() => undefined);
    }
    return serve;
  }

  if (!model.path) throw new Error('No weights file resolved for this model.');

  const serve = await startModelServe({
    modelPath: model.path,
    runtime: 'llama-cpp',
    modelLabel: model.name,
    profile: options?.profile,
    quant: model.quant || undefined,
    paramsB: model.paramsB ?? undefined,
    isMoe: model.isMoe,
    weightsGb: model.sizeBytes / 1024 ** 3,
    hardware: (state.hardware as unknown as Record<string, unknown>) ?? undefined,
    llama: settings,
    // Lets startServe merge models.launch.byLibraryId between llama-cpp.json
    // defaults and this body, so picker / CLI loads reuse the last fit_mode.
    libraryId: model.id,
    async: true,
  });

  upsertServe(serve);
  trackLoad(serve, model.id);
  revealLocalServerIfModelsActive();
  ensureServeListWatch();
  const sampler = getLibrarySamplerForId(model.id);
  if (sampler) {
    void saveLibraryInferenceSampler({
      libraryId: model.id,
      sampler,
      aliases: [serve.modelLabel, model.name, model.fileName ?? undefined].filter(
        (value): value is string => Boolean(value?.trim()),
      ),
    }).catch(() => undefined);
  }
  return serve;
}

/** Stop a serve and drop its provider binding. */
export async function unloadServe(serveId: string): Promise<void> {
  stopTracking(serveId);
  state.loads = state.loads.filter((l) => l.serveId !== serveId);
  const next = await stopModelServe(serveId);
  const index = state.serves.findIndex((s) => s.id === next.id);
  if (index >= 0) state.serves[index] = next;
  emit();
  // Picker cache must not stay 'loaded' after eject — refresh so chat ensure sees unload.
  try {
    const { fetchModels } = await import('../../api/models');
    await fetchModels();
  } catch {
    // non-fatal: serve already stopped
  }
}

/**
 * Reload weights after a crash or failed load. Prefers the matching library row
 * so launch prefs apply; falls back to the serve's last path/settings.
 */
export async function retryServe(serve: ServeRecord): Promise<ServeRecord> {
  const model = state.library.find((m) => m.path === serve.modelPath);
  if (model) return loadModel(model, settingsForServeRetry(serve));
  const next = await startModelServe({
    modelPath: serve.modelPath,
    runtime: (serve.runtime as 'llama-cpp' | 'mlx-lm' | 'ollama' | 'lm-studio') || 'llama-cpp',
    modelLabel: serve.modelLabel,
    llama: settingsForServeRetry(
      serve,
      (serve.llamaSettings as LlamaServeSettings | null | undefined) ?? {},
    ),
    async: true,
  });
  upsertServe(next);
  if (next.status === 'starting') {
    trackLoad(next, null);
    if (next.runtime === 'llama-cpp' || next.runtime === 'mlx-lm') {
      revealLocalServerIfModelsActive();
    }
  }
  emit();
  return next;
}

/** Active downloads, newest first. */
export function activeDownloads(): DownloadJob[] {
  return state.downloads.filter(
    (j) => j.status === 'queued' || j.status === 'running' || j.status === 'interrupted',
  );
}

/** Repo ids (and `repo#file` keys) that already exist on disk. */
export function downloadedRepos(): Set<string> {
  const set = new Set<string>();
  for (const model of state.library) {
    set.add(model.repoId);
    const tail = model.repoId.split('/').pop();
    if (tail) set.add(tail);
    if (model.fileName) set.add(`${model.repoId}#${model.fileName}`);
  }
  return set;
}

function trackDownload(job: DownloadJob): void {
  if (downloadUnsubs.has(job.id)) return;
  downloadUnsubs.set(
    job.id,
    subscribeDownloadProgress(job.id, (event) => {
      const row = state.downloads.find((j) => j.id === event.jobId);
      if (row) {
        row.status = event.status;
        row.bytesReceived = event.bytesReceived;
        row.totalBytes = event.totalBytes;
        row.error = event.error ?? null;
        if (event.bytesPerSec != null) row.bytesPerSec = event.bytesPerSec;
        if (event.etaMs != null) row.etaMs = event.etaMs;
        if (event.interrupted != null) row.interrupted = event.interrupted;
        if (event.resumeAt != null) row.resumeAt = event.resumeAt;
      }
      if (event.status === 'completed') {
        downloadUnsubs.get(job.id)?.();
        downloadUnsubs.delete(job.id);
        // New weights on disk — rescan so My Models picks them up.
        void refreshModels({ fresh: true, hardware: false });
        emitNow();
        return;
      }
      if (event.status === 'failed' || event.status === 'cancelled') {
        downloadUnsubs.get(job.id)?.();
        downloadUnsubs.delete(job.id);
        emitNow();
        return;
      }
      scheduleEmit();
    }),
  );
}

/** Queue a Hugging Face download and follow its progress. */
export async function downloadModel(
  repoId: string,
  quant?: string,
  options?: { format?: ModelDownloadFormat; sizeBytes?: number },
): Promise<DownloadJob> {
  const job = await startModelDownload({
    repoId,
    quant,
    format: options?.format,
    sizeBytes: options?.sizeBytes,
  });
  const existing = state.downloads.findIndex((j) => j.id === job.id);
  if (existing >= 0) state.downloads[existing] = job;
  else state.downloads.unshift(job);
  trackDownload(job);
  emit();
  return job;
}

/** Cancel a queued or running download. */
export async function cancelDownload(jobId: string): Promise<void> {
  const job = await cancelModelDownload(jobId);
  const index = state.downloads.findIndex((j) => j.id === job.id);
  if (index >= 0) state.downloads[index] = job;
  downloadUnsubs.get(jobId)?.();
  downloadUnsubs.delete(jobId);
  emit();
}

/** Tear down every poller and stream (called when the app closes). */
export function teardownModelsStore(): void {
  for (const serveId of [...logUnsubs.keys()]) stopTracking(serveId);
  if (loadTicker != null) {
    window.clearInterval(loadTicker);
    loadTicker = null;
  }
  for (const unsub of downloadUnsubs.values()) unsub();
  downloadUnsubs.clear();
  serveEventsUnsub?.();
  serveEventsUnsub = null;
  serveActivityUnsub?.();
  serveActivityUnsub = null;
  if (activityEmitRaf != null) {
    cancelAnimationFrame(activityEmitRaf);
    activityEmitRaf = null;
  }
  state.activity.clear();
  if (serveReconcileTimer != null) {
    window.clearInterval(serveReconcileTimer);
    serveReconcileTimer = null;
  }
}
