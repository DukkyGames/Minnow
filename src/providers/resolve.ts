/**
 * Resolve active provider to Minnow proxy URLs for models (and load/unload).
 */

import { providerSupportsModelLoadUnload } from './capabilities';
import { pathsForProvider } from './paths';
import type { ProviderEndpoints, ProviderPublic } from './types';

/** Build fetch targets for models list and optional load/unload routes. */
export function resolveProviderEndpoints(provider: ProviderPublic): ProviderEndpoints {
  const paths = pathsForProvider(provider);
  const supportsLoadUnload = providerSupportsModelLoadUnload(provider);
  const encoded = encodeURIComponent(provider.id);

  const endpoints: ProviderEndpoints = {
    provider,
    modelsUrl: `/api/providers/${encoded}/models`,
  };

  if (supportsLoadUnload && paths.modelsLoadPath && paths.modelsUnloadPath) {
    endpoints.modelsLoadUrl = `/api/providers/${encoded}/models/load`;
    endpoints.modelsUnloadUrl = `/api/providers/${encoded}/models/unload`;
  }

  return endpoints;
}
