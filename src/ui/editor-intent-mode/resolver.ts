/**
 * Single-line Intent resolve via the shared editor AI binding (MIN-131).
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
  resolveEditorAiBinding,
  resolveEditorCompletionDisplayText,
  validateEditorAiBinding,
} from '../editor-ai-completion-client';
import { sanitizeQuickEditText } from '../editor-quick-edit/diff-apply';
import { resolveLanguageDescription } from '../editor-language';
import type { ResolveIntentLineInput, IntentResolveResult } from './types';

function languageLabelForPath(filePath: string): string {
  const desc = resolveLanguageDescription(filePath);
  return desc?.name ?? 'plain text';
}

/** System prompt: translate one line of intent into code for the detected language. */
export function systemPromptForIntent(filePath: string): string {
  const label = languageLabelForPath(filePath);
  return (
    `You translate brief intent (plain English, pseudocode, or incomplete/invalid ${label}) ` +
    `into one correct line of ${label} code. ` +
    'The intent line may have typos or syntax errors — fix them in your output. ' +
    'Return ONLY the code for that single line — no markdown fences, explanations, ' +
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
): void {
  contentAcc.ingestChoice(chunk.choices?.[0]);
  reasoningAcc.ingestChunk(chunk);
}

export interface IntentResolveDeps {
  createGeneration?: typeof createGeneration;
  subscribeToGeneration?: typeof subscribeToGeneration;
  cancelGeneration?: typeof cancelGeneration;
  resolveProvider?: typeof resolveProvider;
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

/** Stream a single-line intent resolve. */
export async function resolveIntentLine(
  input: ResolveIntentLineInput & { filePath: string },
  deps: IntentResolveDeps = {},
): Promise<IntentResolveResult> {
  const createGen = deps.createGeneration ?? createGeneration;
  const subscribeGen = deps.subscribeToGeneration ?? subscribeToGeneration;
  const cancelGen = deps.cancelGeneration ?? cancelGeneration;
  const resolveProv = deps.resolveProvider ?? resolveProvider;

  const config = await loadEditorAiCompletionConfig();
  const binding = await resolveEditorAiBinding(config);
  const validation = validateEditorAiBinding(binding);
  if (validation.ok === false) {
    return { text: null, error: validation.message };
  }

  const provider = await resolveProv(binding.providerId);
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
    ({ generationId } = await createGen(provider.id, body, { persist: false }));
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
      input.intentText,
    );

  return new Promise<IntentResolveResult>((resolve) => {
    let settled = false;
    const finish = (result: IntentResolveResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let unsubscribe: (() => void) | null = null;
    unsubscribe = subscribeGen(generationId, {
      signal: input.signal,
      onChunk: (chunk) => {
        ingestChunk(contentAcc, reasoningAcc, chunk);
        const cleaned = emit(false);
        if (cleaned) input.onPartial?.(cleaned);
      },
      onEnd: (event?: GenerationEndEvent) => {
        unsubscribe?.();
        if (event?.status === 'error') {
          finish({ text: null, error: generationEndErrorMessage(event) });
          return;
        }
        const cleaned = emit(true);
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
