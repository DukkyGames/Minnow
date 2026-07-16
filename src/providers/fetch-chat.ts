/**
 * Central chat completions fetch — backed by /api/generations with a synthetic Response
 * so existing SSE readers stay unchanged.
 */

import {
  cancelGeneration,
  createGeneration,
  subscribeToGenerationRaw,
  type GenerationEndEvent,
  type FallbackRole,
} from '../api/generations';
import type { ChatCompletionBody } from '../api/chat';
import { parseCompletionResponseBody } from '../api/sse-parse';
import type { ChatCompletionChunk } from '../types';
import { retryOnceOnTransientFetch } from '../lib/transient-fetch-retry';
import type { ProviderPublic } from './types';
import { resolveProviderEndpoints } from './resolve';

export interface PostChatOptions {
  stream?: boolean;
  fallbackRole?: FallbackRole;
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

  const { generationId } = await retryOnceOnTransientFetch(() =>
    createGeneration(provider.id, payload, {
      persist: false,
      fallbackRole: options.fallbackRole,
    }),
  );

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
          onEnd: (event?: GenerationEndEvent) => {
            if (event?.status === 'error') {
              if (closed) return;
              closed = true;
              controller.error(
                new Error(event.errorMessage ?? 'Generation failed'),
              );
              return;
            }
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
          void cancelGeneration(generationId).catch(() => {
            /* best-effort; matches chat stopGeneration */
          });
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

/**
 * Non-streaming completion via backend generations (read body as text, then parse).
 * Never call Response.json() on the SSE shim — see BUG-016 / parseCompletionResponseBody.
 */
export async function completeNonStreamingViaGenerations(
  provider: ProviderPublic,
  body: ChatCompletionBody,
  signal: AbortSignal,
  options: Pick<PostChatOptions, 'fallbackRole'> = {},
): Promise<ChatCompletionChunk> {
  const res = await postChatCompletions(
    provider,
    { ...body, stream: false },
    signal,
    { stream: false, fallbackRole: options.fallbackRole },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseCompletionResponseBody(text);
}

/** Re-export for callers that need URLs without posting. */
export { resolveProviderEndpoints };
