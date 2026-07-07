/**
 * Strip provider-incompatible completion fields before upstream POST.
 */

import { anthropicThinkingTypeFromProviderOptions } from '../lib/anthropic-thinking-style';
import type { ModelCapabilities } from '../types';
import type { ProviderPublic } from './types';

/** True when OpenAI o-series / gpt-5 models expect max_completion_tokens. */
function modelUsesMaxCompletionTokens(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  if (/^o\d/.test(id)) return true;
  return id.includes('gpt-5');
}

function anthropicThinkingEnabled(body: Record<string, unknown>): boolean {
  const providerOptions = body.providerOptions;
  if (providerOptions && typeof providerOptions === 'object') {
    const type = anthropicThinkingTypeFromProviderOptions(
      typeof body.model === 'string' ? body.model : '',
      providerOptions as Record<string, Record<string, unknown>>,
    );
    if (type === 'enabled' || type === 'adaptive') {
      return true;
    }
    if (type === 'disabled') {
      return false;
    }
  }
  const thinking = body.thinking;
  if (!thinking || typeof thinking !== 'object') {
    return false;
  }
  const thinkingType = (thinking as { type?: string }).type;
  return thinkingType === 'enabled' || thinkingType === 'adaptive';
}

/** True when the body explicitly disables thinking (must survive sanitization). */
function isThinkingExplicitlyDisabled(thinking: unknown): boolean {
  if (!thinking || typeof thinking !== 'object') return false;
  return (thinking as { type?: string }).type === 'disabled';
}

/** GPT-5 / o-series on Responses API reject custom temperature. */
function modelRejectsTemperature(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  if (/^o\d/.test(id)) return true;
  return id.includes('gpt-5');
}

/**
 * Normalize a chat completion body for the target provider.
 * openai-v1: drop LM Studio sampler fields, optional thinking, map max_tokens when needed.
 * anthropic-v1: drop sampler fields when extended thinking is active.
 */
export function sanitizeCompletionBodyForProvider(
  body: Record<string, unknown>,
  provider: ProviderPublic,
  modelCapabilities?: ModelCapabilities | null,
): Record<string, unknown> {
  if (provider.apiKind === 'anthropic-v1') {
    const next = { ...body };
    if (anthropicThinkingEnabled(next)) {
      delete next.temperature;
      delete next.top_p;
      delete next.top_k;
    }
    return next;
  }

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
  if (!reasoningSupported) {
    // Keep explicit thinking disable — without it some models stream only to reasoning_content.
    if (!isThinkingExplicitlyDisabled(next.thinking)) {
      delete next.thinking;
    }
    delete next.reasoning;
    delete next.reasoning_effort;
  }

  const modelId = typeof next.model === 'string' ? next.model : '';
  if (typeof next.max_tokens === 'number' && modelUsesMaxCompletionTokens(modelId)) {
    next.max_completion_tokens = next.max_tokens;
    delete next.max_tokens;
  }

  if (modelRejectsTemperature(modelId)) {
    delete next.temperature;
    delete next.top_p;
  }

  // Kimi (Moonshot AI) thinking/code models only accept temperature=1.
  if (/kimi/i.test(modelId) && typeof next.temperature === 'number' && next.temperature !== 1) {
    next.temperature = 1;
  }

  return next;
}
