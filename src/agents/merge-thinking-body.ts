/**
 * Apply resolved thinking mode to a chat completion body and surface LM Studio hints.
 */

import type { ProviderPublic } from '../providers/types';
import type { ModelCapabilities } from '../types';
import { setStatus } from '../ui/status';
import {
  markLmStudioThinkingHintShown,
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
): T {
  const patch = thinkingToCompletionBody(resolved, provider.apiKind, modelCapabilities);
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
