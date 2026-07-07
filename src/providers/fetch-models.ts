/**
 * Fetch model list for a resolved provider (direct or proxy).
 */

import type { LmModelRecord } from '../types';
import { resolveProviderEndpoints } from './resolve';
import type { ProviderPublic } from './types';

/** Normalize provider model rows to LM Studio-shaped records for modelCache. */
export function normalizeModelsForUi(
  apiKind: ProviderPublic['apiKind'],
  data: LmModelRecord[],
): LmModelRecord[] {
  return data.map((m) => ({
    id: m.id,
    type: m.type || (apiKind === 'openai-v1' || apiKind === 'anthropic-v1' ? 'llm' : m.type),
    state: m.state || (apiKind === 'openai-v1' || apiKind === 'anthropic-v1' ? 'loaded' : m.state),
    arch: m.arch,
    quantization: m.quantization,
    max_context_length: m.max_context_length,
    loaded_context_length: m.loaded_context_length,
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(m.catalogVision !== undefined ? { catalogVision: m.catalogVision } : {}),
  }));
}

/**
 * GET models for provider; returns filtered llm/vlm rows.
 */
export async function fetchModelsForProvider(
  provider: ProviderPublic,
  signal: AbortSignal,
): Promise<LmModelRecord[]> {
  const endpoints = resolveProviderEndpoints(provider);
  const res = await fetch(endpoints.modelsUrl, { signal, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: LmModelRecord[] };
  const raw = json.data || [];
  const normalized = normalizeModelsForUi(provider.apiKind, raw);
  return normalized.filter((m) => m.type === 'llm' || m.type === 'vlm');
}
