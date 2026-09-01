/**
 * Synthesize a ServeActivity row for mlx-lm.
 *
 * mlx-lm 0.31.3 has no `/slots` or `requests_deferred`. Local Server chips are
 * Minnow-owned: the in-flight overlay (keepalive prefill + counted deltas) or
 * Ready when idle. External curl against the same host stays Ready.
 */

import type { ServeActivity, ServeActivitySlot, ServeRecord } from './api-client';
import {
  overlayMatchesActivity,
  type InFlightPromptOverlay,
} from './in-flight-prompt';

const IDLE_SLOT: ServeActivitySlot = {
  id: 0,
  taskId: null,
  state: 'idle',
  promptProcessed: 0,
  promptCached: 0,
  decoded: 0,
  remaining: null,
  tokensPerSecond: null,
};

/**
 * One-slot activity for an mlx-lm serve, or null when the serve is not mlx-lm.
 * queued is always 0 — do not invent a deferred gauge.
 */
export function buildMlxServeActivity(
  serve: Pick<ServeRecord, 'id' | 'modelLabel' | 'libraryId' | 'runtime'>,
  overlay: InFlightPromptOverlay | null,
): ServeActivity | null {
  if (serve.runtime !== 'mlx-lm') return null;

  const activity: ServeActivity = {
    serveId: serve.id,
    modelLabel: serve.modelLabel,
    libraryId: serve.libraryId ?? null,
    updatedAt: Date.now(),
    available: true,
    stale: false,
    queued: 0,
    slots: [IDLE_SLOT],
  };

  if (!overlay || !overlayMatchesActivity(activity, overlay)) {
    return activity;
  }

  const predictedN = overlay.predictedN ?? 0;
  const prefill = overlay.total > 0 && overlay.processed < overlay.total;
  if (prefill) {
    activity.slots = [
      {
        ...IDLE_SLOT,
        state: 'prompt',
        promptProcessed: overlay.processed,
        promptCached: overlay.cache,
      },
    ];
    return activity;
  }

  if (predictedN > 0) {
    activity.slots = [
      {
        ...IDLE_SLOT,
        state: 'generating',
        decoded: predictedN,
      },
    ];
  }

  return activity;
}

/** Activity for a loaded card: mlx synthesis, else the /slots sample. */
export function activityForLoadedServe(
  serve: ServeRecord,
  slotsActivity: ServeActivity | undefined,
  overlay: InFlightPromptOverlay | null,
): ServeActivity | undefined {
  return buildMlxServeActivity(serve, overlay) ?? slotsActivity;
}
