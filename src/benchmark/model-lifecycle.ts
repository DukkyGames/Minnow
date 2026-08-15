/**
 * Headless model load/unload for benchmark campaigns (no src/ui imports).
 */

import { isModelLoaded } from '../api/model-loaded-state.ts';
import { fetchModels, loadModel } from '../api/models.ts';
import {
  fetchCachedModels,
  listModelServes,
  startModelServe,
  type ServeRecord,
} from '../models/api-client.ts';
import { activeServeFor, type LibraryModel } from '../models/library.ts';
import {
  isLibraryModelBinding,
  libraryBindingNeedsServeLoad,
  loadableLibraryFromCached,
  resolveServedBindingForLibraryId,
} from '../models/model-select-library.ts';
import {
  beginModelLoadLock,
  endModelLoadLock,
  isModelLoadLockBusy,
} from '../models/load-lock.ts';
import { providerSupportsModelLoadUnload } from '../providers/capabilities.ts';
import { fetchModelsForAllProviders } from '../providers/fetch-all-models.ts';
import { invalidateProviderCache, listProviders } from '../providers/store.ts';
import {
  collectLocalModelTraySnapshot,
  unloadAllLocalModels,
  type LocalModelTrayRow,
  type LocalModelTraySnapshot,
} from '../providers/local-model-tray.ts';
import { detectLocalServer } from '../tools/client.ts';
import { classifyProviderHost } from './capabilities/host-group.ts';
import type { BenchmarkTarget } from './campaign-types.ts';

const POLL_MS = 400;
const SERVE_POLL_MAX_MS = 120_000;

export type BenchmarkTargetLoadKind = 'none' | 'lm-studio' | 'library' | 'skipped';

export interface BenchmarkTargetLoadOutcome {
  /** True when the target is ready to run completions (including no-load cloud targets). */
  loaded: boolean;
  kind: BenchmarkTargetLoadKind;
  effective: { providerId: string; modelId: string };
  skipReason?: string;
  /** Unload only models added during this load (tray snapshot delta). */
  unload?: () => Promise<void>;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForForeignModelLoadLock(signal?: AbortSignal): Promise<void> {
  while (isModelLoadLockBusy()) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    await delay(POLL_MS, signal);
  }
}

function trayRowKey(row: LocalModelTrayRow): string {
  return row.source === 'minnow-serve' ? `serve:${row.id}` : `lm:${row.providerId}:${row.id}`;
}

/** Rows present in `after` but not in `before` (models we loaded for this target). */
export function diffTraySnapshotDelta(
  before: LocalModelTraySnapshot,
  after: LocalModelTraySnapshot,
): LocalModelTrayRow[] {
  const prev = new Set(before.rows.map(trayRowKey));
  return after.rows.filter((row) => !prev.has(trayRowKey(row)));
}

/** Minnow Hosting + LM Studio targets share one VRAM pool — run serially when auto-loading. */
export function isLocalBenchmarkTarget(target: BenchmarkTarget): boolean {
  const band = classifyProviderHost(target.providerId);
  return band === 'minnow-hosting' || band === 'lm-studio';
}

/** When the tool server is down, local targets cannot be auto-loaded for campaigns. */
export function localModelLoadBlockedReason(
  serverUp: boolean,
  target: BenchmarkTarget,
): string | null {
  if (serverUp) return null;
  if (!isLocalBenchmarkTarget(target)) return null;
  return 'Tool server unavailable — cannot load local model';
}

async function modelRowIsLoaded(
  providerId: string,
  modelId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const pid = providerId.trim();
  const mid = modelId.trim();
  if (!pid || !mid) return true;
  const abort = signal ?? new AbortController().signal;
  const { providers } = await listProviders();
  const enabled = providers.filter((p) => p.enabled !== false);
  const results = await fetchModelsForAllProviders(enabled, abort);
  const entry = results.find((r) => r.provider.id === pid);
  if (!entry) return false;
  const row = entry.models.find((m) => m.id === mid);
  if (!row) return false;
  return isModelLoaded(row.state);
}

async function findLibraryModel(libraryId: string): Promise<LibraryModel | null> {
  const cached = await fetchCachedModels();
  const library = await loadableLibraryFromCached(cached);
  return library.find((m) => m.id === libraryId.trim()) ?? null;
}

async function waitForLibraryServeRunning(
  model: LibraryModel,
  signal?: AbortSignal,
): Promise<ServeRecord> {
  const started = Date.now();
  while (Date.now() - started < SERVE_POLL_MAX_MS) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const serves = await listModelServes().catch(() => [] as ServeRecord[]);
    const serve = activeServeFor(model, serves);
    if (serve?.status === 'running') return serve;
    if (serve?.status === 'error') {
      throw new Error(serve.error?.trim() || 'Model failed to load');
    }
    if (serve?.status === 'stopped' && serve.error) {
      throw new Error(serve.error.trim());
    }
    await delay(POLL_MS, signal);
  }
  throw new Error('Timed out waiting for model to load');
}

/** Start a Minnow serve for a library row without touching the Models UI store. */
async function loadLibraryModelHeadless(
  libraryId: string,
  signal?: AbortSignal,
): Promise<void> {
  const model = await findLibraryModel(libraryId);
  if (!model) throw new Error('Model not found in My Models');

  const serves = await listModelServes().catch(() => [] as ServeRecord[]);
  const existing = activeServeFor(model, serves);
  if (existing?.status === 'running') return;

  if (model.format === 'MLX') {
    if (!model.path) throw new Error('No MLX snapshot directory resolved for this model.');
    await startModelServe({
      modelPath: model.path,
      runtime: 'mlx-lm',
      modelLabel: model.path,
    });
    await waitForLibraryServeRunning(model, signal);
    return;
  }

  if (!model.path) throw new Error('No weights file resolved for this model.');

  const serve = await startModelServe({
    modelPath: model.path,
    runtime: 'llama-cpp',
    modelLabel: model.name,
    quant: model.quant || undefined,
    paramsB: model.paramsB ?? undefined,
    isMoe: model.isMoe,
    weightsGb: model.sizeBytes / 1024 ** 3,
    async: true,
  });

  const started = Date.now();
  while (Date.now() - started < SERVE_POLL_MAX_MS) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const next = await listModelServes().catch(() => [] as ServeRecord[]);
    const row = next.find((s) => s.id === serve.id);
    if (row?.status === 'running') return;
    if (row?.status === 'error') {
      throw new Error(row.error?.trim() || 'Model failed to load');
    }
    await delay(POLL_MS, signal);
  }
  throw new Error('Timed out waiting for model to load');
}

/**
 * Resolve completions provider/model for a roster target (library rows rewrite after serve).
 */
export async function resolveEffectiveBenchmarkBinding(
  target: BenchmarkTarget,
  signal?: AbortSignal,
): Promise<{ providerId: string; modelId: string }> {
  const pid = target.providerId.trim();
  const mid = target.modelId.trim();
  if (!isLibraryModelBinding(pid, mid)) {
    return { providerId: pid, modelId: mid };
  }

  const abort = signal ?? new AbortController().signal;
  const cached = await fetchCachedModels();
  const library = await loadableLibraryFromCached(cached);
  const serves = await listModelServes().catch(() => [] as ServeRecord[]);
  const { providers } = await listProviders();
  const enabled = providers.filter((p) => p.enabled !== false);
  const providerModels = await fetchModelsForAllProviders(enabled, abort);

  const served = resolveServedBindingForLibraryId(mid, library, serves, providerModels);
  if (served) return served;
  return { providerId: pid, modelId: mid };
}

function skipOutcome(
  target: BenchmarkTarget,
  skipReason: string,
): BenchmarkTargetLoadOutcome {
  return {
    loaded: false,
    kind: 'skipped',
    effective: { providerId: target.providerId, modelId: target.modelId },
    skipReason,
  };
}

/**
 * Load the target model when needed; returns skip metadata on failure (never throws for load errors).
 */
export async function ensureBenchmarkTargetLoaded(
  target: BenchmarkTarget,
  signal?: AbortSignal,
): Promise<BenchmarkTargetLoadOutcome> {
  const pid = target.providerId.trim();
  const mid = target.modelId.trim();
  const effectiveBase = { providerId: pid, modelId: mid };

  const serverUp = await detectLocalServer();
  const blocked = localModelLoadBlockedReason(serverUp, target);
  if (blocked) {
    return skipOutcome(target, blocked);
  }

  if (isLibraryModelBinding(pid, mid)) {
    if (!serverUp) {
      return skipOutcome(target, 'Tool server unavailable — cannot load My Models row');
    }

    const cached = await fetchCachedModels();
    const library = await loadableLibraryFromCached(cached);
    const serves = await listModelServes().catch(() => [] as ServeRecord[]);
    const needsLoad = libraryBindingNeedsServeLoad(mid, library, serves);

    if (!needsLoad) {
      const effective = await resolveEffectiveBenchmarkBinding(target, signal);
      return { loaded: true, kind: 'none', effective };
    }

    const before = await collectLocalModelTraySnapshot(signal);
    try {
      await waitForForeignModelLoadLock(signal);
      beginModelLoadLock('benchmark', 'load');
      try {
        await loadLibraryModelHeadless(mid, signal);
        invalidateProviderCache();
        await fetchModels();
      } finally {
        endModelLoadLock('benchmark');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return skipOutcome(target, message || 'Failed to load model');
    }

    const after = await collectLocalModelTraySnapshot(signal);
    const delta = diffTraySnapshotDelta(before, after);
    const effective = await resolveEffectiveBenchmarkBinding(target, signal);
    if (isLibraryModelBinding(effective.providerId, effective.modelId)) {
      return skipOutcome(target, 'Model loaded but upstream binding could not be resolved');
    }

    return {
      loaded: true,
      kind: 'library',
      effective,
      unload: async () => {
        if (delta.length) await unloadAllLocalModels(delta);
      },
    };
  }

  const { providers } = await listProviders();
  const provider = providers.find((p) => p.id === pid && p.enabled !== false);
  if (!provider || !providerSupportsModelLoadUnload(provider)) {
    return { loaded: true, kind: 'none', effective: effectiveBase };
  }

  if (await modelRowIsLoaded(pid, mid, signal)) {
    return { loaded: true, kind: 'none', effective: effectiveBase };
  }

  if (!serverUp) {
    return skipOutcome(target, 'Tool server unavailable — cannot load model into VRAM');
  }

  const before = await collectLocalModelTraySnapshot(signal);
  try {
    await waitForForeignModelLoadLock(signal);
    beginModelLoadLock('benchmark', 'load');
    try {
      await loadModel(mid, pid);
    } finally {
      endModelLoadLock('benchmark');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return skipOutcome(target, message || 'Failed to load model');
  }

  const after = await collectLocalModelTraySnapshot(signal);
  const delta = diffTraySnapshotDelta(before, after);
  return {
    loaded: true,
    kind: 'lm-studio',
    effective: effectiveBase,
    unload: async () => {
      if (delta.length) await unloadAllLocalModels(delta);
    },
  };
}
