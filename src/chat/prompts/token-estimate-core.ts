/**
 * Pure token estimate helpers (no DOM or compose imports — safe for Node tests).
 */

import type { ApiMessage, AssistantToolCallMessage, Message } from '../../types';
import type { OpenAIFunctionDefinition } from '../../tools/definitions';
import { isUiOnlyTranscriptMessage } from '../context/injection-notice';
import { toolImageFollowUpUserMessage } from '../tool-image-follow-up';

/**
 * Content class for {@link estimateTokensFromText}. Chars-per-token is not one
 * number: BPE eats repeated JSON keys and English words, and chokes on paths,
 * hashes, diffs, and terminal output.
 */
export type TokenEstimateKind = 'prose' | 'payload' | 'schema';

/**
 * Measured against the real tokenizer (Qwen3-27B) over orchestrate Builder
 * transcripts — the content that actually fills a context window here:
 *
 * - tool results          3.03 chars/token (file contents, diffs, shell output)
 * - assistant + tool_calls 3.16
 * - user prose             3.71
 * - minified tool schemas  4.69 (repeated keys collapse to single tokens)
 *
 * The shipped `chars ÷ 4` undercounted a real Builder transcript by 24–33%,
 * more than the context budget's whole safety margin — so enforcement could
 * never fire before the server rejected the request. Each divisor below sits at
 * or under its measurement so the estimate errs high, never low.
 * `schema` stays at 4.0 rather than 4.69 because the chat template, not the
 * wire JSON, decides the final shape of the tool block.
 */
const CHARS_PER_TOKEN: Record<TokenEstimateKind, number> = {
  prose: 3.6,
  payload: 3.0,
  schema: 4.0,
};

/** Chars-per-token divisor for a content class (token → char budgets). */
export function charsPerTokenFor(kind: TokenEstimateKind): number {
  return CHARS_PER_TOKEN[kind];
}

/** Rough token proxy; calibrated per content class, not model-accurate. */
export function estimateTokensFromText(
  text: string,
  kind: TokenEstimateKind = 'prose',
): number {
  if (!text) return 0;
  return Math.round(text.length / CHARS_PER_TOKEN[kind]);
}

/** Fixed per-image token proxy (aligned with API `image_url` budgeting). */
export const ESTIMATE_IMAGE_URL_TOKENS = 256;

/**
 * Filler that costs {@link ESTIMATE_IMAGE_URL_TOKENS} per image once run through
 * {@link estimateTokensFromText}. Image parts carry no text to measure, so every
 * estimator prices them by padding the serialized row — and the padding is in
 * *characters*, at the `prose` rate the row itself is measured with.
 */
export function imagePaddingForEstimate(imageCount: number): string {
  if (imageCount <= 0) return '';
  return ' '.repeat(
    Math.round(imageCount * ESTIMATE_IMAGE_URL_TOKENS * CHARS_PER_TOKEN.prose),
  );
}

/** User-facing label for a token count. */
export function formatTokenEstimateLabel(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '—';
  if (tokens >= 1000) {
    return `~${(tokens / 1000).toFixed(1)}k tokens (estimate)`;
  }
  return `~${tokens.toLocaleString()} tokens (estimate)`;
}

export const TOKEN_ESTIMATE_TOOLTIP =
  'Approximate size from character counts calibrated per content type. Real prompt tokens depend on the model tokenizer. Excludes pending composer text and attachments.';

/** Settings header tooltip — fixed prompt config only (no chat history). */
export const SETTINGS_PROMPT_CONFIG_ESTIMATE_TOOLTIP =
  'Approximate system prompt, rules, and tools from character counts calibrated per content type. Excludes chat history, pending composer text, and attachments.';

/**
 * Map persisted chat history to API messages for token estimate.
 * Mirrors `buildApiMessages` history rows — assistant `thinking` is UI-only and excluded.
 */
export function historyToApiMessagesForEstimate(history: Message[]): ApiMessage[] {
  const messages: ApiMessage[] = [];
  for (const m of history) {
    if (isUiOnlyTranscriptMessage(m)) continue;
    if (m.role === 'user') {
      // Stored attachment pixels ride along on later turns (see the replay in
      // buildApiMessages), so the estimate has to price them. Slightly high when
      // the replay budget trims older images — never low, which would let a chat
      // blow past the window without warning.
      const images = m.images ?? [];
      if (images.length > 0) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: m.content },
            ...images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: image.dataUrl, detail: 'auto' as const },
            })),
          ],
        });
        continue;
      }
      messages.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: m.content,
      });
      const followUp = toolImageFollowUpUserMessage(m);
      if (followUp) messages.push(followUp);
      continue;
    }
    if (m.role === 'assistant') {
      const withTools = m as AssistantToolCallMessage;
      if (withTools.tool_calls?.length) {
        messages.push({
          role: 'assistant',
          content: withTools.content ?? null,
          tool_calls: withTools.tool_calls,
        });
      } else {
        messages.push({ role: 'assistant', content: m.content });
      }
    }
  }
  return messages;
}

/** Serialize one history row the same way outbound API messages count payload size. */
export function serializeMessageContentForEstimate(m: Message): string {
  if (m.role === 'user') {
    const imageCount = m.images?.length ?? 0;
    if (imageCount === 0) return m.content;
    // Same fixed per-image proxy the outbound budget uses.
    return m.content + imagePaddingForEstimate(imageCount);
  }
  if (m.role === 'tool') return m.content;
  if (m.role === 'assistant') {
    const withTools = m as AssistantToolCallMessage;
    if (withTools.tool_calls?.length) {
      const content = withTools.content ?? '';
      return content + JSON.stringify(withTools.tool_calls);
    }
    return m.content ?? '';
  }
  return '';
}

/**
 * Token estimate for one persisted row, priced per content class: tool results
 * and serialized `tool_calls` are payload, everything the model wrote in prose
 * is prose.
 */
export function estimateMessageTokens(m: Message): number {
  if (m.role === 'user') {
    const images = m.images?.length ?? 0;
    return (
      estimateTokensFromText(m.content, 'prose') + images * ESTIMATE_IMAGE_URL_TOKENS
    );
  }
  if (m.role === 'tool') return estimateTokensFromText(m.content, 'payload');
  if (m.role === 'assistant') {
    const withTools = m as AssistantToolCallMessage;
    let total = estimateTokensFromText(withTools.content ?? '', 'prose');
    if (withTools.tool_calls?.length) {
      total += estimateTokensFromText(JSON.stringify(withTools.tool_calls), 'payload');
    }
    return total;
  }
  return 0;
}

/** Sum token estimate across all persisted chat turns (excludes context notices). */
export function estimateHistoryTokens(history: Message[]): number {
  let total = 0;
  for (const m of history) {
    if (isUiOnlyTranscriptMessage(m)) continue;
    total += estimateMessageTokens(m);
  }
  return total;
}

/** Token estimate for enabled tool JSON schemas. */
export function estimateToolsTokens(tools: OpenAIFunctionDefinition[]): number {
  if (tools.length === 0) return 0;
  return estimateTokensFromText(JSON.stringify(tools), 'schema');
}

export interface OutboundPromptEstimate {
  total: number;
  composedSystem: number;
  userRules: number;
  history: number;
  tools: number;
  legacyFallback: boolean;
  /** Approximate tokens for injected code map (subset of composedSystem). */
  codeMapSystem?: number;
  /** Resolved on for this estimate (map may still be loading). */
  codeMapInjectionEnabled?: boolean;
  /** Approximate tokens for injected context documents (subset of composedSystem). */
  contextDocumentsSystem?: number;
  contextDocumentsInjectionEnabled?: boolean;
  /** When context compression would apply on send. */
  historyCompressed?: boolean;
  compressedContextEstimate?: number;
}

/** System + rules + tools — excludes chat history (settings prompt config display). */
export function computePromptConfigTokenTotal(
  est: Pick<OutboundPromptEstimate, 'composedSystem' | 'userRules' | 'tools'>,
): number {
  return est.composedSystem + est.userRules + est.tools;
}

/** Pure breakdown from resolved strings. */
export function computeOutboundPromptEstimateFromParts(parts: {
  systemText: string;
  history: Message[];
  tools: OpenAIFunctionDefinition[];
  userRulesText?: string;
  legacyFallback?: boolean;
}): OutboundPromptEstimate {
  const composedSystem = estimateTokensFromText(parts.systemText.trim());
  const userRules = estimateTokensFromText(parts.userRulesText?.trim() ?? '');
  const history = estimateHistoryTokens(parts.history);
  const tools = estimateToolsTokens(parts.tools);
  return {
    total: composedSystem + userRules + history + tools,
    composedSystem,
    userRules,
    history,
    tools,
    legacyFallback: parts.legacyFallback === true,
  };
}
