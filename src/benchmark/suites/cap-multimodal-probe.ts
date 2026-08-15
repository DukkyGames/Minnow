/**
 * Headless cap-multimodal probe (shared by capability suite and matrix delegation).
 */

import { buildMultimodalProbeMessages } from '../fixtures/multimodal-probe.ts';
import { runOneShot, type OneShotResult } from '../llm-driver.ts';
import type { BenchmarkRunContext } from '../types.ts';
import { scoreMultimodalProbe, type MultimodalProbeScore } from './cap-multimodal.ts';

export interface CapMultimodalProbeRun {
  oneShot: OneShotResult;
  scored: MultimodalProbeScore;
}

/** Run the deterministic multimodal image probe against the active model. */
export async function runCapMultimodalProbe(ctx: BenchmarkRunContext): Promise<CapMultimodalProbeRun> {
  try {
    const oneShot = await runOneShot({
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      signal: ctx.signal,
      messages: buildMultimodalProbeMessages(),
    });
    const scored = scoreMultimodalProbe(oneShot.text);
    return { oneShot, scored };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const scored = scoreMultimodalProbe('', message);
    return {
      oneShot: {
        text: '',
        contentText: '',
        reasoningText: '',
        toolCalls: [],
        finishReason: 'error',
        timing: {
          ttftMs: 0,
          totalMs: 0,
          tokPerSec: 0,
          usage: {},
          stats: {},
        },
        messages: [],
      },
      scored,
    };
  }
}
