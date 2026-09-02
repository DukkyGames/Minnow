/**
 * Background capability probe the first time a model is actually in play (MIN-671).
 *
 * Settings → Providers "Probe models" is the manual path. Catalog refresh
 * never probes the whole list. The first time Minnow sees a local model loaded,
 * or a hosted/cloud model the user selected, and the catalog has not already
 * flagged vision — we run the same matrix probe so VLMs without `type: vlm` /
 * `catalogVision` / a heuristic id still get a Vision badge.
 *
 * Hosted openai-v1 / anthropic-v1 catalogs stamp every row `state: 'loaded'`.
 * Auto-probe those only when the model is in use (picker, default, a chat
 * binding) — never the entire OpenRouter-sized catalog.
 */

import { isModelLoaded } from '../api/model-loaded-state';
import { isAnyChatStreaming, modelCache } from '../app-state';
import { isServerStorageMode } from '../config/storage-mode';
import { encodeModelSelectKey, decodeModelSelectKey } from '../lib/model-select-key';
import {
  LIBRARY_MODEL_PROVIDER_ID,
  resolveUpstreamProviderId,
} from '../models/model-select-library';
import type { LmModelRecord } from '../types';
import type { ProviderModelsResult } from './fetch-all-models';
import {
  catalogRowHasVision,
  isManualCapabilityProbeInFlight,
  runCapabilityProbeForProvider,
} from './model-capabilities';
import { getCachedProviderList } from './store';
import { LLAMA_CPP_LOCAL_PROVIDER_ID, MLX_LM_LOCAL_PROVIDER_ID } from './types';

export type FirstLoadProbeRunner = typeof runCapabilityProbeForProvider;

/** Provider + model the user is actually using (not every catalog row). */
export type FirstLoadInUseBinding = { providerId: string; modelId: string };

export type FirstLoadProbeCandidateOptions = {
  /**
   * True when this row is the default, a session chat binding, or the model
   * just picked. Required for hosted catalogs; ignored for local runtimes.
   */
  inUse?: boolean;
};

type QueueJob = {
  key: string;
  providerId: string;
  modelId: string;
};

const queue: QueueJob[] = [];
/** Keys already enqueued, in flight, finished, or failed this session. */
const seenKeys = new Set<string>();
let draining = false;
let drainPromise: Promise<void> | null = null;
let probeRunner: FirstLoadProbeRunner = runCapabilityProbeForProvider;

/** Delay between idle checks while a chat turn occupies the local runtime. */
const IDLE_POLL_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      timer.unref();
    }
  });
}

function probeKey(providerId: string, modelId: string): string {
  return `${providerId}\0${modelId}`;
}

// ── Candidates ───────────────────────────────────────────────────────────────

/**
 * True when this row still needs a live chat probe to learn vision/tools.
 * Skip known VLMs (catalog already flagged them) and rows a probe already settled.
 */
export function modelNeedsFirstLoadCapabilityProbe(row: LmModelRecord): boolean {
  const caps = row.capabilities;
  if (caps?.sources?.vision === 'probe') return false;
  if (caps?.sources?.tools === 'probe') return false;
  if (caps?.sources?.streaming === 'probe') return false;
  if (catalogRowHasVision(row)) return false;
  if (caps?.vision === true) return false;
  return true;
}

/**
 * Map a picker row to the provider the HTTP probe actually talks to.
 * My Models ids are synthetic; llama.cpp / mlx serve under their runtime provider.
 */
export function resolveFirstLoadProbeTarget(
  providerId: string,
  modelId: string,
): { providerId: string; modelId: string } {
  const pid = providerId.trim();
  const mid = modelId.trim();
  if (!pid || !mid) return { providerId: pid, modelId: mid };
  if (pid === LIBRARY_MODEL_PROVIDER_ID) {
    return { providerId: resolveUpstreamProviderId(pid, mid), modelId: mid };
  }
  return { providerId: pid, modelId: mid };
}

/**
 * Local runtimes where `state: 'loaded'` means weights are resident.
 * My Models / llama.cpp / LM Studio — not mlx hub listings, not cloud catalogs.
 */
export function isLocalRuntimeFirstLoadCandidate(
  providerId: string,
  lmStudioProviderIds: Set<string>,
): boolean {
  if (providerId === LIBRARY_MODEL_PROVIDER_ID) return true;
  if (providerId === LLAMA_CPP_LOCAL_PROVIDER_ID) return true;
  return lmStudioProviderIds.has(providerId);
}

/**
 * Whether this catalog row should be auto-probed.
 *
 * Local: only when actually loaded. Hosted/cloud: only when `inUse` — every
 * openai-v1 row looks loaded. mlx-lm `/v1/models` lists the hub cache; a
 * request would load weights, so those rows never auto-probe (My Models
 * serve path still qualifies via `minnow-library`).
 */
export function isFirstLoadProbeCandidate(
  providerId: string,
  row: LmModelRecord,
  lmStudioProviderIds: Set<string>,
  options?: FirstLoadProbeCandidateOptions,
): boolean {
  if (providerId === MLX_LM_LOCAL_PROVIDER_ID) return false;
  if (!isModelLoaded(row.state)) return false;
  if (isLocalRuntimeFirstLoadCandidate(providerId, lmStudioProviderIds)) return true;
  return options?.inUse === true;
}

function collectLmStudioProviderIds(results?: ProviderModelsResult[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of results ?? []) {
    if (entry.provider.apiKind === 'lm-studio-v0') ids.add(entry.provider.id);
  }
  for (const provider of getCachedProviderList()?.providers ?? []) {
    if (provider.apiKind === 'lm-studio-v0') ids.add(provider.id);
  }
  return ids;
}

function cacheRowFor(providerId: string, modelId: string): LmModelRecord | undefined {
  return (
    modelCache.get(encodeModelSelectKey(providerId, modelId)) ??
    modelCache.get(encodeModelSelectKey(LIBRARY_MODEL_PROVIDER_ID, modelId)) ??
    modelCache.get(encodeModelSelectKey(LLAMA_CPP_LOCAL_PROVIDER_ID, modelId))
  );
}

/** True when any alias of this model is already a known VLM or probe-sourced. */
function targetAlreadySettled(providerId: string, modelId: string): boolean {
  const rows = [
    cacheRowFor(providerId, modelId),
    modelCache.get(encodeModelSelectKey(LIBRARY_MODEL_PROVIDER_ID, modelId)),
    modelCache.get(encodeModelSelectKey(LLAMA_CPP_LOCAL_PROVIDER_ID, modelId)),
  ];
  return rows.some((row) => row !== undefined && !modelNeedsFirstLoadCapabilityProbe(row));
}

// ── Queue ────────────────────────────────────────────────────────────────────

function enqueueFirstLoadProbe(providerId: string, modelId: string): void {
  const target = resolveFirstLoadProbeTarget(providerId, modelId);
  if (!target.providerId || !target.modelId) return;
  const key = probeKey(target.providerId, target.modelId);
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  queue.push({ key, providerId: target.providerId, modelId: target.modelId });
}

async function drainFirstLoadProbeQueue(): Promise<void> {
  if (draining) return drainPromise ?? Promise.resolve();
  draining = true;
  const running = (async () => {
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;

        try {
          while (isAnyChatStreaming() || isManualCapabilityProbeInFlight()) {
            await delay(IDLE_POLL_MS);
          }
          if (targetAlreadySettled(job.providerId, job.modelId)) continue;

          const ran = await probeRunner(job.providerId, {
            modelIds: [job.modelId],
            selectedModelId: job.modelId,
          });
          if (!ran) {
            seenKeys.delete(job.key);
            continue;
          }
          void import('../ui/model-select-picker')
            .then((mod) => mod.syncModelSelectPicker())
            .catch(() => undefined);
        } catch (err) {
          const name = err instanceof Error ? err.name : '';
          if (name === 'AbortError') {
            seenKeys.delete(job.key);
          }
        }
      }
    } finally {
      draining = false;
    }
    if (queue.length > 0) await drainFirstLoadProbeQueue();
  })();
  drainPromise = running;
  await running;
}

/** Enqueue one row when it still needs a live matrix probe. */
function maybeEnqueueFirstLoadProbe(
  providerId: string,
  modelId: string,
  row: LmModelRecord,
  lmStudioIds: Set<string>,
  inUse: boolean,
): void {
  if (!isFirstLoadProbeCandidate(providerId, row, lmStudioIds, { inUse })) return;
  if (!modelNeedsFirstLoadCapabilityProbe(row)) return;
  enqueueFirstLoadProbe(providerId, modelId);
}

// ── Schedule ─────────────────────────────────────────────────────────────────

/**
 * After modelCache is filled from a catalog fetch, probe loaded local models
 * and in-use hosted/cloud models that still have unknown vision. No-ops in
 * Vite-only (localStorage) mode.
 *
 * `inUseBindings` is the default, every session chat binding, and any picker
 * selection — not the rest of a hosted catalog.
 */
export function scheduleFirstLoadCapabilityProbes(
  results?: ProviderModelsResult[],
  inUseBindings: readonly FirstLoadInUseBinding[] = [],
): void {
  if (!isServerStorageMode()) return;

  const lmStudioIds = collectLmStudioProviderIds(results);
  const inUseKeys = new Set<string>();
  for (const binding of inUseBindings) {
    const key = encodeModelSelectKey(binding.providerId, binding.modelId);
    if (key) inUseKeys.add(key);
  }

  for (const [key, row] of modelCache.entries()) {
    const decoded = decodeModelSelectKey(key);
    if (!decoded) continue;
    maybeEnqueueFirstLoadProbe(
      decoded.providerId,
      decoded.modelId,
      row,
      lmStudioIds,
      inUseKeys.has(key),
    );
  }

  if (queue.length > 0) void drainFirstLoadProbeQueue();
}

/**
 * Picker / default-model change: probe this one hosted or local row if needed.
 * Same queue as catalog refresh so a Settings click still owns the abort slot.
 */
export function scheduleCapabilityProbeForSelectValue(selectValue: string): void {
  if (!isServerStorageMode()) return;
  const decoded = decodeModelSelectKey(selectValue.trim());
  if (!decoded) return;
  const row = cacheRowFor(decoded.providerId, decoded.modelId);
  if (!row) return;
  maybeEnqueueFirstLoadProbe(
    decoded.providerId,
    decoded.modelId,
    row,
    collectLmStudioProviderIds(),
    true,
  );
  if (queue.length > 0) void drainFirstLoadProbeQueue();
}

/** Test hook: wait until the in-flight drain finishes. */
export async function waitForFirstLoadProbesForTests(): Promise<void> {
  await (drainPromise ?? Promise.resolve());
}

/** Test hook: replace the HTTP probe runner. */
export function setFirstLoadCapabilityProbeRunnerForTests(
  runner: FirstLoadProbeRunner | null,
): void {
  probeRunner = runner ?? runCapabilityProbeForProvider;
}

/** Test hook: drop session queue / seen set. */
export function resetFirstLoadCapabilityProbeStateForTests(): void {
  queue.length = 0;
  seenKeys.clear();
  draining = false;
  drainPromise = null;
  probeRunner = runCapabilityProbeForProvider;
}

/** Test-only: which provider+model keys have been queued this session. */
export function getFirstLoadProbeSeenKeysForTests(): string[] {
  return [...seenKeys];
}