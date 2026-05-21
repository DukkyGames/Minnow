/**
 * Central chat completions fetch — backed by /api/generations with a synthetic Response
 * so existing SSE readers stay unchanged.
 */

import {
  createGeneration,
  subscribeToGenerationRaw,
  type GenerationEndEvent,
} from '../api/generations';
import type { ChatCompletionBody } from '../api/chat';
import type { ProviderPublic } from './types';
import { resolveProviderEndpoints } from './resolve';

export interface PostChatOptions {
  stream?: boolean;
}

/**
 * POST chat/completions for the given provider via backend generations (persist: false).
 * Returns a Response whose body replays upstream SSE bytes from the generation stream.
 */
export async function postChatCompletions(
  provider: ProviderPublic,
  body: ChatCompletionBody & { stream?: boolean; stream_options?: { include_usage: boolean } },
  signal: AbortSignal,
  options: PostChatOptions = {},
): Promise<Response> {
  const payload = {
    ...body,
    stream: options.stream ?? body.stream ?? true,
  };

  const { generationId } = await createGeneration(provider.id, payload, { persist: false });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const closeStream = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const unsubscribe = subscribeToGenerationRaw(
        generationId,
        {
          onChunk: (text) => {
            if (closed) return;
            controller.enqueue(new TextEncoder().encode(text));
          },
          onEnd: (_event?: GenerationEndEvent) => {
            closeStream();
          },
          onTransportError: (err) => {
            if (closed) return;
            closed = true;
            controller.error(err);
          },
        },
        signal,
      );

      signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          closeStream();
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** Re-export for callers that need URLs without posting. */
export { resolveProviderEndpoints };
