/**
 * Provider capability helpers (model load/unload).
 */

import type { ApiKind, ProviderPublic } from './types';

/** Whether the active provider exposes LM Studio v1 load/unload. */
export function providerSupportsModelLoadUnload(provider: ProviderPublic): boolean {
  if (provider.supportsModelLoadUnload !== undefined) {
    return provider.supportsModelLoadUnload === true;
  }
  return defaultSupportsModelLoadUnload(provider.apiKind);
}

/** Default load/unload support by apiKind. */
export function defaultSupportsModelLoadUnload(apiKind: ApiKind): boolean {
  return apiKind === 'lm-studio-v0';
}
