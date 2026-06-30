/**
 * Map resolved thinking on/off to provider completion body fields.
 *
 * Provider spike notes (2026-05):
 * - LM Studio often ignores `reasoning_effort` in favor of Inference UI custom fields
 *   (https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/988).
 * - OpenAI-compatible clients may accept `reasoning_effort` or nested `reasoning.effort`.
 * - `lm-studio-v0`: `reasoning_effort`, nested `reasoning.effort`, and `enable_thinking`.
 * - `openai-v1`: nested `thinking.type` (`enabled` / `disabled`); Kimi/Moonshot reject
 *   `enable_thinking` and non-standard `reasoning_effort` values.
 */

import type { ApiKind } from '../providers/types';
import type { ModelCapabilities, ReasoningEffortOption } from '../types';
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

function isLevelEffort(effort: ReasoningEffortOption): effort is 'low' | 'medium' | 'high' {
  return effort === 'low' || effort === 'medium' || effort === 'high';
}

function reasoningBlocked(
  effort: ReasoningEffortOption,
  modelCapabilities?: ModelCapabilities | null,
): boolean {
  if (effort === 'off') return false;
  const allowed = modelCapabilities?.reasoningAllowedOptions;
  if (allowed && allowed.length > 0 && !allowed.includes(effort)) {
    return true;
  }
  if (modelCapabilities?.reasoning === false) {
    return true;
  }
  return false;
}

/**
 * Partial completion body for explicit reasoning effort (header dropdown send path).
 */
export function reasoningEffortToCompletionBody(
  effort: ReasoningEffortOption,
  apiKind: ApiKind,
  modelCapabilities?: ModelCapabilities | null,
): ThinkingCompletionPatch {
  if (reasoningBlocked(effort, modelCapabilities)) {
    return { body: {} };
  }

  const enabledValue = modelCapabilities?.reasoningThinkingEnabledValue ?? 'enabled';

  if (apiKind === 'openai-v1') {
    if (effort === 'off') {
      return { body: { thinking: { type: 'disabled' } } };
    }

    if (isLevelEffort(effort)) {
      const body: Record<string, unknown> = { reasoning_effort: effort };
      const allowed = modelCapabilities?.reasoningAllowedOptions;
      if (allowed?.some((option) => isLevelEffort(option))) {
        body.reasoning = { effort };
      }
      if (enabledValue === 'adaptive') {
        body.thinking = { type: 'adaptive' };
      }
      return { body };
    }

    return { body: { thinking: { type: enabledValue } } };
  }

  if (effort === 'off') {
    return {
      body: {
        enable_thinking: false,
        reasoning_effort: 'none',
      },
      hint: LM_STUDIO_BEST_EFFORT,
    };
  }

  if (effort === 'on') {
    return {
      body: {
        enable_thinking: true,
        reasoning_effort: 'medium',
        reasoning: { effort: 'medium' },
      },
      hint: LM_STUDIO_BEST_EFFORT,
    };
  }

  return {
    body: {
      enable_thinking: true,
      reasoning_effort: effort,
      reasoning: { effort },
    },
    hint: LM_STUDIO_BEST_EFFORT,
  };
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

  // OpenAI-compatible APIs reject `reasoning_effort: "none"`. DeepSeek V3/V4 needs an
  // explicit thinking disable flag or it streams only to `reasoning_content`.
  // Kimi/Moonshot reject `enable_thinking` — use nested `thinking.type` instead.
  // MiniMax rejects `thinking.type: "enabled"` — only allows "adaptive" or "disabled".
  if (apiKind === 'openai-v1') {
    if (resolved === 'off') {
      return { body: { thinking: { type: 'disabled' } } };
    }
    const enabledValue = modelCapabilities?.reasoningThinkingEnabledValue ?? 'enabled';
    return { body: { thinking: { type: enabledValue } } };
  }

  const effort = effortForResolved(resolved);
  const body: Record<string, unknown> = {
    reasoning_effort: effort,
    reasoning: { effort },
    enable_thinking: resolved === 'on',
  };

  return { body, hint: LM_STUDIO_BEST_EFFORT };
}
