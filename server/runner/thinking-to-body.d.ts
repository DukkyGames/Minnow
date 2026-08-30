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
 *   o-series/gpt-5, Qwen3.8); elsewhere the template's `enable_thinking` is the whole
 *   switch and the effort is inert. Inert, though — not harmful — so the composer
 *   still offers levels for bare local catalogs rather than guessing from the id.
 * - Qwen3.8: composer High maps to wire `xhigh`; thinking-on also sends
 *   `preserve_thinking` (LM Studio custom field, or `chat_template_kwargs` on local).
 */
import type { ApiKind } from './provider-ids.js';
import type { ModelCapabilities, ReasoningEffortOption } from '../../src/types.js';
import type { ThinkingResolvedMode } from './thinking-types.js';
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
/** Whether the one-shot LM Studio hint was already shown this session. */
export declare function wasLmStudioThinkingHintShown(): boolean;
export declare function markLmStudioThinkingHintShown(): void;
/** Reset hint flag (tests). */
export declare function resetLmStudioThinkingHint(): void;
/**
 * Partial completion body for explicit reasoning effort (header dropdown send path).
 */
export declare function reasoningEffortToCompletionBody(effort: ReasoningEffortOption, apiKind: ApiKind, modelCapabilities?: ModelCapabilities | null, budgetTokens?: number | null, modelId?: string | null): ThinkingCompletionPatch;
/**
 * Partial completion body for thinking control.
 * Returns empty body when model capabilities explicitly disable reasoning and mode is on.
 */
export declare function thinkingToCompletionBody(resolved: ThinkingResolvedMode, apiKind: ApiKind, modelCapabilities?: ModelCapabilities | null, budgetTokens?: number | null, modelId?: string | null): ThinkingCompletionPatch;
