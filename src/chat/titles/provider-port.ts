/**
 * Production TitleProviderPort — Step 03 provider registry + non-streaming POST.
 */

import { completeNonStreamingViaGenerations } from '../../providers/fetch-chat';
import { getActiveProvider } from '../../providers/store';
import type { TitleProviderPort } from './types';

/** Build a port that resolves auth/URL via the active provider layer. */
export function createTitleProviderPort(providerId?: string): TitleProviderPort {
  return {
    async complete(body, signal) {
      const provider = await getActiveProvider(providerId);
      const abortSignal = signal ?? new AbortController().signal;
      return completeNonStreamingViaGenerations(
        provider,
        body,
        abortSignal,
      );
    },
  };
}
