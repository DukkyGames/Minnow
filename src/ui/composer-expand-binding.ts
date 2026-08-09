/**
 * Model binding for the composer prompt expander (routing override + per-chat model).
 */

import type { PromptExpanderConfig } from '../config/prompt-expander-meta';
import { computeEffectivePromptExpanderBinding } from '../settings/model-routing-effective';

export interface ExpandPromptBinding {
  providerId: string;
  modelId: string;
}

/** Resolve expand binding from settings + active chat session (no DOM reads). */
export function resolveExpandPromptBindingFromChat(
  config: PromptExpanderConfig,
  chat: { providerId?: string; modelId?: string },
  fallbackProviderId: string,
): ExpandPromptBinding {
  const effective = computeEffectivePromptExpanderBinding(config, {
    providerId: chat.providerId?.trim() ?? '',
    modelId: chat.modelId?.trim() ?? '',
  });
  const modelId = effective.modelId.trim();
  const providerId = effective.providerId.trim() || fallbackProviderId;
  return { providerId, modelId };
}
