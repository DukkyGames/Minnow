/**
 * Anthropic extended-thinking style by model id (mirrors @ai-sdk/anthropic getModelCapabilities).
 * Newer Claude families require `thinking.type: adaptive` instead of `enabled` + budget_tokens.
 */

/**
 * @param {string | undefined | null} modelId
 * @returns {boolean}
 */
export function anthropicModelUsesAdaptiveThinking(modelId) {
  const id = String(modelId ?? '')
    .trim()
    .toLowerCase();
  if (!id.includes('claude')) return false;

  return (
    id.includes('claude-opus-4-8') ||
    id.includes('claude-opus-4-7') ||
    id.includes('claude-fable-5') ||
    id.includes('claude-sonnet-5') ||
    id.includes('claude-sonnet-4-6') ||
    id.includes('claude-opus-4-6')
  );
}

/**
 * Map legacy enabled-mode budget tokens to adaptive effort when normalizing requests.
 * @param {number | undefined} budgetTokens
 * @returns {'low' | 'medium' | 'high'}
 */
export function anthropicBudgetTokensToEffort(budgetTokens) {
  if (typeof budgetTokens !== 'number' || !Number.isFinite(budgetTokens)) {
    return 'medium';
  }
  if (budgetTokens <= 2048) return 'low';
  if (budgetTokens <= 10240) return 'medium';
  return 'high';
}

/**
 * Normalize providerOptions.anthropic.thinking for models that require adaptive mode.
 * @param {string | undefined} modelId
 * @param {Record<string, Record<string, unknown>> | undefined} providerOptions
 * @returns {Record<string, Record<string, unknown>> | undefined}
 */
export function normalizeAnthropicProviderOptions(modelId, providerOptions) {
  if (!providerOptions?.anthropic) return providerOptions;
  if (!anthropicModelUsesAdaptiveThinking(modelId)) return providerOptions;

  const anthropic = { ...providerOptions.anthropic };
  const thinking = anthropic.thinking;
  if (!thinking || typeof thinking !== 'object') {
    return providerOptions;
  }

  const thinkingRecord = /** @type {Record<string, unknown>} */ (thinking);
  if (thinkingRecord.type !== 'enabled') {
    return providerOptions;
  }

  const budgetRaw = thinkingRecord.budgetTokens ?? thinkingRecord.budget_tokens;
  const budgetTokens = typeof budgetRaw === 'number' ? budgetRaw : undefined;

  anthropic.thinking = { type: 'adaptive' };
  if (!anthropic.effort) {
    anthropic.effort = anthropicBudgetTokensToEffort(budgetTokens);
  }

  return { ...providerOptions, anthropic };
}
