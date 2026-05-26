/**
 * Multimodal capability test scoring (cap-multimodal).
 */

import { hasNonEmptyCompletion } from '../completion-valid.ts';

export interface MultimodalProbeScore {
  passed: boolean;
  details: string;
}

/** Pass when probe returns non-empty assistant text; otherwise fail with actionable details. */
export function scoreMultimodalProbe(text: string, errorMessage?: string): MultimodalProbeScore {
  if (errorMessage?.trim()) {
    return { passed: false, details: errorMessage.trim().slice(0, 120) };
  }
  if (!hasNonEmptyCompletion(text)) {
    return { passed: false, details: 'empty vision response' };
  }
  return { passed: true, details: text.trim().slice(0, 320) };
}
