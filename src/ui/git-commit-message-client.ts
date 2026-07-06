/**
 * Generate conventional commit messages from staged diffs via /api/generations.
 */

import {
  cancelGeneration,
  createGeneration,
  formatGenerationErrorMessage,
  subscribeToGeneration,
  type GenerationEndEvent,
} from '../api/generations';
import { modelCache } from '../app-state';
import { extractInlineThinkingFromContent } from '../api/inline-thinking';
import { thinkingToCompletionBody } from '../agents/thinking-to-body';
import {
  BenchmarkStreamReasoningAccumulator,
} from '../benchmark/stream-text';
import { StreamingContentAccumulator } from '../api/message-content';
import { loadEditorAiCompletionConfig, type EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { encodeModelSelectKey } from '../lib/model-select-key';
import { catalogCapabilitiesFromRow } from '../providers/model-capabilities';
import { resolveProvider } from '../providers/store';
import type { ApiMessage, ChatCompletionChunk } from '../types';
import {
  EDITOR_AI_EMPTY_COMPLETION_MESSAGE,
  EDITOR_AI_REQUEST_FAILED_MESSAGE,
  resolveEditorAiBinding,
  validateEditorAiBinding,
  type EditorAiBinding,
} from './editor-ai-completion-client';

const COMMIT_MSG_SYSTEM =
  'You write git commit messages from git diffs. ' +
  'Output ONLY the commit message — no markdown fences, explanations, or prefixes like "Commit message:". ' +
  'Use conventional commits: type(scope): subject (≤72 chars on first line), optional blank line and body explaining why. ' +
  'Types: feat, fix, docs, style, refactor, test, chore. Imperative mood, no trailing period on subject.';

const MAX_PATCH_CHARS = 12_000;

export interface GitCommitMessageRequest {
  stagedPaths: string[];
  patch: string;
  signal: AbortSignal;
  onPartial?: (text: string) => void;
}

export interface GitCommitMessageResult {
  text: string | null;
  error?: string;
}

/** Cap oversized staged diffs so prompts stay within model context. */
export function truncateStagedPatch(patch: string, maxChars = MAX_PATCH_CHARS): string {
  const trimmed = patch.trimEnd();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n\n... (diff truncated)`;
}

/** Build system + user messages for a staged-diff commit message request. */
export function buildGitCommitMessagePrompt(
  stagedPaths: string[],
  patch: string,
): ApiMessage[] {
  const fileList = stagedPaths.length > 0 ? stagedPaths.join('\n') : '(see diff)';
  const userBody = [
    'Changed files:',
    fileList,
    '',
    'Diff:',
    '---',
    truncateStagedPatch(patch),
    '---',
    'Write the commit message.',
  ].join('\n');

  return [
    { role: 'system', content: COMMIT_MSG_SYSTEM },
    { role: 'user', content: userBody },
  ];
}

const CONVENTIONAL_COMMIT_LINE_RE =
  /^(feat|fix|docs|style|refactor|test|chore)(\([^)]+\))?:\s+\S/m;

/** Drop inline thinking tags; prefer the reply segment when both exist. */
export function stripThinkingFromCommitOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const split = extractInlineThinkingFromContent(trimmed);
  if (split.reply.trim()) return split.reply.trim();
  return trimmed
    .replace(/<think(?:ing)?(?:\s+[^>]*)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .trim();
}

/**
 * Prefer main `content`; at stream end fall back to reasoning when prose stayed empty
 * (common on thinking-capable models).
 */
export function resolveCommitMessageDisplayText(
  contentText: string,
  reasoningText: string,
  options?: { reasoningFallback?: boolean },
): string {
  const fromContent = sanitizeCommitMessage(stripThinkingFromCommitOutput(contentText));
  if (fromContent) return fromContent;
  if (!options?.reasoningFallback) return '';

  const fromReasoning = sanitizeCommitMessage(stripThinkingFromCommitOutput(reasoningText));
  if (!fromReasoning) return '';

  const match = fromReasoning.match(CONVENTIONAL_COMMIT_LINE_RE);
  if (match?.index !== undefined && match.index > 0) {
    return fromReasoning.slice(match.index).trim();
  }
  return fromReasoning;
}

/** Normalize model output into a plain commit message string. */
export function sanitizeCommitMessage(raw: string): string {
  let text = raw.trim();

  const fenceMatch = text.match(/^```(?:\w+)?\s*([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  text = text.replace(/^(commit message|message):\s*/i, '');
  return text.trim();
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

/**
 * Git commit messages use the active chat model when editor AI is disabled
 * or configured to follow chat; otherwise the pinned editor model.
 */
export async function resolveGitCommitMessageBinding(
  config: EditorAiCompletionConfig,
): Promise<EditorAiBinding> {
  if (!config.enabled || config.useChatModel) {
    return resolveEditorAiBinding({ ...config, useChatModel: true });
  }
  return resolveEditorAiBinding(config);
}

/** Stream a commit message from the active editor/chat model binding. */
export async function fetchGitCommitMessage(
  input: GitCommitMessageRequest,
): Promise<GitCommitMessageResult> {
  const config = await loadEditorAiCompletionConfig();
  const binding = await resolveGitCommitMessageBinding(config);
  const validation = validateEditorAiBinding(binding);
  if (validation.ok === false) {
    return { text: null, error: validation.message };
  }

  const provider = await resolveProvider(binding.providerId);
  const messages = buildGitCommitMessagePrompt(input.stagedPaths, input.patch);
  const body: Record<string, unknown> = {
    model: binding.modelId || undefined,
    messages,
    temperature: Math.min(config.temperature + 0.1, 0.7),
    max_tokens: Math.max(config.maxTokens, 256),
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
    ({ generationId } = await createGeneration(provider.id, body, {
      persist: false,
      fallbackRole: 'utility',
    }));
  } catch (err) {
    return { text: null, error: createGenerationErrorMessage(err) };
  }

  const contentAcc = new StreamingContentAccumulator();
  const reasoningAcc = new BenchmarkStreamReasoningAccumulator();

  const emit = (reasoningFallback = false): string =>
    resolveCommitMessageDisplayText(
      contentAcc.getText(),
      reasoningAcc.getText(),
      { reasoningFallback },
    );

  return new Promise<GitCommitMessageResult>((resolve) => {
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
        if (event?.status === 'cancelled') {
          finish(null);
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
