/**
 * Apply resolved thinking mode to a chat completion body and surface LM Studio hints.
 */

import { modelUsesComposerReasoningDropdown } from '../lib/reasoning-effort';
import type { ProviderPublic } from '../providers/types';
import type { ModelCapabilities, ReasoningEffortOption } from '../types';
import { setStatus } from '../ui/status';
import {
  markLmStudioThinkingHintShown,
  reasoningEffortToCompletionBody,
  thinkingToCompletionBody,
  wasLmStudioThinkingHintShown,
} from './thinking-to-body';
import type { ThinkingResolvedMode } from './thinking-types';

/** Merge provider-specific thinking fields into an outbound completion body. */
export function mergeThinkingIntoCompletionBody<T extends Record<string, unknown>>(
  body: T,
  resolved: ThinkingResolvedMode,
  provider: Pick<ProviderPublic, 'apiKind'>,
  modelCapabilities?: ModelCapabilities | null,
  reasoningEffort?: ReasoningEffortOption | null,
): T {
  const useEffortDropdown = modelUsesComposerReasoningDropdown(modelCapabilities);
  const patch =
    useEffortDropdown && reasoningEffort
      ? reasoningEffortToCompletionBody(reasoningEffort, provider.apiKind, modelCapabilities)
      : thinkingToCompletionBody(resolved, provider.apiKind, modelCapabilities);
  Object.assign(body, patch.body);
  if (
    patch.hint?.bestEffort &&
    provider.apiKind === 'lm-studio-v0' &&
    !wasLmStudioThinkingHintShown()
  ) {
    markLmStudioThinkingHintShown();
    setStatus('ok', patch.hint.message);
  }
  return body;
}
