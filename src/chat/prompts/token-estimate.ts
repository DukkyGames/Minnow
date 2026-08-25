/**
 * Browser resolver for outbound prompt token estimate (Feature 25).
 */

import {
  getPromptConfigEpoch,
  getToolConfigEpoch,
} from '../outbound-estimate-epochs';
import { resolveActiveWorkAgent, resolveActiveWorkAgentId } from '../../agents/resolve-work-agent';
import {
  applyUiDesignerToolFilter,
  prepareUiDesignerTurn,
} from '../../agents/ui-designer/runner';
import { getUserRulesPayloadForSend, loadUserRules } from '../../config/user-rules';
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
  estimateApiMessageTokens,
  estimateApiMessagesTokens,
  resolveContextBudget,
} from '../context-budget';
import { estimateContextPolicyTrim } from '../context/apply-policy';
import {
  resolveExpertContextForSend,
  type BuildComposeContextOptions,
  buildComposeContext,
} from './compose-context';
import { composeSystemPrompt, isCodeMapPartEnabled, isContextDocumentsPartEnabled } from './prompt-composer';
import type { ComposeContext } from './types';
import {
  computeOutboundPromptEstimateFromParts,
  estimateHistoryTokens,
  estimateTokensFromText,
  formatTokenEstimateLabel,
  historyToApiMessagesForEstimate,
  TOKEN_ESTIMATE_TOOLTIP,
  type HistoryEstimateOptions,
  type OutboundPromptEstimate,
} from './token-estimate-core';
import { fetchReplayPriorReasoningEnabled } from '../context/reasoning-replay-config';

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
  type HistoryEstimateOptions,
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
  if (cached) return contextLengthFromModelRow(cached) ?? null;
  return null;
}

function buildOutboundApiMessagesForEstimate(
  chat: Chat,
  systemText: string,
  userRulesText: string,
  historyOptions?: HistoryEstimateOptions,
): ApiMessage[] {
  const messages: ApiMessage[] = [];
  pushOutboundSystemMessages(messages, {
    composedSystemPrompt: systemText,
    legacySysPrompt: '',
    userRulesContent: userRulesText || undefined,
  });
  messages.push(...historyToApiMessagesForEstimate(chat.history, historyOptions));
  return messages;
}

function countHistoryTokensFromApiMessages(messages: ApiMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    total += estimateApiMessageTokens(msg);
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
  toolsTokens: number,
  historyOptions?: HistoryEstimateOptions,
): { history: number; compressedEstimate: number; wouldCompress: boolean } {
  const apiMessages = buildOutboundApiMessagesForEstimate(
    chat,
    systemText,
    userRulesText,
    historyOptions,
  );
  const workAgent = resolveActiveWorkAgent(chat);
  const agentConfig = workAgent
    ? agentContextBudgetFromWorkAgent(workAgent)
    : { enforcementPolicy: DEFAULT_CONTEXT_ENFORCEMENT_POLICY };
  const budgetResolved = resolveContextBudget({
    agentConfig,
    modelLimit: resolveModelLimitForEstimate(modelId, chat),
    // Match the send-time budget: tools are outside `messages` but inside the window.
    reservedTokens: toolsTokens,
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
async function resolveOutboundComposeForEstimate(
  chat: Chat,
  options?: ResolveOutboundPromptEstimateOptions,
): Promise<{
  composed: string;
  userRules: string | null;
  ctx: ComposeContext;
  legacyFallback: boolean;
}> {
  const routeUserText =
    options?.composeOptions?.routeUserText ??
    options?.composeOptions?.userMessagePreview ??
    lastUserRouteText(chat);
  const legacyText = readLegacySystemPromptText();

  const expertCtx = await resolveExpertContextForSend(chat, routeUserText);
  const activeWorkAgent = resolveActiveWorkAgent(chat);
  const workAgentId = resolveActiveWorkAgentId(chat);

  const composeOpts: BuildComposeContextOptions = {
    ...options?.composeOptions,
    routeUserText,
    userMessagePreview: routeUserText,
    // Same replay cap the send path uses, so the ring counts what actually ships.
    modelContextLimit:
      options?.composeOptions?.modelContextLimit ??
      resolveModelLimitForEstimate(options?.modelId, chat),
    overrides: {
      expertId: expertCtx.routeSource === 'orphaned' ? null : expertCtx.expertId,
      expertLabel: expertCtx.expertLabel,
      workAgentId,
      workAgentLabel: activeWorkAgent?.label ?? null,
      ...options?.composeOptions?.overrides,
    },
  };

  let ctx: ComposeContext;
  try {
    ctx = await buildComposeContext(chat, composeOpts);
  } catch {
    ctx = await buildComposeContext(chat, {
      routeUserText,
      userMessagePreview: routeUserText,
    });
  }

  let composedRaw = '';
  try {
    composedRaw = composeSystemPrompt(ctx);
  } catch {
    composedRaw = '';
  }
  const composedTrimmed = composedRaw.trim() || legacyText.trim();
  const legacyFallback = !composedRaw.trim() && !!legacyText.trim();

  const rulesSettings = await loadUserRules();
  const userRules = getUserRulesPayloadForSend(rulesSettings);

  return { composed: composedTrimmed, userRules, ctx, legacyFallback };
}

interface CachedOutboundStaticEstimate {
  composed: string;
  userRules: string | null;
  legacyFallback: boolean;
  ctx: ComposeContext | null;
  composedSystem: number;
  userRulesTokens: number;
  tools: number;
  codeMapSystem?: number;
  codeMapInjectionEnabled?: boolean;
  contextDocumentsSystem?: number;
  contextDocumentsInjectionEnabled?: boolean;
}

let cachedStaticEstimateKey = '';
let cachedStaticEstimate: CachedOutboundStaticEstimate | null = null;

function outboundStaticEstimateCacheKey(chatId: string, modelId: string): string {
  return `${chatId}\0${modelId}\0${getToolConfigEpoch()}\0${getPromptConfigEpoch()}`;
}

/** Clear composed-system + tools memo (unit tests). */
export function resetOutboundPromptEstimateCacheForTests(): void {
  cachedStaticEstimateKey = '';
  cachedStaticEstimate = null;
}

async function resolveCachedStaticOutboundEstimate(
  chat: Chat,
  options: ResolveOutboundPromptEstimateOptions | undefined,
): Promise<CachedOutboundStaticEstimate> {
  const modelId = options?.modelId?.trim() ?? '';
  const cacheKey = outboundStaticEstimateCacheKey(chat.id, modelId);
  if (cacheKey === cachedStaticEstimateKey && cachedStaticEstimate) {
    return cachedStaticEstimate;
  }

  let composed = '';
  let userRules: string | null = null;
  let legacyFallback = false;
  let ctx: ComposeContext | null = null;
  try {
    const resolved = await resolveOutboundComposeForEstimate(chat, options);
    composed = resolved.composed;
    userRules = resolved.userRules;
    legacyFallback = resolved.legacyFallback;
    ctx = resolved.ctx;
  } catch {
    composed = readLegacySystemPromptText();
    legacyFallback = !!composed.trim();
  }

  const tools = resolveEnabledToolsForEstimate(chat);
  const partial = computeOutboundPromptEstimateFromParts({
    systemText: composed,
    history: [],
    tools,
    userRulesText: userRules ?? '',
    legacyFallback,
  });

  const entry: CachedOutboundStaticEstimate = {
    composed,
    userRules,
    legacyFallback,
    ctx,
    composedSystem: partial.composedSystem,
    userRulesTokens: partial.userRules,
    tools: partial.tools,
  };

  if (ctx) {
    if (ctx.codeMapInjectionEnabled === true) {
      entry.codeMapInjectionEnabled = true;
    }
    if (isCodeMapPartEnabled(ctx) && ctx.codeMapBlock?.trim()) {
      entry.codeMapSystem = estimateTokensFromText(ctx.codeMapBlock);
    }
    if (ctx.contextDocumentsInjectionEnabled === true) {
      entry.contextDocumentsInjectionEnabled = true;
    }
    if (isContextDocumentsPartEnabled(ctx) && ctx.contextDocumentsBlock?.trim()) {
      entry.contextDocumentsSystem = estimateTokensFromText(ctx.contextDocumentsBlock);
    }
  }

  cachedStaticEstimateKey = cacheKey;
  cachedStaticEstimate = entry;
  return entry;
}

export async function resolveOutboundPromptEstimate(
  options?: ResolveOutboundPromptEstimateOptions,
): Promise<OutboundPromptEstimate> {
  const chat = options?.chat ?? getActiveChat();

  const staticPart = await resolveCachedStaticOutboundEstimate(chat, options);
  // Mirrors what the send path will actually put on the wire (Phase 4 replay).
  const historyOptions: HistoryEstimateOptions = {
    replayPriorReasoning: await fetchReplayPriorReasoningEnabled(),
    modelId: options?.modelId,
  };
  const historyTokens = estimateHistoryTokens(chat.history, historyOptions);

  const estimate: OutboundPromptEstimate = {
    total:
      staticPart.composedSystem +
      staticPart.userRulesTokens +
      historyTokens +
      staticPart.tools,
    composedSystem: staticPart.composedSystem,
    userRules: staticPart.userRulesTokens,
    history: historyTokens,
    tools: staticPart.tools,
    legacyFallback: staticPart.legacyFallback,
    codeMapSystem: staticPart.codeMapSystem,
    codeMapInjectionEnabled: staticPart.codeMapInjectionEnabled,
    contextDocumentsSystem: staticPart.contextDocumentsSystem,
    contextDocumentsInjectionEnabled: staticPart.contextDocumentsInjectionEnabled,
  };

  const trimResult = applyBudgetTrimToHistoryTokens(
    chat,
    options?.modelId,
    staticPart.composed,
    staticPart.userRules ?? '',
    estimate.history,
    staticPart.tools,
    historyOptions,
  );

  if (!trimResult.wouldCompress && trimResult.history === estimate.history) {
    return estimate;
  }

  const compressedExtra = trimResult.compressedEstimate;
  const trimmedHistoryTokens = trimResult.history;

  return {
    ...estimate,
    history: trimmedHistoryTokens,
    historyCompressed: trimResult.wouldCompress,
    compressedContextEstimate: compressedExtra > 0 ? compressedExtra : undefined,
    total:
      estimate.composedSystem + estimate.userRules + trimmedHistoryTokens + estimate.tools,
  };
}
