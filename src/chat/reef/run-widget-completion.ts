/**
 * Headless LLM completion for reef widget callLLM bridge (no tools).
 */

import { extractStreamDelta, mergeStreamMeta, type StreamMetaAccumulator } from '../../api/chat.ts';
import {
  createSseEventBuffer,
  feedSseEventBuffer,
  flushSseEventBuffer,
} from '../../api/sse-parse.ts';
import { postChatCompletions } from '../../providers/fetch-chat.ts';
import { resolveProvider } from '../../providers/store.ts';
import type { ApiMessage, ChatCompletionChunk, Usage } from '../../types.ts';

export interface WidgetCompletionInput {
  providerId: string;
  modelId: string;
  messages: ApiMessage[];
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}

export interface WidgetCompletionResult {
  text: string;
  usage?: Usage;
}

/** Stream a single widget LLM completion; invokes onDelta for each text chunk. */
export async function runWidgetCompletion(
  input: WidgetCompletionInput,
): Promise<WidgetCompletionResult> {
  const provider = await resolveProvider(input.providerId);
  const body = {
    model: input.modelId || undefined,
    messages: input.messages,
    temperature: 0.4,
    max_tokens: 2048,
    stream: true as const,
  };

  const res = await postChatCompletions(provider, body, input.signal, {
    fallbackRole: 'reef-widget',
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  if (!res.body) {
    throw new Error('No response body');
  }

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sseBuffer = createSseEventBuffer();

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    const delta = extractStreamDelta(chunk);
    if (!delta) return;
    fullText += delta;
    input.onDelta(delta);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    feedSseEventBuffer(sseBuffer, decoder.decode(value, { stream: true }), handleChunk);
  }

  flushSseEventBuffer(sseBuffer, handleChunk);

  const text = fullText.trim();
  const usage = streamMeta.usage;
  return {
    text,
    ...(usage && Object.keys(usage).length > 0 ? { usage } : {}),
  };
}

/** Resolve provider/model for widget LLM from chat overrides. */
export async function resolveWidgetLlmBinding(chat: {
  reefWidgetProviderId?: string;
  reefWidgetModelId?: string;
  providerId?: string;
  modelId?: string;
}): Promise<{ providerId: string; modelId: string }> {
  const providerId =
    chat.reefWidgetProviderId?.trim() ||
    chat.providerId?.trim() ||
    (await resolveProvider()).id;
  const modelId = chat.reefWidgetModelId?.trim() || chat.modelId?.trim() || '';
  return { providerId, modelId };
}
