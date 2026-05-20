/**
 * Browser resolver for outbound prompt token estimate (Feature 25).
 */

import { resolveActiveWorkAgent } from '../../agents/resolve-work-agent';
import {
  applyUiDesignerToolFilter,
  prepareUiDesignerTurn,
} from '../../agents/ui-designer/runner';
import { normalizeModeId } from '../modes/types';
import { getActiveChat } from '../../state/sessions';
import type { Chat } from '../../types';
import type { OpenAIFunctionDefinition } from '../../tools/definitions';
import { getEnabledToolDefinitionsForMode } from '../../tools/client';
import {
  resolveOutboundSystemMessages,
  type BuildComposeContextOptions,
} from './compose-context';
import {
  computeOutboundPromptEstimateFromParts,
  estimateTokensFromText,
  formatTokenEstimateLabel,
  TOKEN_ESTIMATE_TOOLTIP,
  type OutboundPromptEstimate,
} from './token-estimate-core';

export {
  computeOutboundPromptEstimateFromParts,
  estimateHistoryTokens,
  estimateTokensFromText,
  estimateToolsTokens,
  formatTokenEstimateLabel,
  serializeMessageContentForEstimate,
  TOKEN_ESTIMATE_TOOLTIP,
  type OutboundPromptEstimate,
} from './token-estimate-core';

export interface ResolveOutboundPromptEstimateOptions {
  chat?: Chat;
  composeOptions?: BuildComposeContextOptions;
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

  return computeOutboundPromptEstimateFromParts({
    systemText: outbound.composed,
    history: chat.history,
    tools: resolveEnabledToolsForEstimate(chat),
    userRulesText: outbound.userRules ?? '',
    legacyFallback,
  });
}
