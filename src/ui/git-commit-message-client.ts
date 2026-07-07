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
import { splitThinkingSegments } from '../api/reasoning';
import { thinkingToCompletionBody } from '../agents/thinking-to-body';
import { BenchmarkStreamReasoningAccumulator } from '../benchmark/stream-text';
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
const COMMIT_TYPE = '(?:feat|fix|docs|style|refactor|test|chore|perf|build|ci)';
const CONVENTIONAL_COMMIT_LINE_RE = new RegExp(
  `^${COMMIT_TYPE}(?:\\([^)]+\\))?:\\s+\\S`,
  'i',
);

/** Lines that are model reasoning / meta commentary, not commit body text. */
const REASONING_LINE_RE =
  /^\s*(?:the user |i need |i should |i will |let me |thinking(?:\s+process)?\s*:|looking at |based on |(?:okay|alright|hmm|right|so|well|first|next|now)[,.]?\s+(?:the|i|let|this|that)|looks good|that should|this looks|the diff |the changes |this diff |these changes |analy(?:s|z)(?:e|ing)|i(?:'ll| will) (?:use|write|draft|create|choose|pick|go with))/i;

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

function looksLikeReasoningLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return REASONING_LINE_RE.test(trimmed);
}

function hasUnclosedThinkingTag(text: string): boolean {
  if (/<think(?:ing)?(?:\s+[^>]*)?>[\s\S]*$/i.test(text) && !/<\/think(?:ing)?>/i.test(text)) {
    return true;
  }
  if (/<think>[\s\S]*$/i.test(text) && !/<\/redacted_thinking>/i.test(text)) {
    return true;
  }
  return false;
}

/** Keep Gemma response-channel prose; drop thought-channel monologue when present. */
function extractGemmaResponseChannel(text: string): string {
  const responseMatch = /<\|channel>response\s*\n?([\s\S]*?)(?:<channel\|>|$)/i.exec(text);
  if (responseMatch?.[1]?.trim()) return responseMatch[1].trim();
  return text.replace(/<\|channel>thought\s*\n?[\s\S]*?(?:<channel\|>|$)/gi, '').trim();
}

/** Drop closed inline thinking tags only — avoid chat heuristics that split reasoning chains. */
export function stripThinkingFromCommitOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (hasUnclosedThinkingTag(trimmed)) return '';
  const gemma = extractGemmaResponseChannel(trimmed);
  const stripped = gemma
    .replace(/<think(?:ing)?(?:\s+[^>]*)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .trim();
  if (hasUnclosedThinkingTag(stripped)) return '';
  return stripped;
}

/** Trim leading/trailing reasoning paragraphs while keeping the commit message body. */
export function stripReasoningFraming(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length) {
    const trimmed = lines[start].trim();
    if (!trimmed) {
      start += 1;
      continue;
    }
    if (looksLikeReasoningLine(trimmed)) {
      start += 1;
      continue;
    }
    break;
  }

  let end = lines.length;
  while (end > start) {
    const trimmed = lines[end - 1].trim();
    if (!trimmed) {
      end -= 1;
      continue;
    }
    if (
      looksLikeReasoningLine(trimmed) ||
      /^\s*(?:looks good|done|perfect|great)\.?\s*$/i.test(trimmed)
    ) {
      end -= 1;
      continue;
    }
    break;
  }

  return lines.slice(start, end).join('\n').trim();
}

function looksLikeCommitMessageSegment(segment: string): boolean {
  const lines = segment.trim().split('\n').filter((line) => line.trim());
  if (lines.length === 0) return false;
  const firstLine = lines[0].trim();
  if (looksLikeReasoningLine(firstLine)) return false;
  if (CONVENTIONAL_COMMIT_LINE_RE.test(firstLine)) return true;
  if (/\b(?:reasoning|mirrored|dumping|analy(?:s|z)(?:e|ing)|thinking)\b/i.test(segment)) {
    return false;
  }
  if (firstLine.length <= 72 && !firstLine.endsWith('?')) {
    const words = firstLine.split(/\s+/);
    if (words.length >= 2 && words.length <= 12 && !/^(this|these|the|that|there|it|strip)\s/i.test(firstLine)) {
      return true;
    }
  }
  return false;
}

function extractExplicitCommitMessagePrefix(text: string): string {
  for (const line of text.split('\n')) {
    const match = /^(?:commit message|message):\s*(.+)$/i.exec(line.trim());
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function collectCommitBlockFromLine(lines: string[], subjectIdx: number): string {
  const kept: string[] = [];
  for (let i = subjectIdx; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (i > subjectIdx && looksLikeReasoningLine(trimmed)) break;
    if (i > subjectIdx && /^\s*(?:looks good|done|perfect|great)\.?\s*$/i.test(trimmed)) break;
    kept.push(lines[i]);
  }
  return kept.join('\n').trim();
}

/**
 * Pull the commit message out of a reasoning chain. Prefer the last conventional
 * commit block; otherwise the last paragraph that looks like a commit message.
 */
export function extractCommitMessageFromChain(raw: string): string {
  const stripped = stripThinkingFromCommitOutput(raw);
  if (!stripped) return '';

  const prefixed = extractExplicitCommitMessagePrefix(stripped);
  if (prefixed) {
    const candidate = sanitizeCommitMessage(stripReasoningFraming(prefixed));
    if (candidate) return candidate;
  }

  const lines = stripped.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || looksLikeReasoningLine(trimmed)) continue;
    if (CONVENTIONAL_COMMIT_LINE_RE.test(trimmed)) {
      return sanitizeCommitMessage(collectCommitBlockFromLine(lines, i));
    }
  }

  const segments = splitThinkingSegments(stripped);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (!looksLikeCommitMessageSegment(segments[i])) continue;
    const candidate = sanitizeCommitMessage(stripReasoningFraming(segments[i]));
    if (candidate) return candidate;
  }

  const framed = stripReasoningFraming(stripped);
  if (framed && looksLikeCommitMessageSegment(framed)) {
    return sanitizeCommitMessage(framed);
  }

  return '';
}

/** Normalize stripped model text into a commit message. */
export function normalizeCommitMessageOutput(raw: string): string {
  return extractCommitMessageFromChain(raw);
}

/**
 * Resolve display text from content/reasoning channels. Never surfaces a raw
 * reasoning chain — providers often mirror reasoning into `content`.
 */
export function resolveCommitMessageDisplayText(
  contentText: string,
  reasoningText: string,
  options?: { reasoningFallback?: boolean },
): string {
  const content = contentText.trim();
  const reasoning = reasoningText.trim();
  const mirrored = content.length > 0 && reasoning.length > 0 && content === reasoning;

  if (content.length > 0) {
    const fromContent = extractCommitMessageFromChain(contentText);
    if (fromContent) return fromContent;

    // Main-branch fast path: clean one-shot content with no reasoning markers.
    if (!mirrored && content.split('\n').length <= 4) {
      const firstLine = content.split('\n')[0]?.trim() ?? '';
      if (firstLine && !looksLikeReasoningLine(firstLine)) {
        const direct = sanitizeCommitMessage(content);
        if (direct) return direct;
      }
    }
  }

  if (!options?.reasoningFallback) return '';

  if (reasoning.length > 0 && !mirrored) {
    const fromReasoning = extractCommitMessageFromChain(reasoningText);
    if (fromReasoning) return fromReasoning;
  }

  if (content.length > 0) {
    return extractCommitMessageFromChain(contentText);
  }

  return '';
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
