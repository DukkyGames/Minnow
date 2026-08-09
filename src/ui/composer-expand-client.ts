/**
 * Streams an expanded prompt from the active chat model via /api/generations.
 * Utility role, persist: false — expansion never lands in chat history.
 */

import {
  cancelGeneration,
  createGeneration,
  formatGenerationErrorMessage,
  subscribeToGeneration,
  type GenerationEndEvent,
} from '../api/generations';
import { StreamingContentAccumulator } from '../api/message-content';
import { applyUtilityThinkingOff } from '../agents/merge-thinking-body';
import {
  BenchmarkStreamReasoningAccumulator,
  resolveBenchmarkCompletionText,
} from '../benchmark/stream-text';
import { modelCache } from '../app-state';
import { getPendingAttachments } from '../attachments/store';
import {
  buildExpandPromptMessages,
  sanitizeExpandedPrompt,
} from '../chat/prompts/expand-prompt';
import { encodeModelSelectKey } from '../lib/model-select-key';
import { prepareChatCompletionsBinding } from '../api/resolve-chat-completions-binding';
import { catalogCapabilitiesFromRow } from '../providers/model-capabilities';
import { invalidateProviderCache, resolveProvider } from '../providers/store';
import { getActiveChat } from '../state/sessions';
import { resolveEffectiveChatModelBinding } from './default-model';
import type { Attachment } from '../attachments/types';
import type { ChatCompletionChunk } from '../types';

/** Room for a paragraph or a short bullet list — not an essay. */
const EXPAND_MAX_TOKENS = 700;
const EXPAND_TEMPERATURE = 0.4;

export const EXPAND_NO_MODEL_MESSAGE =
  'No model assigned — pick a model before expanding.';
export const EXPAND_FAILED_MESSAGE =
  'Expand failed — check provider and model in Settings';
export const EXPAND_EMPTY_MESSAGE = 'Model returned no expanded prompt.';

export interface ExpandPromptBinding {
  providerId: string;
  modelId: string;
}

export interface ExpandPromptRequest {
  draft: string;
  signal: AbortSignal;
  /** Files staged in the composer; defaults to the pending attachment list. */
  attachments?: readonly Attachment[];
  /** Called with sanitized text as it streams. */
  onPartial?: (text: string) => void;
}

export interface ExpandPromptResult {
  text: string | null;
  error?: string;
}

/**
 * Same priority as chat send: per-chat composer model, then global default — not the
 * menubar #modelSelect alone when the chat has its own binding.
 */
export async function resolveExpandPromptBinding(): Promise<ExpandPromptBinding> {
  const chat = getActiveChat();
  const effective = resolveEffectiveChatModelBinding(chat);
  const modelId = effective.modelId.trim();
  const providerId =
    effective.providerId?.trim() ||
    chat.providerId?.trim() ||
    (await resolveProvider()).id;
  return { providerId, modelId };
}

function errorMessageFrom(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return formatGenerationErrorMessage(err.message);
  }
  return EXPAND_FAILED_MESSAGE;
}

function endErrorMessage(event?: GenerationEndEvent): string {
  const raw = event?.errorMessage?.trim();
  return raw ? formatGenerationErrorMessage(raw) : EXPAND_FAILED_MESSAGE;
}

function ingestExpandChunk(
  contentAcc: StreamingContentAccumulator,
  reasoningAcc: BenchmarkStreamReasoningAccumulator,
  chunk: ChatCompletionChunk,
): void {
  contentAcc.ingestChoice(chunk.choices?.[0]);
  reasoningAcc.ingestChunk(chunk);
}

/**
 * Prefer sanitized main content; on completion, accept reasoning-only streams
 * (common when thinking-off is ignored or reasoning lands outside `content`).
 */
function resolveExpandedDisplayText(
  contentText: string,
  reasoningText: string,
  options: { reasoningFallback?: boolean; partial?: boolean } = {},
): string {
  const fromContent = sanitizeExpandedPrompt(contentText, { partial: options.partial });
  if (fromContent) return fromContent;
  if (!options.reasoningFallback) return '';
  const merged = resolveBenchmarkCompletionText(contentText, reasoningText);
  return sanitizeExpandedPrompt(merged, { partial: options.partial });
}

/** Stream one expansion of `draft`; resolves with the final sanitized prompt. */
export async function fetchExpandedPrompt(
  input: ExpandPromptRequest,
): Promise<ExpandPromptResult> {
  const draft = input.draft.trim();
  if (!draft) return { text: null };
  // Attachments enrich the draft; they never stand in for one.
  const attachments = input.attachments ?? getPendingAttachments();

  const rawBinding = await resolveExpandPromptBinding();
  if (!rawBinding.modelId.trim()) {
    return { text: null, error: EXPAND_NO_MODEL_MESSAGE };
  }

  let binding: ExpandPromptBinding;
  try {
    binding = await prepareChatCompletionsBinding(
      rawBinding.providerId,
      rawBinding.modelId,
      input.signal,
    );
  } catch (err) {
    return { text: null, error: errorMessageFrom(err) };
  }

  invalidateProviderCache();
  const provider = await resolveProvider(binding.providerId);
  const modelRow = binding.modelId
    ? modelCache.get(encodeModelSelectKey(binding.providerId, binding.modelId))
    : undefined;
  const modelCaps =
    modelRow?.capabilities ??
    (modelRow ? catalogCapabilitiesFromRow(modelRow) : undefined);

  const body: Record<string, unknown> = {
    model: binding.modelId,
    messages: buildExpandPromptMessages(draft, attachments),
    temperature: EXPAND_TEMPERATURE,
    max_tokens: EXPAND_MAX_TOKENS,
    stream: true,
  };
  applyUtilityThinkingOff(body, provider, modelCaps);

  let generationId: string;
  try {
    ({ generationId } = await createGeneration(binding.providerId, body, {
      persist: false,
      fallbackRole: 'utility',
    }));
  } catch (err) {
    return { text: null, error: errorMessageFrom(err) };
  }

  const contentAcc = new StreamingContentAccumulator();
  const reasoningAcc = new BenchmarkStreamReasoningAccumulator();

  return new Promise<ExpandPromptResult>((resolve) => {
    let settled = false;
    const finish = (text: string | null, error?: string): void => {
      if (settled) return;
      settled = true;
      resolve(error ? { text: null, error } : { text });
    };

    const unsubscribe = subscribeToGeneration(generationId, {
      signal: input.signal,
      onChunk: (chunk) => {
        ingestExpandChunk(contentAcc, reasoningAcc, chunk);
        const partial = resolveExpandedDisplayText(
          contentAcc.getText(),
          reasoningAcc.getText(),
          { partial: true },
        );
        if (partial) input.onPartial?.(partial);
      },
      onEnd: (event?: GenerationEndEvent) => {
        unsubscribe();
        if (event?.status === 'error') {
          finish(null, endErrorMessage(event));
          return;
        }
        if (event?.status === 'cancelled') {
          finish(null);
          return;
        }
        const text = resolveExpandedDisplayText(
          contentAcc.getText(),
          reasoningAcc.getText(),
          { reasoningFallback: true },
        );
        finish(text || null, text ? undefined : EXPAND_EMPTY_MESSAGE);
      },
      onTransportError: (err) => {
        unsubscribe();
        finish(null, errorMessageFrom(err));
      },
    });

    input.signal.addEventListener(
      'abort',
      () => {
        unsubscribe();
        void cancelGeneration(generationId).catch(() => {
          /* best-effort, matches commit-message client */
        });
        finish(null);
      },
      { once: true },
    );
  });
}
