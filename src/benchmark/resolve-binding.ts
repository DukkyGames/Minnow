/**
 * Resolve provider + model for benchmark runs (same source as composer send).
 */

import { getActiveProvider } from '../providers/store';
import type { ProviderPublic } from '../providers/types';

export interface BenchmarkBinding {
  providerId: string;
  modelId: string;
  provider: ProviderPublic;
}

/** Active top-bar model select value, matching tools/loop send path. */
export function getActiveModelIdFromDom(): string {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  return sel?.value?.trim() ?? '';
}

/** Provider + model used for the next benchmark completion. */
export async function resolveBenchmarkBinding(): Promise<BenchmarkBinding> {
  const provider = await getActiveProvider();
  const modelId = getActiveModelIdFromDom();
  if (!modelId) {
    throw new Error('No model selected. Load a model in the top bar before running Benchmark.');
  }
  return {
    providerId: provider.id,
    modelId,
    provider,
  };
}
