/**
 * Strip provider-incompatible completion fields before upstream POST.
 */

import { anthropicThinkingTypeFromProviderOptions } from '../lib/anthropic-thinking-style';
import type { ProviderPublic, ApiKind } from './types';
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from './types';
import { providerSupportsChatTemplateKwargs } from './provider-host';
import { resolvedApiForModel } from './resolve-model-api';
import type { ModelCapabilities } from '../types';

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

/** Drop Minnow-only message fields that providers reject as unknown. */
function stripInternalApiMessageFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return body;
  return {
    ...body,
    messages: body.messages.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const msg = { ...(raw as Record<string, unknown>) };
      delete msg.toolImageFollowUp;
      return msg;
    }),
  };
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
  modelApi?: ApiKind,
): Record<string, unknown> {
  const apiKind = modelApi ?? modelCapabilities?.api ?? resolvedApiForModel(provider);
  if (apiKind === 'anthropic-v1') {
    const next = stripInternalApiMessageFields({ ...body });
    if (anthropicThinkingEnabled(next)) {
      delete next.temperature;
      delete next.top_p;
      delete next.top_k;
    }
    return next;
  }

  if (apiKind !== 'openai-v1') {
    return stripInternalApiMessageFields(body);
  }

  const next = stripInternalApiMessageFields({ ...body });
  const templateKwargsReachModel = providerSupportsChatTemplateKwargs(provider);
  delete next.top_k;
  delete next.min_p;
  delete next.repetition_penalty;
  if (!templateKwargsReachModel) {
    delete next.enable_thinking;
  }

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

  // Per-request llama.cpp reasoning budget — only for the local llama-cpp serve provider.
  if (provider.id !== LLAMA_CPP_LOCAL_PROVIDER_ID) {
    delete next.thinking_budget_tokens;
  }

  // Jinja kwargs reach local runtimes and loopback OpenAI-compatible servers
  // (MTPLX, etc.); hosted cloud APIs reject the unknown field with a 400.
  if (!templateKwargsReachModel) {
    delete next.chat_template_kwargs;
    delete next.preserve_thinking;
  }

  // Kimi (Moonshot AI) thinking/code models only accept temperature=1.
  if (/kimi/i.test(modelId) && typeof next.temperature === 'number' && next.temperature !== 1) {
    next.temperature = 1;
  }

  if (/kimi|moonshot/i.test(modelId) && Array.isArray(next.messages)) {
    next.messages = next.messages.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const msg = { ...(raw as Record<string, unknown>) };
      delete msg.reasoning;
      delete msg.reasoning_content;
      delete msg.reasoning_signature;
      return msg;
    });
  }

  return next;
}
