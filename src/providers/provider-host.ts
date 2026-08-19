/**
 * Classify provider base URLs as local (loopback / on-device) vs cloud (remote API).
 */

import {
  LLAMA_CPP_LOCAL_PROVIDER_ID,
  MLX_LM_LOCAL_PROVIDER_ID,
  type ProviderPublic,
} from './types';

/** Built-in provider ids that always resolve to local inference. */
export const KNOWN_LOCAL_PROVIDER_IDS = new Set(['lm-studio-local', 'vite-fallback']);

const BUILTIN_LOCAL_TEMPLATE_KWARGS_IDS = new Set([
  LLAMA_CPP_LOCAL_PROVIDER_ID,
  MLX_LM_LOCAL_PROVIDER_ID,
]);

/** True when the hostname points at loopback inference (LM Studio, Ollama, etc.). */
export function isLocalProviderHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

/** True when the provider base URL targets a loopback host. */
export function isLocalProviderBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!trimmed) return false;
  try {
    return isLocalProviderHostname(new URL(trimmed).hostname);
  } catch {
    return false;
  }
}

/** True for seeded / vite-only provider ids (no registry lookup). */
export function isKnownLocalProviderId(providerId: string): boolean {
  return KNOWN_LOCAL_PROVIDER_IDS.has(providerId.trim());
}

/**
 * True when chat_template_kwargs / enable_thinking may reach the upstream model.
 * Covers Minnow local serves plus loopback OpenAI-compatible runtimes (MTPLX, etc.).
 */
export function providerSupportsChatTemplateKwargs(
  provider: Pick<ProviderPublic, 'id' | 'baseUrl'>,
): boolean {
  if (BUILTIN_LOCAL_TEMPLATE_KWARGS_IDS.has(provider.id.trim())) {
    return true;
  }
  return isLocalProviderBaseUrl(provider.baseUrl);
}
