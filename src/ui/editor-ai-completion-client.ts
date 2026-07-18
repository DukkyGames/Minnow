/**
 * Debounced LLM client for editor inline completions (POLISH-006, Phase 6).
 */

import { extractMessageText } from '../api/chat';
import {
  cancelGeneration,
  createGeneration,
  formatGenerationErrorMessage,
  subscribeToGeneration,
  type GenerationEndEvent,
} from '../api/generations';
import { modelCache } from '../app-state';
import { thinkingToCompletionBody } from '../agents/thinking-to-body';
import {
  BenchmarkStreamReasoningAccumulator,
  resolveEditorCompletionText,
} from '../benchmark/stream-text';
import { StreamingContentAccumulator } from '../api/message-content';
import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { decodeModelSelectKey, encodeModelSelectKey } from '../lib/model-select-key';
import { catalogCapabilitiesFromRow } from '../providers/model-capabilities';
import { getActiveChat } from '../state/sessions';
import { resolveProvider } from '../providers/store';
import type { ApiMessage, ChatCompletionChunk } from '../types';
import {
  buildCompletionCacheKey,
  editorAiCompletionCache,
  resetEditorAiCompletionCache,
} from './editor-ai-completion-cache';
import {
  alignAndValidateCompletionText,
  buildEditorAiCompletionMessages,
  buildEditorAiCompletionMessagesAsync,
  type EditorAiPromptInput,
} from './editor-ai-completion-prompt';
import { stripEditorModelOutput, extractEditorCodeFromReasoning } from './editor-model-output';

export interface EditorAiBinding {
  providerId: string;
  modelId: string;
}

/** Shown in the file viewer status bar and Quick Edit panel when modelId is empty. */
export const EDITOR_AI_NO_MODEL_MESSAGE =
  'No model assigned — pick a model in the top bar or pin one in Settings → Editor.';

/** Generic fallback when the backend fails without a specific message. */
export const EDITOR_AI_REQUEST_FAILED_MESSAGE =
  'AI completion failed — check provider and model in Settings';

/** Shown when the model streams successfully but yields no insertable text. */
export const EDITOR_AI_EMPTY_COMPLETION_MESSAGE =
  'Model returned no completion text. Try a coder model or disable thinking in your provider.';

export interface EditorAiCompletionResult {
  text: string | null;
  error?: string;
}

export type EditorAiBindingValidation =
  | { ok: true }
  | { ok: false; message: string };

/** Injectable seams for deterministic tests. */
export interface EditorAiCompletionDeps {
  createGeneration?: typeof createGeneration;
  subscribeToGeneration?: typeof subscribeToGeneration;
  cancelGeneration?: typeof cancelGeneration;
  resolveProvider?: typeof resolveProvider;
  buildMessagesAsync?: typeof buildEditorAiCompletionMessagesAsync;
  cache?: typeof editorAiCompletionCache;
}

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

/** Active top-bar model select value (same source as composer send / benchmark). */
export function getActiveModelIdFromDom(): string {
  if (typeof document === 'undefined') return '';
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  return sel?.value?.trim() ?? '';
}

/** Return a user-facing error when binding has no model; null when ready. */
export function preflightEditorAiBinding(binding: EditorAiBinding): string | null {
  if (binding.modelId.trim()) return null;
  return EDITOR_AI_NO_MODEL_MESSAGE;
}

/** Resolve provider/model from config + active chat (mirrors reef widget binding). */
export async function resolveEditorAiBinding(
  config: EditorAiCompletionConfig,
): Promise<EditorAiBinding> {
  const chat = getActiveChat();
  const overrideProvider = config.providerId.trim();
  const overrideModel = config.modelId.trim();

  // Pinned provider + model (Settings → Editor → Pin).
  if (!config.useChatModel) {
    return { providerId: overrideProvider, modelId: overrideModel };
  }

  // Follow active chat / top-bar model picker (live DOM read on each request).
  const raw = getActiveModelIdFromDom();
  const parsed = decodeModelSelectKey(raw);
  const modelId =
    (parsed?.modelId ?? raw).trim() || chat.modelId?.trim() || '';
  const providerId =
    parsed?.providerId?.trim() ||
    chat.providerId?.trim() ||
    (await resolveProvider()).id;
  return { providerId, modelId };
}

export interface FetchEditorAiCompletionInput extends EditorAiPromptInput {
  binding: EditorAiBinding;
  signal: AbortSignal;
  /** Called as streamed text arrives (already sanitized). */
  onPartial?: (text: string) => void;
  deps?: EditorAiCompletionDeps;
}

/** Clear completion cache (tests). */
export { resetEditorAiCompletionCache };

/** Read cached completion when enabled. */
export function getCachedEditorAiCompletion(
  binding: EditorAiBinding,
  config: EditorAiCompletionConfig,
  filePath: string,
  prefix: string,
  suffix: string,
  cache = editorAiCompletionCache,
): string | undefined {
  const key = buildCompletionCacheKey({
    providerId: binding.providerId,
    modelId: binding.modelId,
    config,
    filePath,
    prefix,
    suffix,
  });
  return cache.get(key);
}

/** Store a final validated completion in cache when enabled. */
export function setCachedEditorAiCompletion(
  binding: EditorAiBinding,
  config: EditorAiCompletionConfig,
  filePath: string,
  prefix: string,
  suffix: string,
  text: string,
  cache = editorAiCompletionCache,
): void {
  const key = buildCompletionCacheKey({
    providerId: binding.providerId,
    modelId: binding.modelId,
    config,
    filePath,
    prefix,
    suffix,
  });
  cache.set(key, text);
}

/** Prefer main `content`; never stream reasoning-channel partials as ghost text. */
export function mergeEditorStreamText(contentText: string): string {
  const raw = resolveEditorCompletionText(contentText);
  if (!raw) return '';
  return stripEditorModelOutput(raw);
}

/** Resolve display text; reasoning channel is consulted only after the stream ends. */
export function resolveEditorCompletionDisplayText(
  contentText: string,
  reasoningText: string,
  options?: { reasoningFallback?: boolean },
): string {
  const fromContent = mergeEditorStreamText(contentText);
  if (fromContent) return fromContent;
  if (!options?.reasoningFallback) return '';
  return extractEditorCodeFromReasoning(reasoningText);
}

function generationEndErrorMessage(event?: GenerationEndEvent): string {
  const raw = event?.errorMessage?.trim();
  if (raw) return formatGenerationErrorMessage(raw);
  return EDITOR_AI_REQUEST_FAILED_MESSAGE;
}

function createGenerationErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return formatGenerationErrorMessage(err.message);
  }
  return EDITOR_AI_REQUEST_FAILED_MESSAGE;
}

/** Merge streamed chunks into displayable completion text (content channel only). */
export function resolveEditorCompletionRawText(
  contentAcc: StreamingContentAccumulator,
  chunk: ChatCompletionChunk,
): string {
  contentAcc.ingestChoice(chunk.choices?.[0]);
  const fromStream = mergeEditorStreamText(contentAcc.getText());
  if (fromStream) return fromStream;
  const message = chunk.choices?.[0]?.message;
  return stripEditorModelOutput(extractMessageText(message).trim());
}

/** Align raw model output for insertion at the cursor. */
export function alignCompletionForInsert(
  raw: string,
  prefix: string,
  suffix: string,
): string {
  return alignAndValidateCompletionText({ raw, prefix, suffix }).text;
}

/** Stream a single inline completion via /api/generations (parsed SSE chunks). */
export async function fetchEditorAiCompletion(
  input: FetchEditorAiCompletionInput,
): Promise<EditorAiCompletionResult> {
  const deps = input.deps ?? {};
  const createGen = deps.createGeneration ?? createGeneration;
  const subscribeGen = deps.subscribeToGeneration ?? subscribeToGeneration;
  const cancelGen = deps.cancelGeneration ?? cancelGeneration;
  const resolveProv = deps.resolveProvider ?? resolveProvider;
  const buildMessages = deps.buildMessagesAsync ?? buildEditorAiCompletionMessagesAsync;
  const cache = deps.cache ?? editorAiCompletionCache;

  const modelId = input.binding.modelId.trim();
  const promptResult = await buildMessages({
    ...input,
    modelId,
  });
  const { prefix, suffix, messages } = promptResult;

  if (input.config.enableCompletionCache !== false) {
    const cached = getCachedEditorAiCompletion(
      input.binding,
      input.config,
      input.filePath,
      prefix,
      suffix,
      cache,
    );
    if (cached !== undefined) {
      if (cached) input.onPartial?.(cached);
      return cached.length > 0
        ? { text: cached }
        : { text: null, error: EDITOR_AI_EMPTY_COMPLETION_MESSAGE };
    }
  }

  const provider = await resolveProv(input.binding.providerId);
  const body: Record<string, unknown> = {
    model: modelId || undefined,
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    stream: true,
    messages,
  };

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
    ({ generationId } = await createGen(provider.id, body, { persist: false }));
  } catch (err) {
    return { text: null, error: createGenerationErrorMessage(err) };
  }

  const contentAcc = new StreamingContentAccumulator();
  const reasoningAcc = new BenchmarkStreamReasoningAccumulator();

  const emitFromAccumulators = (reasoningFallback = false): string => {
    const raw = resolveEditorCompletionDisplayText(
      contentAcc.getText(),
      reasoningAcc.getText(),
      { reasoningFallback },
    );
    return alignCompletionForInsert(raw, prefix, suffix);
  };

  return new Promise<EditorAiCompletionResult>((resolve) => {
    let settled = false;
    const finish = (result: EditorAiCompletionResult): void => {
      if (settled) return;
      settled = true;
      if (result.text && input.config.enableCompletionCache !== false) {
        setCachedEditorAiCompletion(
          input.binding,
          input.config,
          input.filePath,
          prefix,
          suffix,
          result.text,
          cache,
        );
      }
      resolve(result);
    };

    let unsubscribe: (() => void) | null = null;
    unsubscribe = subscribeGen(generationId, {
      signal: input.signal,
      onChunk: (chunk) => {
        contentAcc.ingestChoice(chunk.choices?.[0]);
        reasoningAcc.ingestChunk(chunk);
        const cleaned = emitFromAccumulators(false);
        if (cleaned) input.onPartial?.(cleaned);
      },
      onEnd: (event?: GenerationEndEvent) => {
        unsubscribe?.();
        if (event?.status === 'error') {
          finish({ text: null, error: generationEndErrorMessage(event) });
          return;
        }
        const cleaned = emitFromAccumulators(true);
        finish(
          cleaned.length > 0
            ? { text: cleaned }
            : { text: null, error: EDITOR_AI_EMPTY_COMPLETION_MESSAGE },
        );
      },
      onTransportError: (err) => {
        unsubscribe?.();
        finish({ text: null, error: createGenerationErrorMessage(err) });
      },
    });

    input.signal.addEventListener(
      'abort',
      () => {
        unsubscribe?.();
        void cancelGen(generationId).catch(() => {
          /* best-effort */
        });
        finish({ text: null });
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
