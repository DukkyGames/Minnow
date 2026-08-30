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
 * - Local runtimes, verified against upstream (2026-08):
 *   - `llama-server` reads top-level `reasoning_effort` (`none` disables reasoning,
 *     any other value is handed to the Jinja template) **and** `chat_template_kwargs`.
 *   - `mlx_lm.server` reads **only** `chat_template_kwargs` — `do_POST` stores
 *     `self.body.get("chat_template_kwargs")` and splats it into
 *     `apply_chat_template`; it never reads `reasoning_effort` (mlx-lm 0.31.3
 *     `mlx_lm/server.py`). MTPLX is MLX-native and documents neither.
 *   - So the effort level rides inside `chat_template_kwargs` for every model, not
 *     just Qwen3.8: a top-level-only `reasoning_effort` is invisible to MLX/MTPLX.
 *   Hosted `openai-v1` providers reject unknown fields, so
 *   `sanitizeCompletionBodyForProvider` strips the kwargs everywhere except local.
 * - An effort level only means something to a model *trained* on one (gpt-oss,
 *   o-series/gpt-5, Qwen3.8, GLM-5.3); elsewhere the template's `enable_thinking` is the whole
 *   switch and the effort is inert. Inert, though — not harmful — so the composer
 *   still offers levels for bare local catalogs rather than guessing from the id.
 * - Qwen3.8: composer High maps to wire `xhigh`; thinking-on also sends
 *   `preserve_thinking` (LM Studio custom field, or `chat_template_kwargs` on local).
 * - GLM-5.3 / GLM-5.3-Flash: thinking is always on. Wire effort is `low` | `high` | `max`
 *   (default max). Off / medium / `thinking.type: disabled` are remapped; never sent.
 */

import { isGlm53ModelId, isQwen38ModelId } from '../lib/reasoning-effort';
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

/**
 * Template-level thinking switch for local OpenAI-compatible runtimes.
 * Sanitization drops it for every provider that is not a local serve.
 */
const LOCAL_TEMPLATE_THINKING_OFF = {
  enable_thinking: false,
  chat_template_kwargs: { enable_thinking: false },
} as const;

/** Composer `high` is wire `xhigh` on Qwen3.8 (official Jinja rejects `high`). */
function mapHighEffortForQwen38(effort: string, modelId?: string | null): string {
  if (effort === 'high' && isQwen38ModelId(modelId)) return 'xhigh';
  return effort;
}

/**
 * GLM-5.3 wire effort: `low` | `high` | `max` only.
 * Off / medium / missing → low (cheapest legal). Thinking-on with no level → max.
 */
function glm53WireEffort(
  effort: ReasoningEffortOption | ThinkingResolvedMode | undefined,
): 'low' | 'high' | 'max' {
  if (effort === 'high') return 'high';
  if (effort === 'max') return 'max';
  if (effort === 'low') return 'low';
  if (effort === 'on') return 'max';
  return 'low';
}

/** Always-on GLM-5.3 body: thinking.enabled + a legal reasoning_effort. Never disabled. */
function glm53CompletionPatch(
  effort: ReasoningEffortOption | ThinkingResolvedMode | undefined,
  apiKind: ApiKind,
  budgetTokens?: number | null,
  modelId?: string | null,
): ThinkingCompletionPatch {
  const wireEffort = glm53WireEffort(effort);
  const body: Record<string, unknown> = {
    thinking: { type: 'enabled' },
    reasoning_effort: wireEffort,
    reasoning: { effort: wireEffort },
  };
  if (budgetTokens != null && budgetTokens > 0) {
    body.thinking_budget_tokens = budgetTokens;
  }
  // Local templates still need enable_thinking true; hosted sanitize strips it.
  applyLocalTemplateThinkingOn(body, apiKind, wireEffort, modelId);
  if (apiKind !== 'openai-v1') {
    body.enable_thinking = true;
    return { body, hint: LM_STUDIO_BEST_EFFORT };
  }
  return { body };
}

/** Existing template kwargs on the body, as a fresh object. */
function templateKwargsOf(body: Record<string, unknown>): Record<string, unknown> {
  return body.chat_template_kwargs && typeof body.chat_template_kwargs === 'object'
    ? { ...(body.chat_template_kwargs as Record<string, unknown>) }
    : {};
}

/**
 * Thinking-on fields for runtimes that read the Jinja template kwargs.
 *
 * `chat_template_kwargs` is the only reasoning lever `mlx_lm.server` reads at all,
 * and llama-server reads it too, so both `enable_thinking` and the effort level go
 * there for **every** model — previously only Qwen3.8 got them, which left
 * Low/Medium/High byte-identical on MLX. Extra template variables are inert when a
 * template does not reference them, so this is safe for non-reasoning weights.
 * `preserve_thinking` stays Qwen3.8-only: it is that template's own variable.
 * Sanitization drops all of it for hosted providers, which 400 on unknown fields.
 *
 * @param wireEffort Effort to expose to the template, or undefined for on/off models.
 */
function applyLocalTemplateThinkingOn(
  body: Record<string, unknown>,
  apiKind: ApiKind,
  wireEffort: string | undefined,
  modelId?: string | null,
): void {
  if (apiKind !== 'openai-v1' && apiKind !== 'lm-studio-v0') return;
  // Kimi / Moonshot 400 on `enable_thinking`; thinking.type is their only switch.
  // Sanitization also strips these for hosted providers — this keeps a loopback
  // proxy fronting Moonshot correct too.
  if (/kimi|moonshot/i.test(modelId ?? '')) return;
  const isQwen38 = isQwen38ModelId(modelId);
  if (apiKind === 'lm-studio-v0' && isQwen38) {
    // LM Studio custom field; it ignores API reasoning_effort (lmstudio bug #988).
    body.preserve_thinking = true;
  }
  if (apiKind === 'openai-v1') {
    body.enable_thinking = true;
  }
  body.chat_template_kwargs = {
    ...templateKwargsOf(body),
    enable_thinking: true,
    ...(wireEffort ? { reasoning_effort: wireEffort } : {}),
    ...(isQwen38 ? { preserve_thinking: true } : {}),
  };
}

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

function isWireLevelEffort(
  effort: ReasoningEffortOption,
): effort is 'low' | 'medium' | 'high' | 'max' {
  return isLevelEffort(effort) || effort === 'max';
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
  modelId?: string | null,
): ThinkingCompletionPatch {
  // GLM-5.3 rejects disabled / medium / none — remap before the generic off path.
  if (isGlm53ModelId(modelId)) {
    return glm53CompletionPatch(effort, apiKind, budgetTokens, modelId);
  }

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
      return {
        body: { thinking: { type: 'disabled' }, ...LOCAL_TEMPLATE_THINKING_OFF },
      };
    }

    const body: Record<string, unknown> = {};
    if (budgetTokens != null && budgetTokens > 0) {
      body.thinking_budget_tokens = budgetTokens;
    }

    if (isWireLevelEffort(effort)) {
      const wireEffort = mapHighEffortForQwen38(effort, modelId);
      body.reasoning_effort = wireEffort;
      const allowed = modelCapabilities?.reasoningAllowedOptions;
      if (allowed?.some((option) => isWireLevelEffort(option))) {
        body.reasoning = { effort: wireEffort };
      }
      if (enabledValue === 'adaptive') {
        body.thinking = { type: 'adaptive' };
      }
      applyLocalTemplateThinkingOn(body, apiKind, wireEffort, modelId);
      return { body };
    }

    body.thinking = { type: enabledValue };
    // `thinking.type` alone reaches no local runtime — carry enable_thinking too.
    const onEffort = isQwen38ModelId(modelId) ? 'xhigh' : undefined;
    if (onEffort) body.reasoning_effort = onEffort;
    applyLocalTemplateThinkingOn(body, apiKind, onEffort, modelId);
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
    const wireEffort = isQwen38ModelId(modelId) ? 'xhigh' : 'medium';
    const body: Record<string, unknown> = {
      enable_thinking: true,
      reasoning_effort: wireEffort,
      reasoning: { effort: wireEffort },
    };
    applyLocalTemplateThinkingOn(body, apiKind, wireEffort, modelId);
    return { body, hint: LM_STUDIO_BEST_EFFORT };
  }

  const wireEffort = mapHighEffortForQwen38(effort, modelId);
  const body: Record<string, unknown> = {
    enable_thinking: true,
    reasoning_effort: wireEffort,
    reasoning: { effort: wireEffort },
  };
  applyLocalTemplateThinkingOn(body, apiKind, wireEffort, modelId);
  return { body, hint: LM_STUDIO_BEST_EFFORT };
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
  modelId?: string | null,
): ThinkingCompletionPatch {
  // GLM-5.3 always thinks: off → low, on → max. Never thinking.type disabled.
  if (isGlm53ModelId(modelId)) {
    return glm53CompletionPatch(resolved, apiKind, budgetTokens, modelId);
  }

  const allowed = modelCapabilities?.reasoningAllowedOptions;
  if (allowed && allowed.length > 0) {
    const target = resolved;
    if (!allowed.includes(target)) {
      // Level-only catalogs (off/low/medium/high) — map on/off via effort instead of dropping fields.
      const hasLevels = allowed.some((option) => isWireLevelEffort(option));
      if (target === 'on' && hasLevels) {
        const fallback: ReasoningEffortOption = isQwen38ModelId(modelId) ? 'high' : 'medium';
        return reasoningEffortToCompletionBody(
          fallback,
          apiKind,
          modelCapabilities,
          budgetTokens,
          modelId,
        );
      }
      if (target === 'off' && allowed.includes('off')) {
        return reasoningEffortToCompletionBody(
          'off',
          apiKind,
          modelCapabilities,
          budgetTokens,
          modelId,
        );
      }
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
      return {
        body: { thinking: { type: 'disabled' }, ...LOCAL_TEMPLATE_THINKING_OFF },
      };
    }
    const enabledValue = modelCapabilities?.reasoningThinkingEnabledValue ?? 'enabled';
    const body: Record<string, unknown> = { thinking: { type: enabledValue } };
    if (budgetTokens != null && budgetTokens > 0) {
      body.thinking_budget_tokens = budgetTokens;
    }
    // `thinking.type` alone reaches no local runtime — carry enable_thinking too.
    const onEffort = isQwen38ModelId(modelId) ? 'xhigh' : undefined;
    if (onEffort) body.reasoning_effort = onEffort;
    applyLocalTemplateThinkingOn(body, apiKind, onEffort, modelId);
    return { body };
  }

  const effort =
    resolved === 'on' && isQwen38ModelId(modelId) ? 'xhigh' : effortForResolved(resolved);
  const body: Record<string, unknown> = {
    reasoning_effort: effort,
    reasoning: { effort },
    enable_thinking: resolved === 'on',
  };
  if (resolved === 'on') {
    applyLocalTemplateThinkingOn(body, apiKind, effort, modelId);
  }

  return { body, hint: LM_STUDIO_BEST_EFFORT };
}
