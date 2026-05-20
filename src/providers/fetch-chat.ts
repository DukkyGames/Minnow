/**
 * Central chat completions fetch for direct and proxy providers.
 */

import type { ChatCompletionBody } from '../api/chat';
import { resolveProviderEndpoints } from './resolve';
import type { ProviderPublic } from './types';

export interface PostChatOptions {
  stream?: boolean;
}

/**
 * POST chat/completions for the given provider.
 * Proxy mode: same-origin /api/providers/:id/chat/completions (auth on server).
 */
export async function postChatCompletions(
  provider: ProviderPublic,
  body: ChatCompletionBody & { stream?: boolean; stream_options?: { include_usage: boolean } },
  signal: AbortSignal,
  options: PostChatOptions = {},
): Promise<Response> {
  const endpoints = resolveProviderEndpoints(provider);
  const payload = {
    ...body,
    stream: options.stream ?? body.stream ?? true,
  };

  return fetch(endpoints.chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

/** Re-export for callers that need URLs without posting. */
export { resolveProviderEndpoints };
