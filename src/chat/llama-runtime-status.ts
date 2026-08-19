/**
 * Live runtime detail for a local llama.cpp stream.
 *
 * Two facts arrive on the wire that Minnow used to drop on the floor:
 *
 * - `prompt_progress` (opted into with `return_progress`) carries `total` from the very
 *   first chunk, so prefill genuinely has a percentage. This is the *only* place one
 *   exists — `/slots` reports the same running number as both the part and the whole,
 *   which is why the Loaded Models card shows a token count instead.
 * - `timings` (opted into with `timings_per_token`) carries `predicted_n`, the tokens
 *   generated so far.
 *
 * Pure, so the phrasing is testable without a stream.
 */

import type { LlamaPromptProgress, LlamaTimings } from '../types';

export interface LlamaRuntimeStatusView {
  /** Which stream phase this implies, or null when it implies nothing. */
  phase: 'prompt_processing' | 'generating' | null;
  /** Text for the status row. Empty when there is nothing worth saying. */
  detail: string;
}

const EMPTY: LlamaRuntimeStatusView = { phase: null, detail: '' };

/**
 * @param meta Latest merged stream meta.
 * @param hasOutput True once any prose or reasoning token has been shown — after that
 *   prefill is over regardless of what the last chunk said.
 */
export function llamaRuntimeStatusView(
  meta: { timings?: LlamaTimings; prompt_progress?: LlamaPromptProgress } | null | undefined,
  hasOutput: boolean,
): LlamaRuntimeStatusView {
  if (!meta) return EMPTY;

  const progress = meta.prompt_progress;
  if (!hasOutput && progress && progress.total > 0 && progress.processed < progress.total) {
    // A cached prefix legitimately starts the bar near full. Saying so is friendlier
    // than a bar that appears stuck at 99% for a fraction of a second.
    if (progress.cache > 0 && progress.cache >= progress.processed) {
      return {
        phase: 'prompt_processing',
        detail: `${progress.cache.toLocaleString()} of ${progress.total.toLocaleString()} cached`,
      };
    }
    const percent = Math.min(99, Math.floor((progress.processed / progress.total) * 100));
    return { phase: 'prompt_processing', detail: `${percent}%` };
  }

  const predicted = Number(meta.timings?.predicted_n);
  if (Number.isFinite(predicted) && predicted > 0) {
    return {
      phase: 'generating',
      detail: predicted === 1 ? '1 token' : `${predicted.toLocaleString()} tokens`,
    };
  }

  return EMPTY;
}
