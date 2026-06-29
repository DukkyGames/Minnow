/**
 * Production GoalEvalProviderPort — non-streaming POST via generations shim.
 */

import { completeNonStreamingViaGenerations } from '../../providers/fetch-chat';
import { getActiveProvider } from '../../providers/store';
import type { ChatCompletionBody } from '../../api/chat';
import type { ChatCompletionChunk } from '../../types';

export interface GoalEvalProviderPort {
  complete(body: ChatCompletionBody, signal?: AbortSignal): Promise<ChatCompletionChunk>;
}

/** Build a port that resolves auth/URL via the active provider layer. */
export function createGoalEvalProviderPort(providerId?: string): GoalEvalProviderPort {
  return {
    async complete(body, signal) {
      const provider = await getActiveProvider(providerId);
      const abortSignal = signal ?? new AbortController().signal;
      return completeNonStreamingViaGenerations(
        provider,
        body,
        abortSignal,
        { fallbackRole: 'goal-eval' },
      );
    },
  };
}
