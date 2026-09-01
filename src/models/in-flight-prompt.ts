/**
 * In-flight llama.cpp `prompt_progress` from a Minnow-owned completion.
 *
 * `/slots` has no prompt total, so Local Server can only show a prefill percent
 * when this overlay is live. External `curl` traffic keeps an honest token count.
 */

import type { LlamaPromptProgress } from '../types';
import type { ServeActivity } from './api-client';

export interface InFlightPromptOverlay {
  serveId: string | null;
  libraryId: string | null;
  modelLabel: string;
  processed: number;
  total: number;
  cache: number;
  /** Live generated-token count; 0 during prefill. */
  predictedN: number;
}

let overlay: InFlightPromptOverlay | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* one bad consumer must not kill the rest */
    }
  }
}

/** Current overlay, or null when Minnow is not pre-filling a prompt. */
export function getInFlightPromptOverlay(): InFlightPromptOverlay | null {
  return overlay;
}

export function setInFlightPromptOverlay(next: InFlightPromptOverlay | null): void {
  overlay = next;
  emit();
}

export function subscribeInFlightPromptOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when this serve's busy slot is the Minnow completion that published the overlay. */
export function overlayMatchesActivity(
  activity: ServeActivity,
  current: InFlightPromptOverlay | null,
): boolean {
  if (!current) return false;
  if (current.serveId && current.serveId === activity.serveId) return true;
  if (current.libraryId && activity.libraryId && current.libraryId === activity.libraryId) {
    return true;
  }
  // Chat may publish the library id or the served label as modelLabel.
  if (current.modelLabel && activity.libraryId && current.modelLabel === activity.libraryId) {
    return true;
  }
  if (current.libraryId && activity.modelLabel && current.libraryId === activity.modelLabel) {
    return true;
  }
  if (current.modelLabel && activity.modelLabel && current.modelLabel === activity.modelLabel) {
    return true;
  }
  return false;
}

/**
 * Publish overlay from a stream chunk. Keepalive / `prompt_progress` updates
 * the prefill fraction; `timings.predicted_n` (real or synthesized) updates
 * the live GEN count. Callers clear on stream end.
 */
export function publishInFlightPromptFromMeta(
  meta: {
    prompt_progress?: LlamaPromptProgress;
    timings?: { predicted_n?: number };
  } | null | undefined,
  modelId: string,
): void {
  const progress = meta?.prompt_progress;
  const predictedN = Number(meta?.timings?.predicted_n);
  const hasProgress = Boolean(progress && progress.total > 0);
  const hasGen = Number.isFinite(predictedN) && predictedN > 0;
  if (!hasProgress && !hasGen) return;

  setInFlightPromptOverlay({
    serveId: overlay?.serveId ?? null,
    libraryId: modelId,
    modelLabel: modelId,
    processed: hasProgress && progress ? progress.processed : (overlay?.processed ?? 0),
    total: hasProgress && progress ? progress.total : (overlay?.total ?? 0),
    cache: hasProgress && progress ? progress.cache : (overlay?.cache ?? 0),
    predictedN: hasGen ? predictedN : (overlay?.predictedN ?? 0),
  });
}

/** Drop the overlay when the Minnow-owned stream ends. */
export function clearInFlightPromptOverlay(): void {
  if (!overlay) return;
  setInFlightPromptOverlay(null);
}
