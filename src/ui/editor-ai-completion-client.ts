/**
 * Debounced LLM client for editor inline completions (POLISH-006).
 */

import { extractStreamDelta, mergeStreamMeta, type StreamMetaAccumulator } from '../api/chat';
import {
  createSseEventBuffer,
  feedSseEventBuffer,
  flushSseEventBuffer,
} from '../api/sse-parse';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { getActiveChat } from '../state/sessions';
import { postChatCompletions } from '../providers/fetch-chat';
import { resolveProvider } from '../providers/store';
import type { ApiMessage, ChatCompletionChunk } from '../types';
import {
  buildEditorAiCompletionMessages,
  sanitizeCompletionText,
  type EditorAiPromptInput,
} from './editor-ai-completion-prompt';

export interface EditorAiBinding {
  providerId: string;
  modelId: string;
}

/** Resolve provider/model from config + active chat (mirrors reef widget binding). */
export async function resolveEditorAiBinding(
  config: EditorAiCompletionConfig,
): Promise<EditorAiBinding> {
  const chat = getActiveChat();
  const overrideProvider = config.providerId.trim();
  const overrideModel = config.modelId.trim();

  if (!config.useChatModel && overrideProvider) {
    return { providerId: overrideProvider, modelId: overrideModel };
  }

  if (overrideProvider) {
    return {
      providerId: overrideProvider,
      modelId: overrideModel || chat.modelId?.trim() || '',
    };
  }

  const providerId =
    chat.providerId?.trim() || (await resolveProvider()).id;
  const modelId = chat.modelId?.trim() || '';
  return { providerId, modelId };
}

export interface FetchEditorAiCompletionInput extends EditorAiPromptInput {
  binding: EditorAiBinding;
  signal: AbortSignal;
}

/** Stream a single inline completion; returns null on failure or empty result. */
export async function fetchEditorAiCompletion(
  input: FetchEditorAiCompletionInput,
): Promise<string | null> {
  const { messages } = buildEditorAiCompletionMessages(input);
  const provider = await resolveProvider(input.binding.providerId);
  const body = {
    model: input.binding.modelId || undefined,
    messages,
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    stream: true as const,
  };

  let res: Response;
  try {
    res = await postChatCompletions(provider, body, input.signal);
  } catch {
    return null;
  }

  if (!res.ok || !res.body) return null;

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sseBuffer = createSseEventBuffer();

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    const delta = extractStreamDelta(chunk);
    if (delta) fullText += delta;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      feedSseEventBuffer(sseBuffer, decoder.decode(value, { stream: true }), handleChunk);
    }
    flushSseEventBuffer(sseBuffer, handleChunk);
  } catch {
    return null;
  } finally {
    void streamMeta;
  }

  const cleaned = sanitizeCompletionText(fullText);
  return cleaned.length > 0 ? cleaned : null;
}

/** Build messages only (exported for tests). */
export function buildMessagesForEditorAiCompletion(
  input: EditorAiPromptInput,
): ApiMessage[] {
  return buildEditorAiCompletionMessages(input).messages;
}
