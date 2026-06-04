/**
 * Stream Quick Edit completions via /api/generations (Phase 4).
 */

import { extractMessageText } from '../../api/chat';
import {
  cancelGeneration,
  createGeneration,
  subscribeToGeneration,
  type GenerationEndEvent,
} from '../../api/generations';
import { modelCache } from '../../app-state';
import { thinkingToCompletionBody } from '../../agents/thinking-to-body';
import {
  BenchmarkStreamReasoningAccumulator,
  resolveBenchmarkCompletionText,
} from '../../benchmark/stream-text';
import { StreamingContentAccumulator } from '../../api/message-content';
import { loadEditorAiCompletionConfig } from '../../config/editor-ai-completion';
import { encodeModelSelectKey } from '../../lib/model-select-key';
import { catalogCapabilitiesFromRow } from '../../providers/model-capabilities';
import { resolveProvider } from '../../providers/store';
import type { ApiMessage, ChatCompletionChunk } from '../../types';
import { resolveEditorAiBinding } from '../editor-ai-completion-client';
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
  'selected region — no markdown fences, explanations, or text outside the selection.';

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
): string {
  contentAcc.ingestChoice(chunk.choices?.[0]);
  reasoningAcc.ingestChunk(chunk);
  const fromStream = resolveBenchmarkCompletionText(
    contentAcc.getText(),
    reasoningAcc.getText(),
  );
  if (fromStream) return fromStream;
  return extractMessageText(chunk.choices?.[0]?.message).trim();
}

/** Stream a quick-edit replacement; returns null when backend is unavailable. */
export async function fetchQuickEditReplacement(
  input: QuickEditRequestInput,
): Promise<string | null> {
  const config = await loadEditorAiCompletionConfig();
  const binding = await resolveEditorAiBinding(config);
  if (!binding.providerId.trim()) return null;

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
  } catch {
    return null;
  }

  const contentAcc = new StreamingContentAccumulator();
  const reasoningAcc = new BenchmarkStreamReasoningAccumulator();

  const emit = (): string =>
    sanitizeQuickEditText(
      resolveBenchmarkCompletionText(contentAcc.getText(), reasoningAcc.getText()),
      input.selectionText,
    );

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
        ingestChunk(contentAcc, reasoningAcc, chunk);
        const cleaned = emit();
        if (cleaned) input.onPartial?.(cleaned);
      },
      onEnd: (event?: GenerationEndEvent) => {
        unsubscribe();
        if (event?.status === 'error') {
          finish(null);
          return;
        }
        const cleaned = emit();
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
