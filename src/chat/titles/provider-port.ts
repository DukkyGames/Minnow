/**
 * Production TitleProviderPort — Step 03 provider registry + non-streaming POST.
 */

import { thinkingToCompletionBody } from '../../agents/thinking-to-body';
import { completeNonStreamingViaGenerations } from '../../providers/fetch-chat';
import { getActiveProvider } from '../../providers/store';
import type { ChatCompletionBody } from '../../api/chat';
import type { ApiKind } from '../../providers/types';
import type { TitleProviderPort } from './types';

/** Title jobs need prose in `content` — disable thinking like editor inline completion. */
export function applyTitleThinkingOffPatch(
  body: ChatCompletionBody,
  apiKind: ApiKind,
): ChatCompletionBody {
  const modelId = typeof body.model === 'string' ? body.model : undefined;
  const { body: thinkingPatch } = thinkingToCompletionBody(
    'off',
    apiKind,
    undefined,
    null,
    modelId,
  );
  return { ...body, ...thinkingPatch };
}

/** Build a port that resolves auth/URL via the active provider layer. */
export function createTitleProviderPort(providerId?: string): TitleProviderPort {
  return {
    async complete(body, signal) {
      const provider = await getActiveProvider(providerId);
      const abortSignal = signal ?? new AbortController().signal;
      return completeNonStreamingViaGenerations(
        provider,
        applyTitleThinkingOffPatch(body, provider.apiKind),
        abortSignal,
        { fallbackRole: 'chat-titles' },
      );
    },
  };
}
