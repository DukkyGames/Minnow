/**
 * Strip provider-incompatible completion fields before upstream POST.
 */

import type { ModelCapabilities } from '../types';
import type { ProviderPublic } from './types';

/** True when OpenAI o-series / gpt-5 models expect max_completion_tokens. */
function modelUsesMaxCompletionTokens(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  if (/^o\d/.test(id)) return true;
  return id.includes('gpt-5');
}

/**
 * Normalize a chat completion body for the target provider.
 * openai-v1: drop LM Studio sampler fields, optional thinking, map max_tokens when needed.
 */
export function sanitizeCompletionBodyForProvider(
  body: Record<string, unknown>,
  provider: ProviderPublic,
  modelCapabilities?: ModelCapabilities | null,
): Record<string, unknown> {
  if (provider.apiKind !== 'openai-v1') {
    return body;
  }

  const next = { ...body };
  delete next.top_k;
  delete next.min_p;
  delete next.repetition_penalty;
  delete next.enable_thinking;

  const reasoningSupported =
    modelCapabilities?.reasoning === true ||
    (modelCapabilities?.reasoningAllowedOptions?.length ?? 0) > 0;
  if (!reasoningSupported && next.thinking !== undefined) {
    delete next.thinking;
  }

  const modelId = typeof next.model === 'string' ? next.model : '';
  if (typeof next.max_tokens === 'number' && modelUsesMaxCompletionTokens(modelId)) {
    next.max_completion_tokens = next.max_tokens;
    delete next.max_tokens;
  }

  return next;
}
