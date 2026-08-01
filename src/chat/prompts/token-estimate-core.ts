/**
 * Pure token estimate helpers (no DOM or compose imports — safe for Node tests).
 */

import type { ApiMessage, AssistantToolCallMessage, Message } from '../../types';
import type { OpenAIFunctionDefinition } from '../../tools/definitions';

/** Rough token proxy for English-ish text; not model-accurate. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.round(text.length / 4);
}

/** Fixed per-image token proxy (aligned with API `image_url` budgeting). */
export const ESTIMATE_IMAGE_URL_TOKENS = 256;

/** User-facing label for a token count. */
export function formatTokenEstimateLabel(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '—';
  if (tokens >= 1000) {
    return `~${(tokens / 1000).toFixed(1)}k tokens (estimate)`;
  }
  return `~${tokens.toLocaleString()} tokens (estimate)`;
}

export const TOKEN_ESTIMATE_TOOLTIP =
  'Approximate size using characters ÷ 4. Real prompt tokens depend on the model tokenizer. Excludes pending composer text and attachments.';

/** Settings header tooltip — fixed prompt config only (no chat history). */
export const SETTINGS_PROMPT_CONFIG_ESTIMATE_TOOLTIP =
  'Approximate system prompt, rules, and tools using characters ÷ 4. Excludes chat history, pending composer text, and attachments.';

/**
 * Map persisted chat history to API messages for token estimate.
 * Mirrors `buildApiMessages` history rows — assistant `thinking` is UI-only and excluded.
 */
export function historyToApiMessagesForEstimate(history: Message[]): ApiMessage[] {
  const messages: ApiMessage[] = [];
  for (const m of history) {
    if (m.role === 'context') continue;
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: m.content,
      });
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
  if (m.role === 'user') return m.content;
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

/** Sum token estimate across all persisted chat turns (excludes context notices). */
export function estimateHistoryTokens(history: Message[]): number {
  let total = 0;
  for (const m of history) {
    if (m.role === 'context') continue;
    total += estimateTokensFromText(serializeMessageContentForEstimate(m));
  }
  return total;
}

/** Token estimate for enabled tool JSON schemas. */
export function estimateToolsTokens(tools: OpenAIFunctionDefinition[]): number {
  if (tools.length === 0) return 0;
  return estimateTokensFromText(JSON.stringify(tools));
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
