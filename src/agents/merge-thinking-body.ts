/**
 * Apply resolved thinking mode to a chat completion body and surface LM Studio hints.
 */

import {
  modelUsesComposerReasoningDropdown,
  resolveEffectiveReasoningEffort,
} from '../lib/reasoning-effort';
import type { ProviderPublic, ApiKind } from '../providers/types';
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from '../providers/types';
import type { ModelCapabilities, ReasoningEffortOption } from '../types';
import { setStatus } from '../ui/status';
import {
  markLmStudioThinkingHintShown,
  reasoningEffortToCompletionBody,
  thinkingToCompletionBody,
  wasLmStudioThinkingHintShown,
} from './thinking-to-body';
import type { ThinkingResolvedMode } from './thinking-types';
import { DEFAULT_LLAMA_THINKING_BUDGET_TOKENS } from './thinking-types';

export interface MergeThinkingResult<T> {
  body: T;
  nativeBudgetApplied: boolean;
}

/**
 * Disable thinking/reasoning for short utility completions (git commit message, inline edit, etc.).
 * Ignores chat composer toggles; uses effort `off` for level-based reasoning catalogs.
 */
export function applyUtilityThinkingOff(
  body: Record<string, unknown>,
  provider: Pick<ProviderPublic, 'id' | 'apiKind' | 'autoApi' | 'modelApiOverrides'>,
  modelCapabilities?: ModelCapabilities | null,
  modelApi?: ApiKind,
): void {
  mergeThinkingIntoCompletionBody(
    body,
    'off',
    provider,
    modelCapabilities,
    'off',
    modelApi,
  );
}

/** Merge provider-specific thinking fields into an outbound completion body. */
export function mergeThinkingIntoCompletionBody<T extends Record<string, unknown>>(
  body: T,
  resolved: ThinkingResolvedMode,
  provider: Pick<ProviderPublic, 'id' | 'apiKind' | 'autoApi' | 'modelApiOverrides'>,
  modelCapabilities?: ModelCapabilities | null,
  reasoningEffort?: ReasoningEffortOption | null,
  modelApi?: ApiKind,
  budgetTokens?: number | null,
  options?: { llamaSupportsThinkingBudget?: boolean; modelId?: string },
): MergeThinkingResult<T> {
  const apiKind = modelApi ?? modelCapabilities?.api ?? provider.apiKind;
  const modelId =
    options?.modelId ?? (typeof body.model === 'string' ? body.model : undefined);
  const useEffortDropdown = modelUsesComposerReasoningDropdown(modelCapabilities);
  let effortForSend = reasoningEffort ?? undefined;
  if (useEffortDropdown) {
    if (resolved === 'off') {
      effortForSend = 'off';
    } else {
      effortForSend =
        resolveEffectiveReasoningEffort(
          { reasoningEffort: reasoningEffort ?? undefined },
          modelCapabilities ?? null,
          resolved,
        ) ?? effortForSend;
    }
  }
  const patch =
    useEffortDropdown && effortForSend
      ? reasoningEffortToCompletionBody(
          effortForSend,
          apiKind,
          modelCapabilities,
          budgetTokens,
          modelId,
        )
      : thinkingToCompletionBody(resolved, apiKind, modelCapabilities, budgetTokens, modelId);
  Object.assign(body, patch.body);

  let nativeBudgetApplied = patch.nativeBudgetApplied === true;
  if (
    !nativeBudgetApplied &&
    provider.id === LLAMA_CPP_LOCAL_PROVIDER_ID &&
    options?.llamaSupportsThinkingBudget === true &&
    budgetTokens != null &&
    budgetTokens > 0 &&
    typeof body.thinking_budget_tokens === 'number'
  ) {
    nativeBudgetApplied = true;
  }
  if (
    resolved === 'on' &&
    provider.id === LLAMA_CPP_LOCAL_PROVIDER_ID &&
    options?.llamaSupportsThinkingBudget === true &&
    (budgetTokens == null || budgetTokens <= 0) &&
    typeof (body as Record<string, unknown>).thinking_budget_tokens !== 'number'
  ) {
    (body as Record<string, unknown>).thinking_budget_tokens = DEFAULT_LLAMA_THINKING_BUDGET_TOKENS;
    nativeBudgetApplied = true;
  }

  if (
    patch.hint?.bestEffort &&
    provider.apiKind === 'lm-studio-v0' &&
    !wasLmStudioThinkingHintShown()
  ) {
    markLmStudioThinkingHintShown();
    setStatus('ok', patch.hint.message);
  }
  return { body, nativeBudgetApplied };
}
