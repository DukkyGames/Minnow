/**
 * P10-G (MIN-772) — fold P10-B `stream_meta` / `round_end` into the live
 * metrics types `loop.ts` used to own.
 *
 * `TurnEvent.stream_meta.runtime` is `{ timings, prompt_progress }`, not a
 * status string. Display copy must go through {@link llamaRuntimeStatusView}.
 */

import type { StreamMetaAccumulator } from '../api/chat';
import type { TurnEvent } from '../../server/runner/run-turn';
import type { LlamaPromptProgress, LlamaTimings, Stats, Usage } from '../types';
import {
  llamaRuntimeStatusView,
  type LlamaRuntimeStatusView,
} from './llama-runtime-status';

export type StreamMetaTurnEvent = Extract<TurnEvent, { type: 'stream_meta' }>;
export type RoundEndTurnEvent = Extract<TurnEvent, { type: 'round_end' }>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Narrow runner `usage` blobs onto the chat `Usage` shape. */
export function usageFromTurnEvent(value: unknown): Usage | undefined {
  if (!isPlainObject(value)) return undefined;
  return value as Usage;
}

/** Narrow runner `stats` blobs onto the chat `Stats` shape. */
export function statsFromTurnEvent(value: unknown): Stats | undefined {
  if (!isPlainObject(value)) return undefined;
  return value as Stats;
}

/**
 * P10-B packs llama.cpp `timings` / `prompt_progress` on `runtime`.
 * Ignore strings and other shapes — those are not a status label.
 */
export function llamaRuntimeFromStreamMetaRuntime(
  runtime: unknown,
): { timings?: LlamaTimings; prompt_progress?: LlamaPromptProgress } | undefined {
  if (!isPlainObject(runtime)) return undefined;
  const timings = runtime.timings;
  const promptProgress = runtime.prompt_progress;
  const out: { timings?: LlamaTimings; prompt_progress?: LlamaPromptProgress } = {};
  if (isPlainObject(timings)) out.timings = timings as LlamaTimings;
  if (isPlainObject(promptProgress)) {
    out.prompt_progress = promptProgress as unknown as LlamaPromptProgress;
  }
  if (!out.timings && !out.prompt_progress) return undefined;
  return out;
}

/**
 * Map `stream_meta.runtime` through the llama.cpp status view.
 * A string runtime must not appear as the status detail.
 */
export function runtimeStatusFromStreamMetaRuntime(
  runtime: unknown,
  hasOutput: boolean,
): LlamaRuntimeStatusView {
  return llamaRuntimeStatusView(llamaRuntimeFromStreamMetaRuntime(runtime), hasOutput);
}

/**
 * Merge one throttled `stream_meta` event into the live accumulator.
 * Later chunks win, same as `mergeStreamMeta` on the SSE path.
 */
export function applyStreamMetaEvent(
  acc: StreamMetaAccumulator,
  event: StreamMetaTurnEvent,
): StreamMetaAccumulator {
  const next: StreamMetaAccumulator = { ...acc };
  const usage = usageFromTurnEvent(event.usage);
  if (usage) next.usage = { ...next.usage, ...usage };
  const stats = statsFromTurnEvent(event.stats);
  if (stats) next.stats = { ...next.stats, ...stats };
  if (typeof event.model === 'string' && event.model.trim()) {
    next.model = event.model.trim();
  }
  if (typeof event.finishReason === 'string' && event.finishReason) {
    next.finish_reason = event.finishReason;
  }
  const runtime = llamaRuntimeFromStreamMetaRuntime(event.runtime);
  if (runtime?.timings) next.timings = { ...next.timings, ...runtime.timings };
  if (runtime?.prompt_progress) next.prompt_progress = runtime.prompt_progress;
  return next;
}

/**
 * Build the accumulator `finalizeResponseMeta` expects from a `round_end`.
 * Prefers the live merge (includes timings) and fills gaps from the event.
 */
export function streamMetaFromRoundEnd(
  live: StreamMetaAccumulator,
  event: RoundEndTurnEvent,
): StreamMetaAccumulator {
  const usage = usageFromTurnEvent(event.usage);
  const stats = statsFromTurnEvent(event.stats);
  return {
    ...live,
    ...(usage ? { usage: { ...live.usage, ...usage } } : {}),
    ...(stats ? { stats: { ...live.stats, ...stats } } : {}),
    ...(event.finishReason ? { finish_reason: event.finishReason } : {}),
  };
}
