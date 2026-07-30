/**
 * Browser resolver for outbound prompt token estimate (Feature 25).
 */

import { resolveActiveWorkAgent } from '../../agents/resolve-work-agent';
import {
  applyUiDesignerToolFilter,
  prepareUiDesignerTurn,
} from '../../agents/ui-designer/runner';
import { getModelRowForSelectOrCanonicalId } from '../../api/models';
import { contextLengthFromModelRow } from '../../lib/context-length';
import { normalizeModeId } from '../modes/types';
import { getActiveChat } from '../../state/sessions';
import type { ApiMessage, Chat } from '../../types';
import type { OpenAIFunctionDefinition } from '../../tools/definitions';
import { getEnabledToolDefinitionsForMode } from '../../tools/client';
import { pushOutboundSystemMessages } from '../../tools/api-system-messages';
import {
  agentContextBudgetFromWorkAgent,
  DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
  estimateApiMessagesTokens,
  resolveContextBudget,
  serializeApiMessageForEstimate,
} from '../context-budget';
import { estimateContextPolicyTrim } from '../context/apply-policy';
import {
  resolveOutboundSystemMessages,
  type BuildComposeContextOptions,
} from './compose-context';
import {
  computeOutboundPromptEstimateFromParts,
  estimateTokensFromText,
  formatTokenEstimateLabel,
  historyToApiMessagesForEstimate,
  TOKEN_ESTIMATE_TOOLTIP,
  type OutboundPromptEstimate,
} from './token-estimate-core';

export {
  ESTIMATE_IMAGE_URL_TOKENS,
  computeOutboundPromptEstimateFromParts,
  estimateHistoryTokens,
  estimateTokensFromText,
  estimateToolsTokens,
  formatTokenEstimateLabel,
  historyToApiMessagesForEstimate,
  serializeMessageContentForEstimate,
  TOKEN_ESTIMATE_TOOLTIP,
  type OutboundPromptEstimate,
} from './token-estimate-core';

export interface ResolveOutboundPromptEstimateOptions {
  chat?: Chat;
  composeOptions?: BuildComposeContextOptions;
  /** Active model id — used to mirror per-agent context budget trimming. */
  modelId?: string;
}

function readLegacySystemPromptText(): string {
  if (typeof document === 'undefined') return '';
  const el = document.getElementById('systemPrompt') as HTMLTextAreaElement | null;
  return el?.value?.trim() ?? '';
}

function lastUserRouteText(chat: Chat): string {
  const last = chat.history
    .slice()
    .reverse()
    .find((m) => m.role === 'user');
  return last?.content?.slice(0, 500) ?? '';
}

function resolveEnabledToolsForEstimate(chat: Chat): OpenAIFunctionDefinition[] {
  const modeId = normalizeModeId(chat.modeId);
  let enabledTools = getEnabledToolDefinitionsForMode(modeId);
  const activeWorkAgent = resolveActiveWorkAgent(chat);
  if (activeWorkAgent?.allowedTools?.length) {
    const allow = new Set(activeWorkAgent.allowedTools);
    enabledTools = enabledTools.filter((t) => allow.has(t.function.name));
  }
  const uiDesignerCtx = prepareUiDesignerTurn(chat, {
    skillId: null,
    userText: '',
    workAgentId: chat.workAgentId,
  });
  return applyUiDesignerToolFilter(enabledTools, uiDesignerCtx);
}

function resolveModelLimitForEstimate(modelId: string | undefined, chat: Chat): number | null {
  const fromChat = chat.modelInfo?.context_length;
  if (typeof fromChat === 'number' && Number.isFinite(fromChat) && fromChat > 0) {
    return fromChat;
  }
  const id = modelId?.trim();
  if (!id) return null;
  const cached = getModelRowForSelectOrCanonicalId(id);
  if (cached) return contextLengthFromModelRow(cached);
  return null;
}

function buildOutboundApiMessagesForEstimate(
  chat: Chat,
  systemText: string,
  userRulesText: string,
): ApiMessage[] {
  const messages: ApiMessage[] = [];
  pushOutboundSystemMessages(messages, {
    composedSystemPrompt: systemText,
    legacySysPrompt: '',
    userRulesContent: userRulesText || undefined,
  });
  messages.push(...historyToApiMessagesForEstimate(chat.history));
  return messages;
}

function countHistoryTokensFromApiMessages(messages: ApiMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    total += estimateTokensFromText(serializeApiMessageForEstimate(msg));
  }
  return total;
}

/** Apply model-window context policy trimming estimate for the context ring. */
function applyBudgetTrimToHistoryTokens(
  chat: Chat,
  modelId: string | undefined,
  systemText: string,
  userRulesText: string,
  rawHistoryTokens: number,
): { history: number; compressedEstimate: number; wouldCompress: boolean } {
  const apiMessages = buildOutboundApiMessagesForEstimate(chat, systemText, userRulesText);
  const workAgent = resolveActiveWorkAgent(chat);
  const agentConfig = workAgent
    ? agentContextBudgetFromWorkAgent(workAgent)
    : { enforcementPolicy: DEFAULT_CONTEXT_ENFORCEMENT_POLICY };
  const budgetResolved = resolveContextBudget({
    agentConfig,
    modelLimit: resolveModelLimitForEstimate(modelId, chat),
  });
  if (budgetResolved.effectiveLimit == null) {
    return { history: rawHistoryTokens, compressedEstimate: 0, wouldCompress: false };
  }
  if (estimateApiMessagesTokens(apiMessages) <= budgetResolved.effectiveLimit) {
    return { history: rawHistoryTokens, compressedEstimate: 0, wouldCompress: false };
  }
  const trimmed = estimateContextPolicyTrim(apiMessages, budgetResolved, agentConfig);
  const historyOnly = countHistoryTokensFromApiMessages(apiMessages);
  if (!trimmed.wouldCompress) {
    return { history: historyOnly, compressedEstimate: 0, wouldCompress: false };
  }
  return {
    history: trimmed.historyTokens,
    compressedEstimate: trimmed.compressedEstimateTokens,
    wouldCompress: true,
  };
}

/**
 * Approximate first tool-loop request size for the active (or given) chat.
 */
export async function resolveOutboundPromptEstimate(
  options?: ResolveOutboundPromptEstimateOptions,
): Promise<OutboundPromptEstimate> {
  const chat = options?.chat ?? getActiveChat();
  const routeUserText =
    options?.composeOptions?.routeUserText ??
    options?.composeOptions?.userMessagePreview ??
    lastUserRouteText(chat);

  const legacyText = readLegacySystemPromptText();
  let outbound: Awaited<ReturnType<typeof resolveOutboundSystemMessages>>;
  try {
    outbound = await resolveOutboundSystemMessages(chat, legacyText, {
      ...options?.composeOptions,
      routeUserText,
      userMessagePreview: routeUserText,
    });
  } catch {
    outbound = { composed: legacyText, userRules: null };
  }

  const legacyFallback = !outbound.composed && !!legacyText;

  const estimate = computeOutboundPromptEstimateFromParts({
    systemText: outbound.composed,
    history: chat.history,
    tools: resolveEnabledToolsForEstimate(chat),
    userRulesText: outbound.userRules ?? '',
    legacyFallback,
  });

  const trimResult = applyBudgetTrimToHistoryTokens(
    chat,
    options?.modelId,
    outbound.composed,
    outbound.userRules ?? '',
    estimate.history,
  );

  if (!trimResult.wouldCompress && trimResult.history === estimate.history) {
    return estimate;
  }

  const compressedExtra = trimResult.compressedEstimate;
  const historyTokens = trimResult.history;

  return {
    ...estimate,
    history: historyTokens,
    historyCompressed: trimResult.wouldCompress,
    compressedContextEstimate: compressedExtra > 0 ? compressedExtra : undefined,
    total:
      estimate.composedSystem + estimate.userRules + historyTokens + estimate.tools,
  };
}
