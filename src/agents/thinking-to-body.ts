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
 * - `anthropic-v1`: `providerOptions.anthropic.thinking` (`enabled` + `budgetTokens`,
 *   `adaptive` + `effort`, or omit when off) per model family.
 * - `llama-cpp-local`: per-request `thinking_budget_tokens` (never CLI `--reasoning-budget`).
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
  /** True when a provider-native per-request budget was applied. */
  nativeBudgetApplied?: boolean;
}

const LM_STUDIO_BEST_EFFORT: ThinkingBodyHint = {
  bestEffort: true,
  message:
    'LM Studio may ignore API reasoning controls and use per-model Inference settings instead.',
};

const ANTHROPIC_BUDGET_FLOOR = 1024;

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

/** Default extended-thinking token budgets for Anthropic `enabled` mode. */
const ANTHROPIC_BUDGET_BY_EFFORT: Record<'low' | 'medium' | 'high', number> = {
  low: 2048,
  medium: 10240,
  high: 32768,
};

function anthropicUsesAdaptiveThinking(
  modelCapabilities?: ModelCapabilities | null,
): boolean {
  return modelCapabilities?.reasoningThinkingEnabledValue === 'adaptive';
}

function resolveAnthropicBudgetTokens(
  effort: 'low' | 'medium' | 'high' | undefined,
  explicitBudget?: number | null,
): number {
  if (explicitBudget != null && explicitBudget > 0) {
    return Math.max(ANTHROPIC_BUDGET_FLOOR, explicitBudget);
  }
  if (effort && isLevelEffort(effort)) {
    return ANTHROPIC_BUDGET_BY_EFFORT[effort];
  }
  return ANTHROPIC_BUDGET_BY_EFFORT.medium;
}

function anthropicThinkingPatch(
  thinking: Record<string, unknown>,
  effort?: 'low' | 'medium' | 'high',
  explicitBudget?: number | null,
): ThinkingCompletionPatch {
  const anthropic: Record<string, unknown> = { thinking };
  if (effort && thinking.type === 'adaptive') {
    anthropic.effort = effort;
  }
  const nativeBudgetApplied =
    thinking.type === 'enabled' &&
    explicitBudget != null &&
    explicitBudget > 0;
  if (thinking.type === 'enabled') {
    const budgetTokens = resolveAnthropicBudgetTokens(effort, explicitBudget);
    thinking = { ...thinking, budgetTokens };
    anthropic.thinking = thinking;
  }
  return {
    body: { providerOptions: { anthropic } },
    nativeBudgetApplied,
  };
}

/**
 * Partial completion body for explicit reasoning effort (header dropdown send path).
 */
export function reasoningEffortToCompletionBody(
  effort: ReasoningEffortOption,
  apiKind: ApiKind,
  modelCapabilities?: ModelCapabilities | null,
  budgetTokens?: number | null,
): ThinkingCompletionPatch {
  if (reasoningBlocked(effort, modelCapabilities)) {
    return { body: {} };
  }

  const enabledValue = modelCapabilities?.reasoningThinkingEnabledValue ?? 'enabled';

  if (apiKind === 'anthropic-v1') {
    if (effort === 'off') {
      return { body: {} };
    }

    if (anthropicUsesAdaptiveThinking(modelCapabilities)) {
      if (effort === 'on') {
        return anthropicThinkingPatch({ type: 'adaptive' });
      }
      if (isLevelEffort(effort)) {
        return anthropicThinkingPatch({ type: 'adaptive' }, effort);
      }
      return anthropicThinkingPatch({ type: 'adaptive' });
    }

    if (isLevelEffort(effort)) {
      return anthropicThinkingPatch(
        { type: 'enabled' },
        effort,
        budgetTokens,
      );
    }

    return anthropicThinkingPatch(
      { type: 'enabled' },
      'medium',
      budgetTokens,
    );
  }

  if (apiKind === 'openai-v1') {
    if (effort === 'off') {
      return { body: { thinking: { type: 'disabled' } } };
    }

    const body: Record<string, unknown> = {};
    if (budgetTokens != null && budgetTokens > 0) {
      body.thinking_budget_tokens = budgetTokens;
    }

    if (isLevelEffort(effort)) {
      body.reasoning_effort = effort;
      const allowed = modelCapabilities?.reasoningAllowedOptions;
      if (allowed?.some((option) => isLevelEffort(option))) {
        body.reasoning = { effort };
      }
      if (enabledValue === 'adaptive') {
        body.thinking = { type: 'adaptive' };
      }
      return { body };
    }

    body.thinking = { type: enabledValue };
    return { body };
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
  budgetTokens?: number | null,
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

  if (apiKind === 'anthropic-v1') {
    if (resolved === 'off') {
      return { body: {} };
    }

    if (anthropicUsesAdaptiveThinking(modelCapabilities)) {
      return anthropicThinkingPatch({ type: 'adaptive' });
    }

    return anthropicThinkingPatch({ type: 'enabled' }, 'medium', budgetTokens);
  }

  if (apiKind === 'openai-v1') {
    if (resolved === 'off') {
      return { body: { thinking: { type: 'disabled' } } };
    }
    const enabledValue = modelCapabilities?.reasoningThinkingEnabledValue ?? 'enabled';
    const body: Record<string, unknown> = { thinking: { type: enabledValue } };
    if (budgetTokens != null && budgetTokens > 0) {
      body.thinking_budget_tokens = budgetTokens;
    }
    return { body };
  }

  const effort = effortForResolved(resolved);
  const body: Record<string, unknown> = {
    reasoning_effort: effort,
    reasoning: { effort },
    enable_thinking: resolved === 'on',
  };

  return { body, hint: LM_STUDIO_BEST_EFFORT };
}
