/**
 * Stream Quick Edit completions via /api/generations (Phase 4).
 */


import {
  cancelGeneration,
  createGeneration,
  formatGenerationErrorMessage,
  subscribeToGeneration,
  type GenerationEndEvent,
} from '../../api/generations';
import { modelCache } from '../../app-state';
import { thinkingToCompletionBody } from '../../agents/thinking-to-body';
import { BenchmarkStreamReasoningAccumulator } from '../../benchmark/stream-text';
import { StreamingContentAccumulator } from '../../api/message-content';
import { loadEditorAiCompletionConfig } from '../../config/editor-ai-completion';
import { encodeModelSelectKey } from '../../lib/model-select-key';
import { catalogCapabilitiesFromRow } from '../../providers/model-capabilities';
import { resolveProvider } from '../../providers/store';
import type { ApiMessage, ChatCompletionChunk } from '../../types';
import {
  EDITOR_AI_EMPTY_COMPLETION_MESSAGE,
  EDITOR_AI_REQUEST_FAILED_MESSAGE,
  resolveEditorCompletionDisplayText,
  resolveEditorAiBinding,
  validateEditorAiBinding,
} from '../editor-ai-completion-client';
import { sanitizeQuickEditText } from './diff-apply';

export interface QuickEditRequestInput {
  filePath: string;
  selectionText: string;
  fromLine: number;
  toLine: number;
  instruction: string;
  signal: AbortSignal;
  onPartial?: (text: string) => void;
}

const QUICK_EDIT_SYSTEM =
  'You are a precise code editor assistant. Return ONLY the replacement text for the ' +
  'selected region — no markdown fences, explanations, thinking tags, or text outside the selection. ' +
  'Never wrap output in reasoning or thinking markup.';

function buildQuickEditMessages(input: QuickEditRequestInput): ApiMessage[] {
  const userBody = [
    `File: ${input.filePath}`,
    `Selection (lines ${input.fromLine}-${input.toLine}):`,
    '---',
    input.selectionText,
    '---',
    `Instruction: ${input.instruction.trim() || 'Improve this code.'}`,
  ].join('\n');

  return [
    { role: 'system', content: QUICK_EDIT_SYSTEM },
    { role: 'user', content: userBody },
  ];
}

function ingestChunk(
  contentAcc: StreamingContentAccumulator,
  reasoningAcc: BenchmarkStreamReasoningAccumulator,
  chunk: ChatCompletionChunk,
): void {
  contentAcc.ingestChoice(chunk.choices?.[0]);
  reasoningAcc.ingestChunk(chunk);
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

export interface QuickEditFetchResult {
  text: string | null;
  error?: string;
}

/** Stream a quick-edit replacement; returns error text when model or backend is unavailable. */
export async function fetchQuickEditReplacement(
  input: QuickEditRequestInput,
): Promise<QuickEditFetchResult> {
  const config = await loadEditorAiCompletionConfig();
  const binding = await resolveEditorAiBinding(config);
  const validation = validateEditorAiBinding(binding);
  if (validation.ok === false) {
    return { text: null, error: validation.message };
  }

  const provider = await resolveProvider(binding.providerId);
  const messages = buildQuickEditMessages(input);
  const body: Record<string, unknown> = {
    model: binding.modelId || undefined,
    messages,
    temperature: Math.min(config.temperature + 0.1, 1),
    max_tokens: Math.max(config.maxTokens, 512),
    stream: true,
  };

  const modelId = binding.modelId.trim();
  const modelRow = modelId
    ? modelCache.get(encodeModelSelectKey(provider.id, modelId))
    : undefined;
  const modelCaps =
    modelRow?.capabilities ??
    (modelRow ? catalogCapabilitiesFromRow(modelRow) : undefined);
  const { body: thinkingPatch } = thinkingToCompletionBody(
    'off',
    provider.apiKind,
    modelCaps,
  );
  Object.assign(body, thinkingPatch);

  let generationId: string;
  try {
    ({ generationId } = await createGeneration(provider.id, body, { persist: false }));
  } catch (err) {
    return { text: null, error: createGenerationErrorMessage(err) };
  }

  const contentAcc = new StreamingContentAccumulator();
  const reasoningAcc = new BenchmarkStreamReasoningAccumulator();

  const emit = (reasoningFallback = false): string =>
    sanitizeQuickEditText(
      resolveEditorCompletionDisplayText(
        contentAcc.getText(),
        reasoningAcc.getText(),
        { reasoningFallback },
      ),
      input.selectionText,
    );

  return new Promise<QuickEditFetchResult>((resolve) => {
    let settled = false;
    const finish = (text: string | null, error?: string): void => {
      if (settled) return;
      settled = true;
      resolve(error ? { text: null, error } : { text });
    };

    const unsubscribe = subscribeToGeneration(generationId, {
      signal: input.signal,
      onChunk: (chunk) => {
        ingestChunk(contentAcc, reasoningAcc, chunk);
        const cleaned = emit(false);
        if (cleaned) input.onPartial?.(cleaned);
      },
      onEnd: (event?: GenerationEndEvent) => {
        unsubscribe();
        if (event?.status === 'error') {
          finish(null, generationEndErrorMessage(event));
          return;
        }
        const cleaned = emit(true);
        finish(
          cleaned.length > 0 ? cleaned : null,
          cleaned.length > 0 ? undefined : EDITOR_AI_EMPTY_COMPLETION_MESSAGE,
        );
      },
      onTransportError: (err) => {
        unsubscribe();
        finish(null, createGenerationErrorMessage(err));
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
