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
import { thinkingToCompletionBody } from '../agents/thinking-to-body';
import { modelCache } from '../app-state';
import { getPendingAttachments } from '../attachments/store';
import {
  buildExpandPromptMessages,
  sanitizeExpandedPrompt,
} from '../chat/prompts/expand-prompt';
import { encodeModelSelectKey } from '../lib/model-select-key';
import { prepareChatCompletionsBinding } from '../api/resolve-chat-completions-binding';
import { catalogCapabilitiesFromRow } from '../providers/model-capabilities';
import { resolveProvider } from '../providers/store';
import { getActiveChat } from '../state/sessions';
import { resolveEffectiveChatModelBinding } from './default-model';
import type { Attachment } from '../attachments/types';

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

/** Thinking is dead weight here — the answer is prose in `content`. */
function thinkingOffPatch(
  providerApiKind: Parameters<typeof thinkingToCompletionBody>[1],
  providerId: string,
  modelId: string,
): Record<string, unknown> {
  const modelRow = modelId
    ? modelCache.get(encodeModelSelectKey(providerId, modelId))
    : undefined;
  const capabilities =
    modelRow?.capabilities ??
    (modelRow ? catalogCapabilitiesFromRow(modelRow) : undefined);
  const { body } = thinkingToCompletionBody('off', providerApiKind, capabilities);
  return body as Record<string, unknown>;
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

  const provider = await resolveProvider(binding.providerId);
  const body: Record<string, unknown> = {
    model: binding.modelId,
    messages: buildExpandPromptMessages(draft, attachments),
    temperature: EXPAND_TEMPERATURE,
    max_tokens: EXPAND_MAX_TOKENS,
    stream: true,
    ...thinkingOffPatch(provider.apiKind, provider.id, binding.modelId),
  };

  let generationId: string;
  try {
    ({ generationId } = await createGeneration(provider.id, body, {
      persist: false,
      fallbackRole: 'utility',
    }));
  } catch (err) {
    return { text: null, error: errorMessageFrom(err) };
  }

  const acc = new StreamingContentAccumulator();

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
        acc.ingestChoice(chunk.choices?.[0]);
        const partial = sanitizeExpandedPrompt(acc.getText(), { partial: true });
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
        const text = sanitizeExpandedPrompt(acc.getText());
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
