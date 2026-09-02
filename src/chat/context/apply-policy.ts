import type { ApiMessage } from '../../types';
import {
  applyContextBudget,
  countPinnedSystemMessages,
  dropOldestTurnsUntilUnderLimit,
  estimateApiMessagesTokens,
  injectSummaryMessage,
  rebuildFromTurns,
  resolveContextBudget,
  type AgentContextBudgetConfig,
  type ApplyContextBudgetResult,
  type ContextEnforcementPolicy,
  type ResolvedContextBudget,
} from '../context-budget';
import { summarizeDroppedTurns } from './llm-summarize';

export interface ApplyContextPolicyParams {
  messages: ApiMessage[];
  policy: ContextEnforcementPolicy;
  modelLimit: number | null;
  agentConfig: AgentContextBudgetConfig;
  providerId: string;
  modelId: string;
  signal?: AbortSignal;
  onStatus?: (level: 'spin' | 'ok', message: string) => void;
  /** Tokens the request spends outside `messages` (tool schemas in `body.tools`). */
  reservedTokens?: number;
  /** Force the message ceiling — used by compact-and-retry with provider-measured numbers. */
  effectiveLimitOverride?: number | null;
}

export type ApplyContextPolicyResult = ApplyContextBudgetResult;

async function applyLlmSummarizePolicy(
  messages: ApiMessage[],
  resolved: ResolvedContextBudget,
  agentConfig: AgentContextBudgetConfig,
  providerId: string,
  modelId: string,
  signal?: AbortSignal,
  onStatus?: ApplyContextPolicyParams['onStatus'],
): Promise<ApplyContextPolicyResult> {
  const limit = resolved.effectiveLimit!;
  const tokensBefore = estimateApiMessagesTokens(messages);
  const systemEnd = countPinnedSystemMessages(messages);
  const minRecentTurns = Math.max(1, Math.floor(agentConfig.minRecentTurns ?? 2));
  const summaryReserveTokens = Math.max(
    64,
    Math.floor(agentConfig.summaryReserveTokens ?? 512),
  );

  const { turns, droppedChunks, droppedTurns } = dropOldestTurnsUntilUnderLimit(
    messages,
    limit,
    systemEnd,
    minRecentTurns,
  );

  if (droppedTurns === 0) {
    const fallback = applyContextBudget(messages, resolved, {
      ...agentConfig,
      enforcementPolicy: 'truncate',
    });
    return fallback;
  }

  onStatus?.('spin', 'Summarizing context…');

  let summaryText: string | undefined;
  let usedLlm = false;

  const llm = await summarizeDroppedTurns({
    droppedText: droppedChunks.join('\n\n'),
    providerId,
    modelId,
    summaryReserveTokens,
    signal,
  });
  summaryText = llm.summaryBody;
  usedLlm = llm.usedLlm;

  let nextMessages = rebuildFromTurns(messages, systemEnd, turns);
  let summaryInjected = false;

  if (summaryText?.trim()) {
    nextMessages = injectSummaryMessage(nextMessages, systemEnd, summaryText);
    summaryInjected = true;
  } else {
    const dropMiddle = applyContextBudget(messages, {
      ...resolved,
      policy: 'dropMiddle',
    }, agentConfig);
    return dropMiddle;
  }

  let tokensAfter = estimateApiMessagesTokens(nextMessages);
  if (tokensAfter > limit) {
    const tightened = applyContextBudget(nextMessages, resolved, {
      ...agentConfig,
      enforcementPolicy: 'dropMiddle',
    });
    if (tightened.applied) {
      return {
        ...tightened,
        policy: 'summarize',
        droppedTurns,
        summaryInjected: summaryInjected || tightened.summaryInjected,
        summaryText: summaryText ?? tightened.summaryText,
        statusMessage: formatSummarizeStatus(droppedTurns, usedLlm),
      };
    }
  }

  return {
    messages: nextMessages,
    applied: true,
    policy: 'summarize',
    tokensBefore,
    tokensAfter: estimateApiMessagesTokens(nextMessages),
    droppedMessageCount: 0,
    droppedTurns,
    summaryInjected,
    summaryText,
    statusMessage: formatSummarizeStatus(droppedTurns, usedLlm),
  };
}

function formatSummarizeStatus(droppedTurns: number, usedLlm: boolean): string {
  const mode = usedLlm ? 'summarized' : 'compressed (extractive fallback)';
  return `Context ${mode}: ${droppedTurns} older turn${droppedTurns === 1 ? '' : 's'} omitted`;
}

/**
 * Apply context enforcement before a provider send (async LLM summarize + sync policies).
 */
export async function applyContextPolicy(
  params: ApplyContextPolicyParams,
): Promise<ApplyContextPolicyResult> {
  const resolved = resolveContextBudget({
    agentConfig: params.agentConfig,
    modelLimit: params.modelLimit,
    reservedTokens: params.reservedTokens,
    effectiveLimitOverride: params.effectiveLimitOverride,
  });

  const limit = resolved.effectiveLimit;
  const tokensBefore = estimateApiMessagesTokens(params.messages);
  if (limit == null || tokensBefore <= limit) {
    return {
      messages: params.messages,
      applied: false,
      policy: resolved.policy,
      tokensBefore,
      tokensAfter: tokensBefore,
      droppedMessageCount: 0,
      droppedTurns: 0,
      summaryInjected: false,
      statusMessage: null,
    };
  }

  if (resolved.policy === 'summarize') {
    try {
      return await applyLlmSummarizePolicy(
        params.messages,
        resolved,
        params.agentConfig,
        params.providerId,
        params.modelId,
        params.signal,
        params.onStatus,
      );
    } catch {
      const fallback = applyContextBudget(params.messages, {
        ...resolved,
        policy: 'dropMiddle',
      }, params.agentConfig);
      if (!fallback.applied) {
        return applyContextBudget(params.messages, {
          ...resolved,
          policy: 'truncate',
        }, params.agentConfig);
      }
      return fallback;
    }
  }

  return applyContextBudget(params.messages, resolved, params.agentConfig);
}

export interface EstimateContextPolicyTrimResult {
  historyTokens: number;
  compressedEstimateTokens: number;
  wouldCompress: boolean;
}

/**
 * Sync token estimate for the context ring when LLM summarize would apply.
 */
export function estimateContextPolicyTrim(
  messages: ApiMessage[],
  resolved: ResolvedContextBudget,
  agentConfig?: AgentContextBudgetConfig,
): EstimateContextPolicyTrimResult {
  const limit = resolved.effectiveLimit;
  const tokensBefore = estimateApiMessagesTokens(messages);
  if (limit == null || tokensBefore <= limit) {
    return { historyTokens: tokensBefore, compressedEstimateTokens: 0, wouldCompress: false };
  }

  if (resolved.policy === 'summarize' || resolved.policy === 'dropMiddle') {
    const systemEnd = countPinnedSystemMessages(messages);
    const minRecentTurns = Math.max(1, Math.floor(agentConfig?.minRecentTurns ?? 2));
    const summaryReserveTokens = Math.max(
      64,
      Math.floor(agentConfig?.summaryReserveTokens ?? 512),
    );
    const { turns, droppedTurns } = dropOldestTurnsUntilUnderLimit(
      messages,
      limit,
      systemEnd,
      minRecentTurns,
    );
    if (droppedTurns === 0) {
      const applied = applyContextBudget(messages, resolved, agentConfig);
      return {
        historyTokens: applied.tokensAfter,
        compressedEstimateTokens: 0,
        wouldCompress: applied.applied,
      };
    }
    const kept = rebuildFromTurns(messages, systemEnd, turns);
    const keptTokens = estimateApiMessagesTokens(kept);
    return {
      historyTokens: keptTokens + summaryReserveTokens,
      compressedEstimateTokens: summaryReserveTokens,
      wouldCompress: true,
    };
  }

  const applied = applyContextBudget(messages, resolved, agentConfig);
  return {
    historyTokens: applied.tokensAfter,
    compressedEstimateTokens: 0,
    wouldCompress: applied.applied,
  };
}
