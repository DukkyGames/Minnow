/**
 * Single-line Intent resolve via the shared editor AI binding (MIN-131).
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
import { sanitizeQuickEditText } from '../editor-quick-edit/diff-apply';
import { resolveLanguageDescription } from '../editor-language';
import type { ResolveIntentLineInput } from './types';

function languageLabelForPath(filePath: string): string {
  const desc = resolveLanguageDescription(filePath);
  return desc?.name ?? 'plain text';
}

/** System prompt: translate one line of intent into code for the detected language. */
export function systemPromptForIntent(filePath: string): string {
  const label = languageLabelForPath(filePath);
  return (
    `You translate brief intent (plain English or pseudocode) into correct ${label} code. ` +
    'Return ONLY the code for the requested line — no markdown fences, explanations, ' +
    'or surrounding context.'
  );
}

function buildIntentMessages(input: ResolveIntentLineInput & { filePath: string }): ApiMessage[] {
  const aboveBlock =
    input.above.length > 0 ? input.above.join('\n') : '(none)';
  const belowBlock =
    input.below.length > 0 ? input.below.join('\n') : '(none)';
  const userBody = [
    `File: ${input.filePath}`,
    'Resolved context above:',
    '---',
    aboveBlock,
    '---',
    'Intent line to implement:',
    input.intentText,
    'Resolved context below:',
    '---',
    belowBlock,
    '---',
  ].join('\n');

  return [
    { role: 'system', content: systemPromptForIntent(input.filePath) },
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

/** Stream a single-line intent resolve; returns null when backend is unavailable. */
export async function resolveIntentLine(
  input: ResolveIntentLineInput & { filePath: string },
): Promise<string | null> {
  const config = await loadEditorAiCompletionConfig();
  const binding = await resolveEditorAiBinding(config);
  if (!binding.providerId.trim()) return null;

  const provider = await resolveProvider(binding.providerId);
  const messages = buildIntentMessages(input);
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
      input.intentText,
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
