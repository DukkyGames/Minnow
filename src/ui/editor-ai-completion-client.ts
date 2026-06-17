/**
 * Debounced LLM client for editor inline completions (POLISH-006, Phase 4).
 */

import { extractMessageText } from '../api/chat';
import {
  cancelGeneration,
  createGeneration,
  subscribeToGeneration,
  type GenerationEndEvent,
} from '../api/generations';
import { modelCache } from '../app-state';
import { thinkingToCompletionBody } from '../agents/thinking-to-body';
import {
  BenchmarkStreamReasoningAccumulator,
  resolveBenchmarkCompletionText,
} from '../benchmark/stream-text';
import { StreamingContentAccumulator } from '../api/message-content';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { encodeModelSelectKey } from '../lib/model-select-key';
import { catalogCapabilitiesFromRow } from '../providers/model-capabilities';
import { getActiveChat } from '../state/sessions';
import { resolveProvider } from '../providers/store';
import type { ApiMessage, ChatCompletionChunk } from '../types';
import { buildCompletionCacheKey } from './editor-ai-completion-cache';
import {
  buildEditorAiCompletionMessages,
  buildEditorAiCompletionMessagesAsync,
  sanitizeCompletionText,
  type EditorAiPromptInput,
} from './editor-ai-completion-prompt';

export interface EditorAiBinding {
  providerId: string;
  modelId: string;
}

/** Shown in the file viewer status bar and Quick Edit panel when modelId is empty. */
export const EDITOR_AI_NO_MODEL_MESSAGE =
  'No model assigned for editor AI. Select a model in the chat bar or pin one in Settings → Editor.';

export type EditorAiBindingValidation =
  | { ok: true }
  | { ok: false; message: string };

/** Require a provider and model before editor AI requests (inline completion, Quick Edit). */
export function validateEditorAiBinding(
  binding: EditorAiBinding,
): EditorAiBindingValidation {
  if (!binding.providerId.trim()) {
    return {
      ok: false,
      message:
        'No provider configured for editor AI. Add one in Settings → Providers.',
    };
  }
  if (!binding.modelId.trim()) {
    return { ok: false, message: EDITOR_AI_NO_MODEL_MESSAGE };
  }
  return { ok: true };
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

/** In-memory completion cache (cleared on full page reload). */
const completionCache = new Map<string, string>();

/** Clear completion cache (tests). */
export function resetEditorAiCompletionCache(): void {
  completionCache.clear();
}

/** Read cached completion when enabled. */
export function getCachedEditorAiCompletion(
  filePath: string,
  prefix: string,
  suffix: string,
): string | undefined {
  const key = buildCompletionCacheKey(filePath, prefix, suffix);
  return completionCache.get(key);
}

/** Store a completion in cache when enabled. */
export function setCachedEditorAiCompletion(
  filePath: string,
  prefix: string,
  suffix: string,
  text: string,
): void {
  const key = buildCompletionCacheKey(filePath, prefix, suffix);
  completionCache.set(key, text);
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
  const modelId = input.binding.modelId.trim();
  const promptResult = await buildEditorAiCompletionMessagesAsync({
    ...input,
    modelId,
  });
  const { prefix, suffix, messages, useNativeFim, fimPrompt } = promptResult;

  if (input.config.enableCompletionCache !== false) {
    const cached = getCachedEditorAiCompletion(input.filePath, prefix, suffix);
    if (cached !== undefined) {
      if (cached) input.onPartial?.(cached);
      return cached.length > 0 ? cached : null;
    }
  }

  const provider = await resolveProvider(input.binding.providerId);
  const body: Record<string, unknown> = {
    model: modelId || undefined,
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    stream: true,
  };

  if (useNativeFim && fimPrompt) {
    body.prompt = fimPrompt;
  } else {
    body.messages = messages;
  }

  const modelRow = modelId
    ? modelCache.get(encodeModelSelectKey(provider.id, modelId))
    : undefined;
  const modelCaps =
    modelRow?.capabilities ??
    (modelRow ? catalogCapabilitiesFromRow(modelRow) : undefined);
  // Inline completion always disables thinking (ignores chat/global toggles).
  const { body: thinkingPatch } = thinkingToCompletionBody(
    'off',
    provider.apiKind,
    modelCaps,
  );
  Object.assign(body, thinkingPatch);

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
      if (text && input.config.enableCompletionCache !== false) {
        setCachedEditorAiCompletion(input.filePath, prefix, suffix, text);
      }
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
