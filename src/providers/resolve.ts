/**
 * Resolve active provider to models/chat URLs (direct vs proxy).
 */

import { parseServerBaseUrl } from '../lib/parse-server-base-url';
import { providerSupportsModelLoadUnload } from './capabilities';
import { pathsForProvider } from './paths';
import type { ProviderEndpoints, ProviderPublic } from './types';

/** Build fetch targets for models list and chat completions. */
export function resolveProviderEndpoints(provider: ProviderPublic): ProviderEndpoints {
  const paths = pathsForProvider(provider);
  const supportsLoadUnload = providerSupportsModelLoadUnload(provider);

  if (provider.connectionMode === 'proxy') {
    const encoded = encodeURIComponent(provider.id);
    const endpoints: ProviderEndpoints = {
      provider,
      mode: 'proxy',
      modelsUrl: `/api/providers/${encoded}/models`,
      chatUrl: `/api/providers/${encoded}/chat/completions`,
    };
    if (supportsLoadUnload && paths.modelsLoadPath && paths.modelsUnloadPath) {
      endpoints.modelsLoadUrl = `/api/providers/${encoded}/models/load`;
      endpoints.modelsUnloadUrl = `/api/providers/${encoded}/models/unload`;
    }
    return endpoints;
  }

  const base = parseServerBaseUrl(provider.baseUrl);
  if (!base) {
    throw new Error('Invalid provider base URL');
  }

  const endpoints: ProviderEndpoints = {
    provider,
    mode: 'direct',
    modelsUrl: `${base}${paths.modelsPath}`,
    chatUrl: `${base}${paths.chatCompletionsPath}`,
  };
  if (supportsLoadUnload && paths.modelsLoadPath && paths.modelsUnloadPath) {
    endpoints.modelsLoadUrl = `${base}${paths.modelsLoadPath}`;
    endpoints.modelsUnloadUrl = `${base}${paths.modelsUnloadPath}`;
  }
  return endpoints;
}
