/**
 * Strip provider-incompatible completion fields before upstream POST.
 * Server mirror of src/providers/sanitize-completion-body.ts.
 */

import { LLAMA_CPP_LOCAL_ID, MLX_LM_LOCAL_ID } from '../../src/models/runtime-ids.mjs';
import { providerSupportsChatTemplateKwargs } from './provider-host.js';

/**
 * True when OpenAI o-series / gpt-5 models expect max_completion_tokens.
 * @param {string} modelId
 */
function modelUsesMaxCompletionTokens(modelId) {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  if (/^o\d/.test(id)) return true;
  return id.includes('gpt-5');
}

/**
 * True when the body explicitly disables thinking (must survive sanitization).
 * @param {unknown} thinking
 */
function isThinkingExplicitlyDisabled(thinking) {
  if (!thinking || typeof thinking !== 'object') return false;
  return /** @type {{ type?: string }} */ (thinking).type === 'disabled';
}

/**
 * GPT models on OpenCode Zen / OpenAI Responses API reject custom temperature.
 * @param {string} modelId
 */
function modelRejectsTemperature(modelId) {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  if (/^o\d/.test(id)) return true;
  return id.includes('gpt-5');
}

/** Drop Minnow-only message fields that providers reject as unknown. */
function stripInternalApiMessageFields(body) {
  if (!Array.isArray(body.messages)) return body;
  return {
    ...body,
    messages: body.messages.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const msg = { ...raw };
      delete msg.toolImageFollowUp;
      return msg;
    }),
  };
}

/**
 * llama.cpp / mlx-lm accept min_p / top_k / repetition_penalty / enable_thinking.
 * Prefer the persisted flag; fall back to the stable local ids so in-memory
 * tests and generations that only pass `{ id }` still keep those fields.
 * @param {{ id?: string, supportsExtendedSamplers?: boolean }} provider
 */
function providerKeepsExtendedSamplers(provider) {
  if (provider?.supportsExtendedSamplers === true) return true;
  const id = typeof provider?.id === 'string' ? provider.id : '';
  return id === LLAMA_CPP_LOCAL_ID || id === MLX_LM_LOCAL_ID;
}

/**
 * Normalize a chat completion body for the target provider.
 * @param {Record<string, unknown>} body
 * @param {{ apiKind?: string, id?: string, supportsExtendedSamplers?: boolean, baseUrl?: string }} provider
 * @param {{ reasoning?: boolean, reasoningAllowedOptions?: string[] } | null | undefined} [modelCapabilities]
 * @returns {Record<string, unknown>}
 */
export function sanitizeCompletionBodyForProvider(body, provider, modelCapabilities) {
  const providerId = typeof provider.id === 'string' ? provider.id : '';
  if (provider.apiKind !== 'openai-v1') {
    return stripInternalApiMessageFields(body);
  }

  const next = stripInternalApiMessageFields({ ...body });
  const templateKwargsReachModel = providerSupportsChatTemplateKwargs(provider);
  // Hosted OpenAI rejects LM Studio / llama.cpp sampler fields. Local llama.cpp
  // and mlx-lm keep them so min_p actually reaches the serve.
  if (!providerKeepsExtendedSamplers(provider)) {
    delete next.top_k;
    delete next.min_p;
    delete next.repetition_penalty;
  }
  if (!templateKwargsReachModel && !providerKeepsExtendedSamplers(provider)) {
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

  if (/kimi/i.test(modelId) && typeof next.temperature === 'number' && next.temperature !== 1) {
    next.temperature = 1;
  }

  if (/kimi|moonshot/i.test(modelId) && Array.isArray(next.messages)) {
    next.messages = next.messages.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const msg = { ...raw };
      delete msg.reasoning;
      delete msg.reasoning_content;
      delete msg.reasoning_signature;
      return msg;
    });
  }

  if (modelRejectsTemperature(modelId)) {
    delete next.temperature;
    delete next.top_p;
  }

  if (providerId !== LLAMA_CPP_LOCAL_ID) {
    delete next.thinking_budget_tokens;
  }

  // Jinja kwargs reach local runtimes and loopback OpenAI-compatible servers
  // (MTPLX, etc.); hosted cloud APIs reject the unknown field with a 400.
  if (!templateKwargsReachModel) {
    delete next.chat_template_kwargs;
    delete next.preserve_thinking;
  }

  return next;
}
