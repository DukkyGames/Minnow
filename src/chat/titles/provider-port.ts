/**
 * Production TitleProviderPort — Step 03 provider registry + non-streaming POST.
 */

import { postChatCompletions } from '../../providers/fetch-chat';
import { getActiveProvider } from '../../providers/store';
import type { TitleProviderPort } from './types';

/** Build a port that resolves auth/URL via the active provider layer. */
export function createTitleProviderPort(providerId?: string): TitleProviderPort {
  return {
    async complete(body, signal) {
      const provider = await getActiveProvider(providerId);
      const abortSignal = signal ?? new AbortController().signal;
      const res = await postChatCompletions(
        provider,
        { ...body, stream: false },
        abortSignal,
        { stream: false },
      );
      if (!res.ok) {
        throw new Error(`Title HTTP ${res.status}`);
      }
      return res.json() as Promise<import('../../types').ChatCompletionChunk>;
    },
  };
}
