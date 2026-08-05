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
import {
  cancelModelDownload,
  fetchCachedModels,
  fetchInstalledModels,
  fetchModelServe,
  fetchRuntimes,
  listModelServes,
  startModelDownload,
  startModelServe,
  stopModelServe,
  subscribeDownloadProgress,
  subscribeServeLog,
  type DownloadJob,
  type LlamaServeSettings,
  type ModelDownloadFormat,
  type RuntimeDetection,
  type ServeRecord,
} from '../../models/api-client';
import { fetchHardware } from '../../models/hardware-client';
import { activeServeFor, buildLibrary, type LibraryModel } from '../../models/library';
import { describeLoadPhase, parseLoadProgress } from '../../models/serve-log';
import type { HardwareSnapshot } from '../../models/types';

/** Live loading state for a serve that started asynchronously. */
export interface LoadProgress {
  serveId: string;
  modelId: string | null;
  /** Percent when llama.cpp reported one, otherwise null (indeterminate). */
  percent: number | null;
  phase: string;
  startedAt: number;
  error: string | null;
}

export interface ModelsState {
  library: LibraryModel[];
  serves: ServeRecord[];
  downloads: DownloadJob[];
  runtimes: RuntimeDetection | null;
  hardware: HardwareSnapshot | null;
  selectedId: string | null;
  loads: LoadProgress[];
  scanning: boolean;
  error: string | null;
}

const state: ModelsState = {
  library: [],
  serves: [],
  downloads: [],
  runtimes: null,
  hardware: null,
  selectedId: null,
  loads: [],
  scanning: false,
  error: null,
};

type Listener = (snapshot: ModelsState) => void;
const listeners = new Set<Listener>();
const logUnsubs = new Map<string, () => void>();
const pollTimers = new Map<string, number>();
const downloadUnsubs = new Map<string, () => void>();
let refreshInFlight: Promise<void> | null = null;

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
  emit();
}

/** Serve currently holding a library row. */
export function serveForModel(model: LibraryModel): ServeRecord | undefined {
  return activeServeFor(model, state.serves);
}

/** In-flight load for a library row, if any. */
export function loadForModel(model: LibraryModel): LoadProgress | undefined {
  const serve = serveForModel(model);
  return state.loads.find((l) => l.modelId === model.id || (serve && l.serveId === serve.id));
}

export function runningServes(): ServeRecord[] {
  return state.serves.filter((s) => s.status === 'running' || s.status === 'starting');
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

      if (state.selectedId) {
        const selected = state.library.find((m) => m.id === state.selectedId);
        if (!selected || !selected.servable) state.selectedId = null;
      }
      // Resume tracking work that was still in flight when the app reopened.
      for (const serve of serves) {
        if (serve.status === 'starting' && !pollTimers.has(serve.id)) {
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
  const timer = pollTimers.get(serveId);
  if (timer != null) window.clearInterval(timer);
  pollTimers.delete(serveId);
}

function updateLoad(serveId: string, patch: Partial<LoadProgress>): void {
  const entry = state.loads.find((l) => l.serveId === serveId);
  if (!entry) return;
  Object.assign(entry, patch);
  emit();
}

/**
 * Follow an async serve start: poll status, stream the log for progress, and
 * hand the provider to chat once the model answers.
 */
function trackLoad(serve: ServeRecord, modelId: string | null): void {
  if (!state.loads.some((l) => l.serveId === serve.id)) {
    state.loads.push({
      serveId: serve.id,
      modelId,
      percent: null,
      phase: 'Starting runtime',
      startedAt: Date.now(),
      error: null,
    });
  }

  logUnsubs.set(
    serve.id,
    subscribeServeLog(serve.id, (event) => {
      const percent = parseLoadProgress(event.text);
      updateLoad(serve.id, {
        phase: describeLoadPhase(event.text),
        ...(percent != null ? { percent } : {}),
      });
    }),
  );

  const timer = window.setInterval(() => {
    void fetchModelServe(serve.id)
      .then(async (next) => {
        if (!next) {
          stopTracking(serve.id);
          state.loads = state.loads.filter((l) => l.serveId !== serve.id);
          emit();
          return;
        }
        const index = state.serves.findIndex((s) => s.id === next.id);
        if (index >= 0) state.serves[index] = next;
        else state.serves.unshift(next);

        if (next.status === 'starting') {
          emit();
          return;
        }

        stopTracking(serve.id);
        if (next.status === 'running') {
          state.loads = state.loads.filter((l) => l.serveId !== serve.id);
          if (isLibraryModelProviderId(next.providerId) && modelId?.trim()) {
            await selectProviderModel(LIBRARY_MODEL_PROVIDER_ID, modelId).catch(() => false);
          } else {
            await selectProviderModel(next.providerId, next.modelLabel).catch(() => false);
          }
        } else {
          updateLoad(serve.id, { error: next.error ?? 'Model failed to load' });
        }
        emit();
      })
      .catch(() => {
        /* transient — the next tick retries */
      });
  }, 1_000);

  pollTimers.set(serve.id, timer);
  emit();
}

/** Dismiss a failed load card. */
export function dismissLoad(serveId: string): void {
  stopTracking(serveId);
  state.loads = state.loads.filter((l) => l.serveId !== serveId);
  emit();
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
    state.serves.unshift(serve);
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
    });
    state.serves.unshift(serve);
    // No trackLoad: MLX serves return already running (no spawn progress). Runtime
    // output lives on the shared mlx-lm managed server log, exposed via serve log routes.
    await selectProviderModel(LIBRARY_MODEL_PROVIDER_ID, model.id).catch(() => false);
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
    emit();
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
    async: true,
  });

  state.serves.unshift(serve);
  trackLoad(serve, model.id);
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
}

/** Active downloads, newest first. */
export function activeDownloads(): DownloadJob[] {
  return state.downloads.filter((j) => j.status === 'queued' || j.status === 'running');
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
      }
      if (event.status === 'completed') {
        downloadUnsubs.get(job.id)?.();
        downloadUnsubs.delete(job.id);
        // New weights on disk — rescan so My Models picks them up.
        void refreshModels({ fresh: true, hardware: false });
        return;
      }
      if (event.status === 'failed' || event.status === 'cancelled') {
        downloadUnsubs.get(job.id)?.();
        downloadUnsubs.delete(job.id);
      }
      emit();
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
  for (const serveId of [...pollTimers.keys()]) stopTracking(serveId);
  for (const unsub of downloadUnsubs.values()) unsub();
  downloadUnsubs.clear();
}
