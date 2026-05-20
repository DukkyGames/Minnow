/**
 * Headless LLM completion for reef widget callLLM bridge (no tools).
 */

import {
  extractStreamDelta,
  parseSsePayloads,
} from '../../api/chat.ts';
import { postChatCompletions } from '../../providers/fetch-chat.ts';
import { getActiveProvider } from '../../providers/store.ts';
import type { ApiMessage, ChatCompletionChunk } from '../../types.ts';

export interface WidgetCompletionInput {
  providerId: string;
  modelId: string;
  messages: ApiMessage[];
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}

/** Stream a single widget LLM completion; invokes onDelta for each text chunk. */
export async function runWidgetCompletion(input: WidgetCompletionInput): Promise<string> {
  const provider = await getActiveProvider(input.providerId);
  const body = {
    model: input.modelId || undefined,
    messages: input.messages,
    temperature: 0.4,
    max_tokens: 2048,
    stream: true as const,
  };

  const res = await postChatCompletions(provider, body, input.signal);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  if (!res.body) {
    throw new Error('No response body');
  }

  let fullText = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  function handleChunk(chunk: ChatCompletionChunk): void {
    const delta = extractStreamDelta(chunk);
    if (!delta) return;
    fullText += delta;
    input.onDelta(delta);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    parseSsePayloads(lines.join('\n'), handleChunk);
  }

  if (buffer.trim()) parseSsePayloads(buffer, handleChunk);

  return fullText.trim();
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
    (await getActiveProvider()).id;
  const modelId = chat.reefWidgetModelId?.trim() || chat.modelId?.trim() || '';
  return { providerId, modelId };
}
