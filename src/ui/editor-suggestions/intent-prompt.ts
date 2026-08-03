/**
 * Intent resolve: instruct-style prompt, multi-line sanitation, and the
 * streaming request. Unlike inline completion this is a *replacement* of the
 * intent line, so the model is told to rewrite rather than continue.
 */

import {
  formatGenerationErrorMessage,
  type GenerationEndEvent,
} from '../../api/generations';
import { modelCache } from '../../app-state';
import { thinkingToCompletionBody } from '../../agents/thinking-to-body';
import { BenchmarkStreamReasoningAccumulator } from '../../benchmark/stream-text';
import { StreamingContentAccumulator } from '../../api/message-content';
import {
  getEditorAiCompletionConfigSync,
  loadEditorAiCompletionConfig,
  type EditorAiCompletionConfig,
} from '../../config/editor-ai-completion';
import type { EditorIntentModeConfig } from '../../config/editor-intent-mode';
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
  type EditorAiBinding,
} from '../editor-ai-completion-client';
import { reindentCompletionText, type RecentEditLine } from '../editor-ai-completion-prompt';
import { extractEditorCodeFromReasoning } from '../editor-model-output';
import { sanitizeQuickEditText } from '../editor-quick-edit/diff-apply';
import { streamEditorGeneration, type EditorAiStreamDeps } from '../editor-ai-stream';
import { resolveLanguageDescription } from '../editor-language';
import { leadingWhitespace } from './intent-heuristic';

/** Default cap for intent replacement output. */
export const INTENT_DEFAULT_MAX_TOKENS = 400;

/** Stop sequences for intent resolve (OpenAI-style). */
export const INTENT_STOP_SEQUENCES = ['```', '\n\n\n'];

export interface IntentResolveResult {
  text: string | null;
  error?: string;
}

export interface IntentPromptContext {
  filePath: string;
  /** Raw intent line, indentation included. */
  intentText: string;
  /** Instruction with any sigil / comment marker stripped. */
  instruction: string;
  /** Document text before the intent line. */
  prefix: string;
  /** Document text after the intent line. */
  suffix: string;
  /** Neighbor lines above the intent line (prompt context). */
  above?: string[];
  /** Neighbor lines below the intent line (prompt context). */
  below?: string[];
  recentEdits?: RecentEditLine[];
}

export interface ResolveIntentInput extends IntentPromptContext {
  /** Indentation the replacement block should be aligned to. */
  baseIndent: string;
  signal: AbortSignal;
  onPartial?: (text: string) => void;
  config?: EditorAiCompletionConfig;
  intentConfig?: EditorIntentModeConfig;
}

function languageLabelForPath(filePath: string): string {
  return resolveLanguageDescription(filePath)?.name ?? 'plain text';
}

/** System prompt: replace one line of intent with real code. */
export function systemPromptForIntent(filePath: string): string {
  const label = languageLabelForPath(filePath);
  return (
    'You are a code generator embedded in an editor. The user wrote a line of intent ' +
    `(plain English, pseudocode, or partial ${label}) that must be replaced by real ` +
    `${label} code. Output ONLY the replacement code. You may output multiple lines. ` +
    'Do not repeat surrounding context. No markdown fences, no explanation.'
  );
}

function formatRecentEdits(edits: RecentEditLine[] | undefined): string {
  if (!edits?.length) return '';
  return edits
    .map((e) => `L${e.lineNumber} before: ${e.before}\nL${e.lineNumber} after: ${e.after}`)
    .join('\n');
}

/** Build the instruct-style messages for an intent resolve. */
export function buildIntentMessages(input: IntentPromptContext): ApiMessage[] {
  const aboveBlock =
    input.above && input.above.length > 0
      ? input.above.join('\n')
      : '(none)';
  const belowBlock =
    input.below && input.below.length > 0
      ? input.below.join('\n')
      : '(none)';
  const sections = [
    `File: ${input.filePath.trim() || 'untitled'}`,
    '--- resolved context above ---',
    aboveBlock,
    '--- intent line to replace ---',
    input.instruction || input.intentText,
    '--- resolved context below ---',
    belowBlock,
    '--- code before (full prefix) ---',
    input.prefix || '(none)',
    '--- code after (full suffix) ---',
    input.suffix || '(none)',
  ];
  const edits = formatRecentEdits(input.recentEdits);
  if (edits) {
    sections.push('--- recently edited lines ---', edits);
  }
  return [
    { role: 'system', content: systemPromptForIntent(input.filePath) },
    { role: 'user', content: sections.join('\n') },
  ];
}

/**
 * Shift a block of model output so its first line sits at `baseIndent`,
 * preserving relative indentation of the remaining lines.
 */
export function reindentBlock(lines: string[], baseIndent: string): string[] {
  if (lines.length === 0) return [];
  const firstIndent = leadingWhitespace(lines[0] ?? '');
  if (firstIndent === baseIndent) return [...lines];
  return lines.map((line, index) => {
    if (!line.trim()) return '';
    if (index === 0) return baseIndent + line.slice(firstIndent.length);
    const indent = leadingWhitespace(line);
    if (firstIndent && indent.startsWith(firstIndent)) {
      return baseIndent + indent.slice(firstIndent.length) + line.slice(indent.length);
    }
    if (!firstIndent) return baseIndent + line;
    return baseIndent + line.trimStart();
  });
}

/**
 * Normalize a multi-line replacement: first line via the shared completion
 * indentation rules, remaining lines shifted by the same delta.
 */
export function alignIntentBlock(code: string, baseIndent: string, indentUnit = '  '): string {
  const normalized = code.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (!normalized.trim()) return '';
  const lines = normalized.split('\n');
  const syntheticPrefix = `\n${baseIndent}`;
  const firstAligned = reindentCompletionText(`\n${lines[0] ?? ''}`, syntheticPrefix, indentUnit);
  const targetIndent = leadingWhitespace(firstAligned.replace(/^\n+/, ''));
  if (lines.length === 1) return targetIndent + lines[0]!.slice(leadingWhitespace(lines[0]!).length);
  return reindentBlock(lines, targetIndent).join('\n');
}

/**
 * Sanitize streamed output for an intent replacement. Prose-only replies fall
 * back to mining code out of the reasoning channel once the stream has ended.
 */
export function finalizeIntentText(
  contentText: string,
  reasoningText: string,
  intentText: string,
  reasoningFallback: boolean,
  baseIndent = '',
): string {
  const align = (raw: string): string => {
    const cleaned = sanitizeQuickEditText(raw, intentText);
    if (!cleaned.trim()) return '';
    return alignIntentBlock(cleaned, baseIndent);
  };

  const primary = align(
    resolveEditorCompletionDisplayText(contentText, reasoningText, { reasoningFallback }),
  );
  if (primary.trim()) return primary;
  if (!reasoningFallback) return '';

  const combined = [contentText, reasoningText]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n');
  if (!combined) return '';
  const mined = extractEditorCodeFromReasoning(combined);
  if (!mined.trim()) return '';
  return align(mined);
}

export interface IntentResolveDeps extends EditorAiStreamDeps {
  resolveProvider?: typeof resolveProvider;
  resolveBinding?: typeof resolveEditorAiBinding;
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

/** Intent uses its own pin when set, otherwise the shared editor AI binding. */
export async function resolveIntentBinding(
  config: EditorAiCompletionConfig,
  intentConfig: EditorIntentModeConfig | undefined,
  resolveBinding = resolveEditorAiBinding,
): Promise<EditorAiBinding> {
  const providerId = intentConfig?.providerId?.trim() ?? '';
  const modelId = intentConfig?.modelId?.trim() ?? '';
  if (providerId && modelId) return { providerId, modelId };
  return resolveBinding(config);
}

/** Stream one intent replacement. */
export async function resolveIntentSuggestion(
  input: ResolveIntentInput,
  deps: IntentResolveDeps = {},
): Promise<IntentResolveResult> {
  const resolveProv = deps.resolveProvider ?? resolveProvider;
  const resolveBinding = deps.resolveBinding ?? resolveEditorAiBinding;

  const config =
    input.config ?? (await loadEditorAiCompletionConfig().catch(() => getEditorAiCompletionConfigSync()));
  const binding = await resolveIntentBinding(config, input.intentConfig, resolveBinding);
  const validation = validateEditorAiBinding(binding);
  if (validation.ok === false) {
    return { text: null, error: validation.message };
  }

  const provider = await resolveProv(binding.providerId);
  const maxTokens = Math.min(
    input.intentConfig?.maxTokens ?? INTENT_DEFAULT_MAX_TOKENS,
    INTENT_DEFAULT_MAX_TOKENS,
  );
  const body: Record<string, unknown> = {
    model: binding.modelId || undefined,
    messages: buildIntentMessages(input),
    temperature: 0.1,
    max_tokens: maxTokens,
    stop: INTENT_STOP_SEQUENCES,
    stream: true,
  };

  const modelId = binding.modelId.trim();
  const modelRow = modelId
    ? modelCache.get(encodeModelSelectKey(provider.id, modelId))
    : undefined;
  const modelCaps =
    modelRow?.capabilities ?? (modelRow ? catalogCapabilitiesFromRow(modelRow) : undefined);
  const { body: thinkingPatch } = thinkingToCompletionBody('off', provider.apiKind, modelCaps);
  Object.assign(body, thinkingPatch);

  const contentAcc = new StreamingContentAccumulator();
  const reasoningAcc = new BenchmarkStreamReasoningAccumulator();

  const emit = (reasoningFallback = false): string =>
    finalizeIntentText(
      contentAcc.getText(),
      reasoningAcc.getText(),
      input.intentText,
      reasoningFallback,
      input.baseIndent,
    );

  return new Promise<IntentResolveResult>((resolve) => {
    let settled = false;
    const finish = (result: IntentResolveResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    void streamEditorGeneration(
      provider.id,
      body,
      input.signal,
      {
        onChunk: (chunk: ChatCompletionChunk) => {
          contentAcc.ingestChoice(chunk.choices?.[0]);
          reasoningAcc.ingestChunk(chunk);
          const cleaned = emit(false);
          if (cleaned) input.onPartial?.(cleaned);
        },
        onEnd: (event?: GenerationEndEvent) => {
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
        onTransportError: (err: unknown) => {
          finish({ text: null, error: createGenerationErrorMessage(err) });
        },
        onAbort: () => {
          finish({ text: null });
        },
      },
      deps,
    ).catch((err) => {
      finish({ text: null, error: createGenerationErrorMessage(err) });
    });
  });
}
