/**
 * Debounced LLM client for editor inline completions (POLISH-006).
 */

import { extractMessageText } from '../api/chat';
import {
  cancelGeneration,
  createGeneration,
  subscribeToGeneration,
  type GenerationEndEvent,
} from '../api/generations';
import {
  BenchmarkStreamReasoningAccumulator,
  resolveBenchmarkCompletionText,
} from '../benchmark/stream-text';
import { StreamingContentAccumulator } from '../api/message-content';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { getActiveChat } from '../state/sessions';
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
  /** Called as streamed text arrives (already sanitized). */
  onPartial?: (text: string) => void;
}

/** Merge streamed chunks into displayable completion text (content + reasoning fallback). */
export function resolveEditorCompletionRawText(
  contentAcc: StreamingContentAccumulator,
  reasoningAcc: BenchmarkStreamReasoningAccumulator,
  chunk: ChatCompletionChunk,
): string {
  contentAcc.ingestChoice(chunk.choices?.[0]);
  reasoningAcc.ingestChunk(chunk);
  const fromStream = resolveBenchmarkCompletionText(
    contentAcc.getText(),
    reasoningAcc.getText(),
  );
  if (fromStream) return fromStream;
  const message = chunk.choices?.[0]?.message;
  return extractMessageText(message).trim();
}

/** Stream a single inline completion via /api/generations (parsed SSE chunks). */
export async function fetchEditorAiCompletion(
  input: FetchEditorAiCompletionInput,
): Promise<string | null> {
  const { messages, prefix } = buildEditorAiCompletionMessages(input);
  const provider = await resolveProvider(input.binding.providerId);
  const body = {
    model: input.binding.modelId || undefined,
    messages,
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    stream: true as const,
  };

  let generationId: string;
  try {
    ({ generationId } = await createGeneration(provider.id, body, { persist: false }));
  } catch {
    return null;
  }

  const contentAcc = new StreamingContentAccumulator();
  const reasoningAcc = new BenchmarkStreamReasoningAccumulator();

  const emitFromAccumulators = (): string => {
    const raw = resolveBenchmarkCompletionText(
      contentAcc.getText(),
      reasoningAcc.getText(),
    );
    return sanitizeCompletionText(raw, prefix);
  };

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (text: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(text);
    };

    const unsubscribe = subscribeToGeneration(generationId, {
      signal: input.signal,
      onChunk: (chunk) => {
        resolveEditorCompletionRawText(contentAcc, reasoningAcc, chunk);
        const cleaned = emitFromAccumulators();
        if (cleaned) input.onPartial?.(cleaned);
      },
      onEnd: (event?: GenerationEndEvent) => {
        unsubscribe();
        if (event?.status === 'error') {
          finish(null);
          return;
        }
        const cleaned = emitFromAccumulators();
        finish(cleaned.length > 0 ? cleaned : null);
      },
      onTransportError: () => {
        unsubscribe();
        finish(null);
      },
    });

    input.signal.addEventListener(
      'abort',
      () => {
        unsubscribe();
        void cancelGeneration(generationId).catch(() => {
          /* best-effort */
        });
        finish(null);
      },
      { once: true },
    );
  });
}

/** Build messages only (exported for tests). */
export function buildMessagesForEditorAiCompletion(
  input: EditorAiPromptInput,
): ApiMessage[] {
  return buildEditorAiCompletionMessages(input).messages;
}
