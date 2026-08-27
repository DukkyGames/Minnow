/**
 * Background capability probe on first load of a local model (MIN-671).
 *
 * Settings → Providers "Probe models" is the manual path. Catalog refresh
 * never probes. The first time Minnow sees a local model actually loaded —
 * and the catalog has not already flagged vision — we run the same matrix
 * probe so VLMs without `type: vlm` / `catalogVision` / a heuristic id still
 * get a Vision badge.
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
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from './types';

export type FirstLoadProbeRunner = typeof runCapabilityProbeForProvider;

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
    // Node tests should not keep the process alive for an empty queue.
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      timer.unref();
    }
  });
}

function probeKey(providerId: string, modelId: string): string {
  return `${providerId}\0${modelId}`;
}

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
 * Loaded local rows only. openai-v1 catalogs default `state: 'loaded'` even for
 * cloud lists, and mlx-lm `/v1/models` lists the hub cache — neither is a load.
 */
export function isFirstLoadProbeCandidate(
  providerId: string,
  row: LmModelRecord,
  lmStudioProviderIds: Set<string>,
): boolean {
  if (!isModelLoaded(row.state)) return false;
  if (providerId === LIBRARY_MODEL_PROVIDER_ID) return true;
  if (providerId === LLAMA_CPP_LOCAL_PROVIDER_ID) return true;
  return lmStudioProviderIds.has(providerId);
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
            // Manual probe owned the slot, or storage is local-only — retry later.
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
          // Hard failure stays in seenKeys so catalog refresh cannot hammer the runtime.
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

/**
 * After modelCache is filled from a catalog fetch, probe loaded local models
 * that still have unknown vision. No-ops in Vite-only (localStorage) mode.
 */
export function scheduleFirstLoadCapabilityProbes(results?: ProviderModelsResult[]): void {
  if (!isServerStorageMode()) return;

  const lmStudioIds = collectLmStudioProviderIds(results);
  for (const [key, row] of modelCache.entries()) {
    const decoded = decodeModelSelectKey(key);
    if (!decoded) continue;
    if (!isFirstLoadProbeCandidate(decoded.providerId, row, lmStudioIds)) continue;
    if (!modelNeedsFirstLoadCapabilityProbe(row)) continue;
    enqueueFirstLoadProbe(decoded.providerId, decoded.modelId);
  }

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