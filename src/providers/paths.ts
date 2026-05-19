/**
 * Default upstream paths per apiKind (overridable on provider profile).
 */

import type { ApiKind, ProviderPublic } from './types';

export interface ProviderPathOverrides {
  modelsPath?: string;
  chatCompletionsPath?: string;
}

/** Map apiKind to default LM Studio v0 or OpenAI v1 paths. */
export function getDefaultPaths(
  apiKind: ApiKind,
  overrides: ProviderPathOverrides = {},
): { modelsPath: string; chatCompletionsPath: string } {
  const defaults =
    apiKind === 'openai-v1'
      ? { modelsPath: '/v1/models', chatCompletionsPath: '/v1/chat/completions' }
      : {
          modelsPath: '/api/v0/models',
          chatCompletionsPath: '/api/v0/chat/completions',
        };

  return {
    modelsPath: overrides.modelsPath || defaults.modelsPath,
    chatCompletionsPath: overrides.chatCompletionsPath || defaults.chatCompletionsPath,
  };
}

/** Paths for a stored provider profile. */
export function pathsForProvider(provider: ProviderPublic): {
  modelsPath: string;
  chatCompletionsPath: string;
} {
  return getDefaultPaths(provider.apiKind, {
    modelsPath: provider.modelsPath,
    chatCompletionsPath: provider.chatCompletionsPath,
  });
}
