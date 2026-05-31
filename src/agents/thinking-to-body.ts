/**
 * Map resolved thinking on/off to provider completion body fields.
 *
 * Provider spike notes (2026-05):
 * - LM Studio often ignores `reasoning_effort` in favor of Inference UI custom fields
 *   (https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/988).
 * - OpenAI-compatible clients may accept `reasoning_effort` or nested `reasoning.effort`.
 * - We send best-effort keys for both lm-studio-v0 and openai-v1; parsing still works when
 *   the provider emits reasoning regardless.
 */

import type { ApiKind } from '../providers/types';
import type { ModelCapabilities } from '../types';
import type { ThinkingResolvedMode } from './thinking-types';

export interface ThinkingBodyHint {
  /** True when upstream may ignore API fields (LM Studio UI custom fields). */
  bestEffort: boolean;
  message: string;
}

export interface ThinkingCompletionPatch {
  body: Record<string, unknown>;
  hint?: ThinkingBodyHint;
}

const LM_STUDIO_BEST_EFFORT: ThinkingBodyHint = {
  bestEffort: true,
  message:
    'LM Studio may ignore API reasoning controls and use per-model Inference settings instead.',
};

let lmStudioHintShown = false;

/** Whether the one-shot LM Studio hint was already shown this session. */
export function wasLmStudioThinkingHintShown(): boolean {
  return lmStudioHintShown;
}

export function markLmStudioThinkingHintShown(): void {
  lmStudioHintShown = true;
}

/** Reset hint flag (tests). */
export function resetLmStudioThinkingHint(): void {
  lmStudioHintShown = false;
}

function effortForResolved(mode: ThinkingResolvedMode): string {
  return mode === 'on' ? 'medium' : 'none';
}

/**
 * Partial completion body for thinking control.
 * Returns empty body when model capabilities explicitly disable reasoning and mode is on.
 */
export function thinkingToCompletionBody(
  resolved: ThinkingResolvedMode,
  apiKind: ApiKind,
  modelCapabilities?: ModelCapabilities | null,
): ThinkingCompletionPatch {
  const allowed = modelCapabilities?.reasoningAllowedOptions;
  if (allowed && allowed.length > 0) {
    const target = resolved;
    if (!allowed.includes(target)) {
      return { body: {} };
    }
  } else if (modelCapabilities?.reasoning === false && resolved === 'on') {
    return { body: {} };
  }

  const effort = effortForResolved(resolved);
  const body: Record<string, unknown> = {
    reasoning_effort: effort,
    reasoning: { effort },
  };

  if (resolved === 'off') {
    body.enable_thinking = false;
  } else {
    body.enable_thinking = true;
  }

  const hint = apiKind === 'lm-studio-v0' ? LM_STUDIO_BEST_EFFORT : undefined;
  return { body, hint };
}
