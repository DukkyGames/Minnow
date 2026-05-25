/**
 * Resolve per-model API pricing and compute USD cost from provider usage.
 */

import type { Usage } from '../types';
import type { ModelPricingRates, ProviderPricing } from './types.ts';

const ZERO_RATES: ModelPricingRates = { inputPer1M: 0, outputPer1M: 0 };

/** Normalize rates object; reject negative or non-finite values. */
export function normalizeModelPricingRates(raw: unknown): ModelPricingRates | null {
  if (!raw || typeof raw !== 'object') return null;
  const inputPer1M = Number((raw as ModelPricingRates).inputPer1M);
  const outputPer1M = Number((raw as ModelPricingRates).outputPer1M);
  if (!Number.isFinite(inputPer1M) || !Number.isFinite(outputPer1M)) return null;
  if (inputPer1M < 0 || outputPer1M < 0) return null;
  return { inputPer1M, outputPer1M };
}

/** Validate pricing block shape for API persistence. */
export function normalizeProviderPricing(raw: unknown): ProviderPricing | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as ProviderPricing;
  const out: ProviderPricing = {};
  if (typeof src.currency === 'string' && src.currency.trim()) {
    out.currency = src.currency.trim().toUpperCase();
  }
  const defaultRates = normalizeModelPricingRates(src.default);
  if (defaultRates) out.default = defaultRates;
  if (src.models && typeof src.models === 'object') {
    const models: Record<string, ModelPricingRates> = {};
    for (const [key, value] of Object.entries(src.models)) {
      if (typeof key !== 'string' || !key.trim()) continue;
      const rates = normalizeModelPricingRates(value);
      if (rates) models[key.trim()] = rates;
    }
    if (Object.keys(models).length > 0) out.models = models;
  }
  if (!out.default && !out.models) return null;
  return out;
}

/**
 * Resolution order: exact model → wildcard `*` → default → zeros.
 */
export function resolveModelPricing(
  pricing: ProviderPricing | null | undefined,
  modelId: string,
): ModelPricingRates {
  if (!pricing) return { ...ZERO_RATES };
  const id = modelId.trim();
  const models = pricing.models;
  if (id && models?.[id]) return { ...models[id] };
  if (models?.['*']) return { ...models['*'] };
  if (pricing.default) return { ...pricing.default };
  return { ...ZERO_RATES };
}

/** Extract prompt/completion counts; fall back total_tokens to completion-only. */
export function usageTokenCounts(usage: Usage): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  let total = usage.total_tokens ?? prompt + completion;
  if (total <= 0 && (prompt > 0 || completion > 0)) {
    total = prompt + completion;
  }
  if (prompt <= 0 && completion <= 0 && (usage.total_tokens ?? 0) > 0) {
    return {
      promptTokens: 0,
      completionTokens: usage.total_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    };
  }
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total > 0 ? total : prompt + completion,
  };
}

/** True when at least one token field is present and positive. */
export function hasMeasurableUsage(usage: Usage | undefined | null): boolean {
  if (!usage) return false;
  const { promptTokens, completionTokens, totalTokens } = usageTokenCounts(usage);
  return promptTokens + completionTokens + totalTokens > 0;
}

/**
 * Compute billed USD for a completion.
 * Returns null when pricing is all zeros (local / unset).
 */
export function computeCostUsd(
  usage: Usage,
  rates: ModelPricingRates,
): number | null {
  const { promptTokens, completionTokens } = usageTokenCounts(usage);
  if (promptTokens + completionTokens <= 0 && !(usage.total_tokens && usage.total_tokens > 0)) {
    return null;
  }
  const cost =
    (promptTokens / 1_000_000) * rates.inputPer1M +
    (completionTokens / 1_000_000) * rates.outputPer1M;
  if (!Number.isFinite(cost)) return null;
  if (rates.inputPer1M === 0 && rates.outputPer1M === 0) return null;
  return cost;
}
