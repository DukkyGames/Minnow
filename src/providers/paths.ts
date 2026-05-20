/**
 * Default upstream paths per apiKind (overridable on provider profile).
 */

import type { ApiKind, ProviderPublic } from './types';

export interface ProviderPathOverrides {
  modelsPath?: string;
  chatCompletionsPath?: string;
  modelsLoadPath?: string;
  modelsUnloadPath?: string;
}

/** Map apiKind to default LM Studio v0 or OpenAI v1 paths. */
export function getDefaultPaths(
  apiKind: ApiKind,
  overrides: ProviderPathOverrides = {},
): {
  modelsPath: string;
  chatCompletionsPath: string;
  modelsLoadPath?: string;
  modelsUnloadPath?: string;
} {
  const defaults =
    apiKind === 'openai-v1'
      ? { modelsPath: '/v1/models', chatCompletionsPath: '/v1/chat/completions' }
      : {
          modelsPath: '/api/v0/models',
          chatCompletionsPath: '/api/v0/chat/completions',
          modelsLoadPath: '/api/v1/models/load',
          modelsUnloadPath: '/api/v1/models/unload',
        };

  const out = {
    modelsPath: overrides.modelsPath || defaults.modelsPath,
    chatCompletionsPath: overrides.chatCompletionsPath || defaults.chatCompletionsPath,
  };

  if ('modelsLoadPath' in defaults && defaults.modelsLoadPath) {
    return {
      ...out,
      modelsLoadPath: overrides.modelsLoadPath || defaults.modelsLoadPath,
      modelsUnloadPath: overrides.modelsUnloadPath || defaults.modelsUnloadPath,
    };
  }

  return out;
}

/** Paths for a stored provider profile. */
export function pathsForProvider(provider: ProviderPublic): {
  modelsPath: string;
  chatCompletionsPath: string;
  modelsLoadPath?: string;
  modelsUnloadPath?: string;
} {
  return getDefaultPaths(provider.apiKind, {
    modelsPath: provider.modelsPath,
    chatCompletionsPath: provider.chatCompletionsPath,
    modelsLoadPath: provider.modelsLoadPath,
    modelsUnloadPath: provider.modelsUnloadPath,
  });
}
