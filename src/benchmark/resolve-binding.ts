/**
 * Resolve provider + model for benchmark runs (same source as composer send).
 */

import { decodeModelSelectKey } from '../lib/model-select-key';
import { resolveProvider } from '../providers/store.ts';
import { getActiveChat } from '../state/sessions';
import type { ProviderPublic } from '../providers/types.ts';

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
  const chat = getActiveChat();
  const raw = getActiveModelIdFromDom();
  const parsed = decodeModelSelectKey(raw);
  const modelId = parsed?.modelId ?? raw;
  const providerId = parsed?.providerId ?? chat.providerId?.trim();
  if (!modelId) {
    throw new Error('No model selected. Load a model in the top bar before running Benchmark.');
  }
  const provider = await resolveProvider(providerId || undefined);
  return {
    providerId: provider.id,
    modelId,
    provider,
  };
}
