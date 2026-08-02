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
  DEFAULT_MAX_INSERT_CHARS,
  extractPrefixSuffix,
  type AlignCompletionResult,
  type EditorAiPromptInput,
} from './editor-ai-completion-prompt';
import { stripEditorModelOutput, extractEditorCodeFromReasoning } from './editor-model-output';
import { recordCompletionEvent } from './editor-ai-telemetry';

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

export const EDITOR_AI_COMPLETION_OVERSIZED_MESSAGE =
  'Completion too long for inline insert — lower max tokens or edit a smaller region.';

export const EDITOR_AI_COMPLETION_PROSE_MESSAGE =
  'Model returned explanation instead of code — try a coder model.';

export const EDITOR_AI_COMPLETION_PREFIX_ECHO_MESSAGE =
  'Model repeated existing text — no suggestion shown.';

export const EDITOR_AI_COMPLETION_FULL_REWRITE_MESSAGE =
  'Completion would replace most of the file — rejected.';

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

/** Resolve provider/model from config + active chat. */
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
  onPartial?: (text: string, options?: { fromCache?: boolean }) => void;
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

/** Map alignment rejection codes to status-bar copy. */
export function editorAiCompletionRejectionMessage(reason: string | undefined): string {
  switch (reason) {
    case 'oversized':
      return EDITOR_AI_COMPLETION_OVERSIZED_MESSAGE;
    case 'prose':
      return EDITOR_AI_COMPLETION_PROSE_MESSAGE;
    case 'prefix_echo':
      return EDITOR_AI_COMPLETION_PREFIX_ECHO_MESSAGE;
    case 'full_rewrite':
      return EDITOR_AI_COMPLETION_FULL_REWRITE_MESSAGE;
    case 'empty':
    case 'empty_after_trim':
      return EDITOR_AI_EMPTY_COMPLETION_MESSAGE;
    default:
      return EDITOR_AI_EMPTY_COMPLETION_MESSAGE;
  }
}

function maxInsertCharsForConfig(config: EditorAiCompletionConfig): number {
  return Math.min(DEFAULT_MAX_INSERT_CHARS, config.maxTokens * 4);
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
  options?: { maxInsertChars?: number },
): AlignCompletionResult {
  return alignAndValidateCompletionText({
    raw,
    prefix,
    suffix,
    maxInsertChars: options?.maxInsertChars,
  });
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
  const cursorPos = input.cursorPos;
  const { prefix, suffix } = extractPrefixSuffix(input.state.doc, cursorPos, input.config);
  const maxInsertChars = maxInsertCharsForConfig(input.config);

  recordCompletionEvent({ type: 'request' });

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
      recordCompletionEvent({ type: 'cache_hit' });
      if (cached) input.onPartial?.(cached, { fromCache: true });
      if (cached.length > 0) {
        return { text: cached };
      }
      return { text: null, error: EDITOR_AI_EMPTY_COMPLETION_MESSAGE };
    }
  }

  const promptResult = await buildMessages({
    ...input,
    modelId,
  });
  const { messages } = promptResult;

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
  const requestStartedAt = performance.now();
  let firstTokenRecorded = false;

  const alignForInsert = (raw: string): AlignCompletionResult =>
    alignCompletionForInsert(raw, prefix, suffix, { maxInsertChars });

  const emitFromAccumulators = (reasoningFallback = false): AlignCompletionResult => {
    const raw = resolveEditorCompletionDisplayText(
      contentAcc.getText(),
      reasoningAcc.getText(),
      { reasoningFallback },
    );
    return alignForInsert(raw);
  };

  const finishAligned = (aligned: AlignCompletionResult): EditorAiCompletionResult => {
    if (aligned.rejected) {
      const reason = aligned.reason ?? 'empty';
      recordCompletionEvent({ type: 'reject', reason });
      return { text: null, error: editorAiCompletionRejectionMessage(reason) };
    }
    if (!aligned.text.trim()) {
      recordCompletionEvent({ type: 'reject', reason: 'empty' });
      return { text: null, error: EDITOR_AI_EMPTY_COMPLETION_MESSAGE };
    }
    return { text: aligned.text };
  };

  return new Promise<EditorAiCompletionResult>((resolve) => {
    let settled = false;
    let firstTokenMs = 0;
    const finish = (result: EditorAiCompletionResult): void => {
      if (settled) return;
      settled = true;
      const totalMs = performance.now() - requestStartedAt;
      recordCompletionEvent({
        type: 'timing',
        firstTokenMs: firstTokenRecorded ? firstTokenMs : totalMs,
        totalMs,
      });
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
    let lastEmittedLen = 0;
    let lastEmittedLines = 1;
    unsubscribe = subscribeGen(generationId, {
      signal: input.signal,
      onChunk: (chunk) => {
        contentAcc.ingestChoice(chunk.choices?.[0]);
        reasoningAcc.ingestChunk(chunk);
        const aligned = emitFromAccumulators(false);
        if (!aligned.rejected && aligned.text) {
          const len = aligned.text.length;
          const lines = aligned.text.split('\n').length;
          const grewEnough = len - lastEmittedLen >= 8;
          const gainedNewline = lines > lastEmittedLines;
          if (lastEmittedLen > 0 && !grewEnough && !gainedNewline) {
            return;
          }
          lastEmittedLen = len;
          lastEmittedLines = lines;
          if (!firstTokenRecorded) {
            firstTokenRecorded = true;
            firstTokenMs = performance.now() - requestStartedAt;
          }
          input.onPartial?.(aligned.text);
        }
      },
      onEnd: (event?: GenerationEndEvent) => {
        unsubscribe?.();
        if (event?.status === 'error') {
          finish({ text: null, error: generationEndErrorMessage(event) });
          return;
        }
        const aligned = emitFromAccumulators(true);
        finish(finishAligned(aligned));
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
