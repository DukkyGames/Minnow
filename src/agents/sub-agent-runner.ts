/**
 * Isolated sub-agent completion + tool loop (no parent chat history).
 */

import {
  extractMessageText,
  extractStreamDelta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
  tryNonStreamingFallback,
  type StreamMetaAccumulator,
} from '../api/chat';
import { readProviderCapabilities } from '../providers/capability-probe';
import {
  applyConstrainedToolCallsToBody,
  isResponseFormatRejectionError,
  stripResponseFormatFromBody,
} from '../providers/constrained-tool-calls';
import type { CompletionBodyWithResponseFormat } from '../providers/completion-types';
import { postChatCompletions } from '../providers/fetch-chat';
import { modelCache } from '../app-state';
import {
  getToolCallsMetaSync,
  isConstrainedDecodingEnabledForProvider,
  loadToolCallsMeta,
} from '../config/tool-calls-meta';
import { getActiveProvider } from '../providers/store';
import { parseToolArguments } from '../tools/parse-tool-arguments';
import {
  applyContextBudget,
  estimateApiMessagesTokens,
  resolveContextBudget,
} from '../chat/context-budget';
import { SUB_AGENT_CONTEXT_BUDGET_ERROR } from './sub-agent-outcome';
import {
  buildSubAgentFinalizationPrompt,
  parseStructuredOutcomeJson,
  SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT,
  validateStructuredOutcome,
} from './sub-agent-structured-outcome';
import type { SubAgentBudgetEvent, SubAgentStructuredOutcome } from './sub-agent-structured-outcome';
import { contextLengthFromModelRow } from '../lib/context-length';
import { averageStatsSegments, sumUsageSegments } from '../chat/orchestrate/stats-math';
import { recordSubAgentTurnUsage } from '../usage/record-chat-usage';
import type { ApiMessage, ChatCompletionChunk, Stats, ToolCallAccumulator, Usage } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import { looksLikeProseStructuredQuestion } from '../tools/prose-question-detect';
import {
  MAX_PROSE_QUESTION_RETRIES,
  PROSE_QUESTION_RETRY_INSTRUCTION,
} from '../tools/turn-continuation';
import { getSubAgentTypeConfig } from './sub-agent-config';
import { resolveSamplerPreset } from './resolve-sampler';
import { applySamplerToBody } from './sampler-types';
import type { SubAgentRunner, SubAgentRunnerOutput } from './types';

/** Legacy export: prefer per-type `maxToolTurns` from sub-agents config. */
export const MAX_SUB_AGENT_TOOL_TURNS = 12;

function resolveSubAgentModelContextLimit(modelId: string): number | null {
  const id = modelId.trim();
  if (!id) return null;
  const cached = modelCache.get(id);
  if (!cached) return null;
  return contextLengthFromModelRow(cached);
}

/** Throttle live transcript pushes so the drawer can keep up while streaming. */
const LIVE_TRANSCRIPT_EMIT_MS = 80;

/** Deep-clone messages for orchestrator state + UI subscribers. */
export function cloneSubAgentMessages(messages: ApiMessage[]): ApiMessage[] {
  return JSON.parse(JSON.stringify(messages)) as ApiMessage[];
}

interface SubAgentCompletionBody extends CompletionBodyWithResponseFormat {
  model?: string;
  messages: ApiMessage[];
  temperature: number;
  max_tokens: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  stream?: boolean;
  tools?: OpenAIFunctionDefinition[];
  tool_choice?: 'auto';
}

/** Headless SSE turn (no DOM). */
async function streamSubAgentTurn(
  providerId: string,
  body: SubAgentCompletionBody,
  signal: AbortSignal,
  onDelta?: (delta: string) => void,
): Promise<{
  fullText: string;
  finishReason: string | undefined;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
  streamMeta: StreamMetaAccumulator;
  t0: number;
  tFirst: number | null;
  tEnd: number;
}> {
  const provider = await getActiveProvider(providerId);
  const res = await postChatCompletions(provider, body, signal);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};
  const t0 = performance.now();
  let tFirst: number | null = null;

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const sseBuffer = createSseEventBuffer();

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const delta = extractStreamDelta(chunk);
    if (delta) {
      if (tFirst == null) tFirst = performance.now();
      fullText += delta;
      onDelta?.(delta);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    feedSseEventBuffer(sseBuffer, decoder.decode(value, { stream: true }), handleChunk);
  }

  flushSseEventBuffer(sseBuffer, handleChunk);

  const finishReason =
    streamMeta.finish_reason ||
    (Object.keys(toolAcc).length > 0 ? 'tool_calls' : undefined);

  const tEnd = performance.now();

  return {
    fullText,
    finishReason,
    toolCalls: finalizeToolCalls(toolAcc),
    streamMeta,
    t0,
    tFirst,
    tEnd,
  };
}

async function ledgerSubAgentTurn(
  input: { parentChatId?: string | null; type: string; runId: string; providerId: string; modelId: string },
  turn: Awaited<ReturnType<typeof streamSubAgentTurn>>,
): Promise<void> {
  await recordSubAgentTurnUsage(input.parentChatId, {
    subAgentType: input.type,
    runId: input.runId,
    providerId: input.providerId,
    modelId: input.modelId,
    streamMeta: turn.streamMeta,
    t0: turn.t0,
    tFirst: turn.tFirst,
    tEnd: turn.tEnd,
  });
}

/** Default runner: LM Studio stream + nested tools. */
export const defaultSubAgentRunner: SubAgentRunner = {
  async run(input): Promise<SubAgentRunnerOutput> {
    const messages: ApiMessage[] = [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.task },
    ];

    let toolTurns = 0;
    let proseQuestionRetries = 0;
    const hasAskQuestionTool = input.tools.some((t) => t.function.name === 'ask_question');
    const typeConfig = await getSubAgentTypeConfig(input.type);
    const resolvedSampler = resolveSamplerPreset({
      kind: 'sub-agent',
      agentKey: input.type,
      global: { temperature: 0.4, maxTokens: 2048 },
      subAgentType: typeConfig,
    });
    const maxToolTurns = Math.max(1, Math.floor(input.maxToolTurns) || MAX_SUB_AGENT_TOOL_TURNS);
    const contextBudget = input.contextBudget ?? {
      maxInputTokens: null,
      enforcementPolicy: 'slide',
    };
    const modelContextLimit =
      input.modelContextLimit !== undefined
        ? input.modelContextLimit
        : resolveSubAgentModelContextLimit(input.modelId);
    let lastProgressEmit = 0;
    const usageSegments: Usage[] = [];
    const statsSegments: Array<{ stats: Stats; usage: Usage }> = [];
    const budgetEvents: SubAgentBudgetEvent[] = [];
    const summarySchema = input.summarySchema;

    const emitProgress = (partialAssistant?: string, force = false): void => {
      if (!input.onMessagesChange) return;
      const now = Date.now();
      if (!force && now - lastProgressEmit < LIVE_TRANSCRIPT_EMIT_MS) return;
      lastProgressEmit = now;
      const snapshot = cloneSubAgentMessages(messages);
      if (partialAssistant) {
        snapshot.push({ role: 'assistant', content: partialAssistant });
      }
      input.onMessagesChange(snapshot);
    };

    emitProgress(undefined, true);

    await loadToolCallsMeta();
    const provider = await getActiveProvider(input.providerId);
    const providerCapabilities = await readProviderCapabilities(input.providerId);
    const toolCallsMeta = getToolCallsMetaSync();
    const constrainedUserEnabled = isConstrainedDecodingEnabledForProvider(
      provider,
      toolCallsMeta,
    );

    const enforceContextBudget = (turnIndex: number): boolean => {
      const budgetResolved = resolveContextBudget({
        agentConfig: contextBudget,
        modelLimit: modelContextLimit,
      });
      const limit = budgetResolved.effectiveLimit;
      const budgetApplied = applyContextBudget(messages, budgetResolved, contextBudget);
      if (budgetApplied.applied) {
        messages.length = 0;
        messages.push(...budgetApplied.messages);
        if (budgetApplied.statusMessage) {
          budgetEvents.push({
            turn: turnIndex,
            label: budgetApplied.statusMessage,
            estimatedTokens: budgetApplied.tokensAfter,
          });
        }
      }
      if (limit != null && estimateApiMessagesTokens(messages) > limit) {
        return false;
      }
      return true;
    };

    const requestStructuredOutcome = async (
      repair: boolean,
    ): Promise<
      | { ok: true; outcome: SubAgentStructuredOutcome; rawText: string }
      | { ok: false; parseError: string; rawText: string }
    > => {
      const finalMessages = cloneSubAgentMessages(messages);
      if (repair) {
        finalMessages.push({
          role: 'user',
          content: SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT,
        });
      } else {
        finalMessages.push({
          role: 'user',
          content: buildSubAgentFinalizationPrompt(summarySchema).trim(),
        });
      }

      const body = applySamplerToBody(
        {
          model: input.modelId || undefined,
          messages: finalMessages,
          stream: true,
        },
        resolvedSampler.preset,
        resolvedSampler.maxTokens,
      ) as SubAgentCompletionBody;

      const turnResult = await streamSubAgentTurn(
        input.providerId,
        body,
        input.signal,
      );
      await ledgerSubAgentTurn(input, turnResult);

      const turnUsage = turnResult.streamMeta.usage ?? {};
      const turnStats = turnResult.streamMeta.stats ?? {};
      if (Object.keys(turnUsage).length > 0) usageSegments.push(turnUsage);
      if (Object.keys(turnStats).length > 0 || Object.keys(turnUsage).length > 0) {
        statsSegments.push({ stats: turnStats, usage: turnUsage });
      }

      let rawText = turnResult.fullText.trim();
      if (!rawText) {
        const { stream: _stream, ...fallbackBody } = body;
        const fallback = await tryNonStreamingFallback(
          fallbackBody,
          input.signal,
          input.providerId,
        );
        rawText = extractMessageText(fallback.choices?.[0]?.message).trim();
      }

      try {
        const parsed = parseStructuredOutcomeJson(rawText);
        const outcome = validateStructuredOutcome(parsed, summarySchema);
        if (outcome) return { ok: true, outcome, rawText };
        return { ok: false, parseError: 'JSON did not match summary schema', rawText };
      } catch {
        return { ok: false, parseError: 'Invalid JSON in final response', rawText };
      }
    };

    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (!enforceContextBudget(turn)) {
        return {
          summary: SUB_AGENT_CONTEXT_BUDGET_ERROR,
          toolTurns,
          messages,
          contextBudgetExhausted: true,
          budgetEvents,
          usage: usageSegments.length ? sumUsageSegments(usageSegments) : undefined,
          stats: statsSegments.length ? averageStatsSegments(statsSegments) : undefined,
        };
      }

      const body = applySamplerToBody(
        {
          model: input.modelId || undefined,
          messages,
          stream: true,
        },
        resolvedSampler.preset,
        resolvedSampler.maxTokens,
      ) as SubAgentCompletionBody;

      if (input.tools.length > 0) {
        body.tools = input.tools;
        body.tool_choice = 'auto';
      }

      let usedConstrained = false;
      if (input.tools.length > 0) {
        const constrainedApplied = applyConstrainedToolCallsToBody(body, {
          providerId: input.providerId,
          modelId: input.modelId,
          userEnabled: constrainedUserEnabled,
          capabilities: providerCapabilities,
          enabledTools: input.tools,
        });
        Object.assign(body, constrainedApplied.body);
        usedConstrained = constrainedApplied.usedConstrained;
      }

      let streamingAssistant = '';
      const runSubTurn = (turnBody: SubAgentCompletionBody) =>
        streamSubAgentTurn(input.providerId, turnBody, input.signal, (delta) => {
          streamingAssistant += delta;
          emitProgress(streamingAssistant);
        });

      let turnResult: Awaited<ReturnType<typeof streamSubAgentTurn>>;
      try {
        turnResult = await runSubTurn(body);
      } catch (streamErr) {
        if (usedConstrained && isResponseFormatRejectionError(streamErr)) {
          usedConstrained = false;
          turnResult = await runSubTurn(stripResponseFormatFromBody(body));
        } else {
          throw streamErr;
        }
      }

      await ledgerSubAgentTurn(input, turnResult);

      const turnUsage = turnResult.streamMeta.usage ?? {};
      const turnStats = turnResult.streamMeta.stats ?? {};
      if (Object.keys(turnUsage).length > 0) {
        usageSegments.push(turnUsage);
      }
      if (Object.keys(turnStats).length > 0 || Object.keys(turnUsage).length > 0) {
        statsSegments.push({ stats: turnStats, usage: turnUsage });
      }

      if (
        turnResult.finishReason === 'tool_calls' &&
        turnResult.toolCalls.length > 0
      ) {
        toolTurns += 1;
        messages.push({
          role: 'assistant',
          content: turnResult.fullText || null,
          tool_calls: turnResult.toolCalls,
        });
        emitProgress(undefined, true);

        for (const tc of turnResult.toolCalls) {
          const { args, parseError } = parseToolArguments(tc.function.arguments, {
            constrained: usedConstrained,
          });
          if (parseError) {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: parseError,
            });
            emitProgress(undefined, true);
            continue;
          }
          const toolOut = await input.executeTool(tc.function.name, args, {
            ...input.toolExecuteContext,
            toolCallId: tc.id,
          });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolOut.content,
            ...(toolOut.attachments?.length
              ? { attachments: toolOut.attachments }
              : {}),
          });
          emitProgress(undefined, true);
        }
        continue;
      }

      let prose = turnResult.fullText.trim();
      if (!prose) {
        const { stream: _stream, ...fallbackBody } = body;
        const fallback = await tryNonStreamingFallback(
          fallbackBody,
          input.signal,
          input.providerId,
        );
        prose = extractMessageText(fallback.choices?.[0]?.message).trim();
      }

      if (
        hasAskQuestionTool &&
        prose &&
        looksLikeProseStructuredQuestion(prose) &&
        proseQuestionRetries < MAX_PROSE_QUESTION_RETRIES
      ) {
        proseQuestionRetries += 1;
        messages.push({ role: 'user', content: PROSE_QUESTION_RETRY_INSTRUCTION });
        emitProgress(undefined, true);
        continue;
      }

      if (!enforceContextBudget(turn)) {
        return {
          summary: SUB_AGENT_CONTEXT_BUDGET_ERROR,
          toolTurns,
          messages,
          contextBudgetExhausted: true,
          budgetEvents,
          usage: usageSegments.length ? sumUsageSegments(usageSegments) : undefined,
          stats: statsSegments.length ? averageStatsSegments(statsSegments) : undefined,
        };
      }

      const firstFinal = await requestStructuredOutcome(false);
      const finalized = firstFinal.ok
        ? firstFinal
        : await requestStructuredOutcome(true);

      if (finalized.ok === false) {
        const parseError = finalized.parseError;
        return {
          summary: parseError,
          toolTurns,
          messages,
          structuredOutcomeParseError: parseError,
          budgetEvents: budgetEvents.length ? budgetEvents : undefined,
          usage: usageSegments.length ? sumUsageSegments(usageSegments) : undefined,
          stats: statsSegments.length ? averageStatsSegments(statsSegments) : undefined,
        };
      }

      messages.push({ role: 'assistant', content: finalized.rawText });
      emitProgress(undefined, true);
      return {
        summary: finalized.outcome.summary,
        structuredOutcome: finalized.outcome,
        toolTurns,
        messages,
        budgetEvents: budgetEvents.length ? budgetEvents : undefined,
        usage: usageSegments.length ? sumUsageSegments(usageSegments) : undefined,
        stats: statsSegments.length ? averageStatsSegments(statsSegments) : undefined,
      };
    }

    emitProgress(undefined, true);
    return {
      summary: `Sub-agent reached maximum tool turns (${maxToolTurns}).`,
      toolTurns,
      messages,
      toolTurnLimitExhausted: true,
      usage: usageSegments.length ? sumUsageSegments(usageSegments) : undefined,
      stats: statsSegments.length ? averageStatsSegments(statsSegments) : undefined,
    };
  },
};

let runnerFactory: () => SubAgentRunner = () => defaultSubAgentRunner;

/** Inject mock runner for deterministic tests. */
export function setSubAgentRunnerFactory(factory: () => SubAgentRunner): void {
  runnerFactory = factory;
}

export function resetSubAgentRunnerFactory(): void {
  runnerFactory = () => defaultSubAgentRunner;
}

/** Resolve active runner implementation. */
export function getSubAgentRunner(): SubAgentRunner {
  return runnerFactory();
}
