/**
 * Apply resolved thinking mode to a chat completion body and surface LM Studio hints.
 */

import { modelUsesComposerReasoningDropdown } from '../lib/reasoning-effort';
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

export interface MergeThinkingResult<T> {
  body: T;
  nativeBudgetApplied: boolean;
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
  options?: { llamaSupportsThinkingBudget?: boolean },
): MergeThinkingResult<T> {
  const apiKind = modelApi ?? modelCapabilities?.api ?? provider.apiKind;
  const useEffortDropdown = modelUsesComposerReasoningDropdown(modelCapabilities);
  const patch =
    useEffortDropdown && reasoningEffort
      ? reasoningEffortToCompletionBody(
          reasoningEffort,
          apiKind,
          modelCapabilities,
          budgetTokens,
        )
      : thinkingToCompletionBody(resolved, apiKind, modelCapabilities, budgetTokens);
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
    patch.hint?.bestEffort &&
    provider.apiKind === 'lm-studio-v0' &&
    !wasLmStudioThinkingHintShown()
  ) {
    markLmStudioThinkingHintShown();
    setStatus('ok', patch.hint.message);
  }
  return { body, nativeBudgetApplied };
}
