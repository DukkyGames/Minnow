/**
 * Strip provider-incompatible completion fields before upstream POST.
 * Server mirror of src/providers/sanitize-completion-body.ts.
 */

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

/**
 * Normalize a chat completion body for the target provider.
 * @param {Record<string, unknown>} body
 * @param {{ apiKind?: string }} provider
 * @param {{ reasoning?: boolean, reasoningAllowedOptions?: string[] } | null | undefined} [modelCapabilities]
 * @returns {Record<string, unknown>}
 */
export function sanitizeCompletionBodyForProvider(body, provider, modelCapabilities) {
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

  if (/kimi/i.test(modelId) && typeof next.temperature === 'number' && next.temperature !== 1) {
    next.temperature = 1;
  }

  if (modelRejectsTemperature(modelId)) {
    delete next.temperature;
    delete next.top_p;
  }

  return next;
}
