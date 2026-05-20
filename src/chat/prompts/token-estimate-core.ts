/**
 * Pure token estimate helpers (no DOM or compose imports — safe for Node tests).
 */

import type { AssistantToolCallMessage, Message } from '../../types';
import type { OpenAIFunctionDefinition } from '../../tools/definitions';

/** Rough token proxy for English-ish text; not model-accurate. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.round(text.length / 4);
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
  'Approximate size using characters ÷ 4. Real prompt tokens depend on the model tokenizer. Excludes pending composer text and attachments.';

/** Serialize one history row the same way string API messages count payload size. */
export function serializeMessageContentForEstimate(m: Message): string {
  if (m.role === 'user') return m.content;
  if (m.role === 'tool') return m.content;
  if (m.role === 'assistant') {
    const withTools = m as AssistantToolCallMessage;
    if (withTools.tool_calls?.length) {
      const content = withTools.content ?? '';
      return content + JSON.stringify(withTools.tool_calls);
    }
    return m.content;
  }
  return '';
}

/** Sum token estimate across all persisted chat turns. */
export function estimateHistoryTokens(history: Message[]): number {
  let total = 0;
  for (const m of history) {
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
