/**
 * Resolve active provider to models/chat URLs (direct vs proxy).
 */

import { parseServerBaseUrl } from '../ui/status';
import { pathsForProvider } from './paths';
import type { ProviderEndpoints, ProviderPublic } from './types';

/** Build fetch targets for models list and chat completions. */
export function resolveProviderEndpoints(provider: ProviderPublic): ProviderEndpoints {
  const paths = pathsForProvider(provider);

  if (provider.connectionMode === 'proxy') {
    return {
      provider,
      mode: 'proxy',
      modelsUrl: `/api/providers/${encodeURIComponent(provider.id)}/models`,
      chatUrl: `/api/providers/${encodeURIComponent(provider.id)}/chat/completions`,
    };
  }

  const base = parseServerBaseUrl(provider.baseUrl);
  if (!base) {
    throw new Error('Invalid provider base URL');
  }

  return {
    provider,
    mode: 'direct',
    modelsUrl: `${base}${paths.modelsPath}`,
    chatUrl: `${base}${paths.chatCompletionsPath}`,
  };
}
