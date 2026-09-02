import type { ChatCompletionBody } from '../../api/chat';
import type { ChatCompletionChunk } from '../../types';

/** Non-streaming completion port (mocked in tests). */
export interface TitleProviderPort {
  complete(
    body: ChatCompletionBody,
    signal?: AbortSignal,
  ): Promise<ChatCompletionChunk>;
}

/** Runtime options for a single title generation request. */
export interface TitleGenerationOptions {
  modelId: string;
  providerId?: string;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}
