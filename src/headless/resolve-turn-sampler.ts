/**
 * Settings → Sampler for headless / scheduler turns (`minnow run`).
 * Kept off `runner.ts` so tests can import it without the full send loop.
 */

import { resolveSamplerPreset } from '../agents/resolve-sampler';
import { readGlobalSamplerForSend } from '../config/sampler-meta';

/**
 * Same work-agent merge as product chat — not the old 4096 hard cap.
 */
export function resolveHeadlessTurnSampler(agentKey: string | null) {
  return resolveSamplerPreset({
    kind: 'work-agent',
    agentKey,
    global: readGlobalSamplerForSend(),
  });
}
