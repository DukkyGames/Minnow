/**
 * Isolated sub-agent completion + tool loop (no parent chat history).
 */

import {
  extractAssistantCompletionText,
  extractStreamDelta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
  tryNonStreamingFallback,
  type StreamMetaAccumulator,
} from '../api/chat';
import {
  extractInlineThinkingFromContent,
  HarmonyChannelRouter,
  InlineContentThinkingRouter,
  modelLikelyUsesInlineThinking,
  type RoutedContentPart,
} from '../api/inline-thinking';
import { extractReasoningDelta, extractReasoningMessage } from '../api/reasoning';
import {
  createSseEventBuffer,
  feedSseEventBuffer,
  flushSseEventBuffer,
} from '../api/sse-parse';
import {
  isStructuredOutcomeResponseFormatAvailable,
  readProviderCapabilities,
} from '../providers/capability-probe';
import {
  applyConstrainedToolCallsToBody,
  isResponseFormatRejectionError,
  stripResponseFormatFromBody,
} from '../providers/constrained-tool-calls';
import type { CompletionBodyWithResponseFormat } from '../providers/completion-types';
import { mergeContentJsonToolCalls } from '../providers/constrained-tool-content';
import { postChatCompletions } from '../providers/fetch-chat';
import { sanitizeCompletionBodyForProvider } from '../providers/sanitize-completion-body';
import {
  getToolCallsMetaSync,
  isConstrainedDecodingEnabledForProvider,
  loadToolCallsMeta,
} from '../config/tool-calls-meta';
import { getModelRowForSelectOrCanonicalId } from '../api/models';
import { resolveProvider } from '../providers/store';
import { parseToolArguments } from '../tools/parse-tool-arguments';
import {
  applyContextBudget,
  estimateApiMessagesTokens,
  resolveContextBudget,
} from '../chat/context-budget';
import { SUB_AGENT_CONTEXT_BUDGET_ERROR } from './sub-agent-outcome';
import { buildSubAgentOutcomeResponseFormat } from './sub-agent-outcome-response-format';
import {
  buildSubAgentFinalizationPrompt,
  parseStructuredOutcomeJson,
  SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT,
  tryParseStructuredOutcomeFromAssistantProse,
  validateStructuredOutcome,
} from './sub-agent-structured-outcome';
import type { SubAgentBudgetEvent, SubAgentStructuredOutcome } from './sub-agent-structured-outcome';
import { contextLengthFromModelRow } from '../lib/context-length';
import { averageStatsSegments, sumUsageSegments } from '../chat/orchestrate/stats-math';
import { recordSubAgentTurnUsage } from '../usage/record-chat-usage';
import type { ApiMessage, ChatCompletionChunk, Message, ModelCapabilities, Stats, ToolCallAccumulator, Usage } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import { looksLikeProseStructuredQuestion } from '../tools/prose-question-detect';
import {
  EMPTY_POST_TOOL_CONTINUE_INSTRUCTION,
  hasPostToolTail,
  MAX_EMPTY_POST_TOOL_RETRIES,
  MAX_PROSE_QUESTION_RETRIES,
  PROSE_QUESTION_RETRY_INSTRUCTION,
  SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION,
} from '../tools/turn-continuation';
import { getSubAgentTypeConfig } from './sub-agent-config';
import { mergeThinkingIntoCompletionBody } from './merge-thinking-body';
import { resolveThinkingMode } from './resolve-thinking';
import { resolveSamplerPreset } from './resolve-sampler';
import { applySamplerToBody } from './sampler-types';
import { findChatById } from '../state/sessions';
import { modelCache } from '../app-state';
import { encodeModelSelectKey } from '../lib/model-select-key';
import { catalogCapabilitiesFromRow } from '../providers/model-capabilities';
import type { SubAgentRunner, SubAgentRunnerOutput } from './types';
import type { ProviderPublic } from '../providers/types';

/** Legacy export: prefer per-type `maxToolTurns` from sub-agents config. */
export const MAX_SUB_AGENT_TOOL_TURNS = 100;

/** Prefer main `content`; some reasoning models only emit JSON on the reasoning channel. */
function resolveStreamedCompletionText(content: string, reasoning: string): string {
  const prose = content.trim();
  if (prose) return prose;
  return reasoning.trim();
}

/** Merge streamed assistant text with a non-streaming fallback when SSE yielded no body. */
async function completionTextForTurn(
  turnResult: Awaited<ReturnType<typeof streamSubAgentTurn>>,
  body: SubAgentCompletionBody,
  provider: ProviderPublic,
  sendCaps: ModelCapabilities | undefined,
  signal: AbortSignal,
): Promise<string> {
  let text = resolveStreamedCompletionText(turnResult.fullText, turnResult.reasoningText);
  if (text.trim()) return text.trim();

  const { stream: _stream, ...fallbackBody } = sanitizeSubAgentBody(body, provider, sendCaps);
  const fallback = await tryNonStreamingFallback(fallbackBody, signal, provider.id);
  const message = fallback.choices?.[0]?.message;
  text = resolveStreamedCompletionText(
    extractAssistantCompletionText(message).trim(),
    extractReasoningMessage(message).trim(),
  );
  return text.trim();
}

function sanitizeSubAgentBody(
  body: SubAgentCompletionBody,
  provider: ProviderPublic,
  sendCaps?: ModelCapabilities | null,
): SubAgentCompletionBody {
  return sanitizeCompletionBodyForProvider(
    body as unknown as Record<string, unknown>,
    provider,
    sendCaps,
  ) as unknown as SubAgentCompletionBody;
}

/** Non-streaming sub-agent turn (structured finalization when streaming is unsupported). */
async function runSubAgentNonStreamTurn(
  providerId: string,
  body: SubAgentCompletionBody,
  signal: AbortSignal,
  provider: ProviderPublic,
  sendCaps: ModelCapabilities | undefined,
): Promise<Awaited<ReturnType<typeof streamSubAgentTurn>>> {
  const t0 = performance.now();
  const sanitized = sanitizeSubAgentBody(body, provider, sendCaps);
  const { stream: _stream, ...fallbackBody } = sanitized;
  const chunk = await tryNonStreamingFallback(fallbackBody, signal, providerId);
  const message = chunk.choices?.[0]?.message;
  const fullText = extractAssistantCompletionText(message);
  const reasoningText = extractReasoningMessage(message).trim();
  const finishReason = chunk.choices?.[0]?.finish_reason;
  return {
    fullText,
    reasoningText,
    finishReason,
    toolCalls: [],
    streamMeta: {
      usage: chunk.usage,
      stats: chunk.stats,
      finish_reason: finishReason,
    },
    t0,
    tFirst: t0,
    tEnd: performance.now(),
  };
}

/** Dev-only logging when `localStorage.minnowDebugSubAgent === '1'`. */
function logSubAgentDebug(event: string, detail?: Record<string, unknown>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem('minnowDebugSubAgent') !== '1') return;
  } catch {
    return;
  }
  console.info('[sub-agent]', event, detail ?? '');
}

function resolveSubAgentModelContextLimit(modelId: string): number | null {
  const id = modelId.trim();
  if (!id) return null;
  const cached = getModelRowForSelectOrCanonicalId(id);
  if (!cached) return null;
  return contextLengthFromModelRow(cached);
}

/** Throttle live transcript pushes so the drawer can keep up while streaming. */
const LIVE_TRANSCRIPT_EMIT_MS = 80;

/** Deep-clone messages for orchestrator state + UI subscribers. */
export function cloneSubAgentMessages(messages: ApiMessage[]): ApiMessage[] {
  return structuredClone(messages);
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
  presence_penalty?: number;
  stream?: boolean;
  tools?: OpenAIFunctionDefinition[];
  tool_choice?: 'auto';
}

/** Headless SSE turn (no DOM). */
async function streamSubAgentTurn(
  providerId: string,
  body: SubAgentCompletionBody,
  signal: AbortSignal,
  fallbackRole: string,
  onDelta?: (delta: string) => void,
  sanitizeOptions?: { provider?: ProviderPublic; modelCapabilities?: ModelCapabilities | null },
): Promise<{
  fullText: string;
  reasoningText: string;
  finishReason: string | undefined;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
  streamMeta: StreamMetaAccumulator;
  t0: number;
  tFirst: number | null;
  tEnd: number;
}> {
  const provider = sanitizeOptions?.provider ?? (await resolveProvider(providerId));
  const sanitized = sanitizeSubAgentBody(
    body,
    provider,
    sanitizeOptions?.modelCapabilities,
  );
  const res = await postChatCompletions(provider, sanitized, signal, { fallbackRole });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  const modelId = body.model ?? '';
  const inlineRouter = new InlineContentThinkingRouter({
    thinkingModel: modelLikelyUsesInlineThinking(modelId),
  });
  const harmonyRouter = new HarmonyChannelRouter();
  let proseText = '';
  let reasoningText = '';
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};
  const t0 = performance.now();
  let tFirst: number | null = null;

  function processRoutedParts(parts: RoutedContentPart[]): void {
    for (const [text, isThinking] of parts) {
      if (isThinking) {
        if (text) {
          reasoningText += text;
        }
        continue;
      }
      if (!text) {
        continue;
      }
      if (tFirst == null) tFirst = performance.now();
      proseText += text;
      onDelta?.(proseText);
    }
  }

  function routeContentDelta(delta: string): void {
    if (!delta) {
      return;
    }
    for (const [harmonyText, isHarmonyThinking] of harmonyRouter.feed(delta)) {
      if (isHarmonyThinking) {
        if (harmonyText) {
          reasoningText += harmonyText;
        }
        continue;
      }
      processRoutedParts(inlineRouter.feed(harmonyText));
    }
  }

  function flushContentRouters(): void {
    for (const [harmonyText, isHarmonyThinking] of harmonyRouter.flush()) {
      if (isHarmonyThinking) {
        if (harmonyText) {
          reasoningText += harmonyText;
        }
        continue;
      }
      processRoutedParts(inlineRouter.feed(harmonyText));
    }
    processRoutedParts(inlineRouter.flush());
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const sseBuffer = createSseEventBuffer();

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const reasoningDelta = extractReasoningDelta(chunk);
    if (reasoningDelta) {
      reasoningText += reasoningDelta;
    }
    const contentDelta = extractStreamDelta(chunk);
    if (contentDelta) {
      routeContentDelta(contentDelta);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    feedSseEventBuffer(sseBuffer, decoder.decode(value, { stream: true }), handleChunk);
  }

  flushSseEventBuffer(sseBuffer, handleChunk);

  flushContentRouters();

  let fullText = proseText;
  const split = extractInlineThinkingFromContent(fullText);
  if (split.thinking.length && split.reply.trim()) {
    reasoningText += split.thinking.join('\n\n');
    fullText = split.reply;
  }
  const streamedToolCalls = finalizeToolCalls(toolAcc);
  const toolCalls = mergeContentJsonToolCalls(fullText, streamedToolCalls);
  const finishReason =
    streamMeta.finish_reason || (toolCalls.length > 0 ? 'tool_calls' : undefined);

  const tEnd = performance.now();

  return {
    fullText,
    reasoningText,
    finishReason,
    toolCalls,
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
    let emptyPostToolRetries = 0;
    const hasAskQuestionTool = input.tools.some((t) => t.function.name === 'ask_question');
    const typeConfig = await getSubAgentTypeConfig(input.type);
    const resolvedSampler = resolveSamplerPreset({
      kind: 'sub-agent',
      agentKey: input.type,
      global: { maxTokens: 2048, preset: {} },
      subAgentMaxTokensFallback: 2048,
      subAgentType: typeConfig,
    });
    const parentChat = input.parentChatId ? findChatById(input.parentChatId) : undefined;
    const resolvedThinking = resolveThinkingMode({
      kind: 'sub-agent',
      agentKey: input.type,
      chatThinkingMode: parentChat?.thinkingMode,
      subAgentType: typeConfig,
    });
    const modelRow = modelCache.get(
      encodeModelSelectKey(input.providerId, input.modelId),
    );
    const sendCaps =
      modelRow?.capabilities ??
      (modelRow ? catalogCapabilitiesFromRow(modelRow) : undefined);
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
    let forcedEmitQueued = false;
    let forcedPartialAssistant: string | undefined;
    const usageSegments: Usage[] = [];
    const statsSegments: Array<{ stats: Stats; usage: Usage }> = [];
    const budgetEvents: SubAgentBudgetEvent[] = [];
    const summarySchema = input.summarySchema;

    const flushForcedEmit = (): void => {
      forcedEmitQueued = false;
      if (!input.onMessagesChange) return;
      lastProgressEmit = Date.now();
      const snapshot = cloneSubAgentMessages(messages);
      const partial = forcedPartialAssistant;
      forcedPartialAssistant = undefined;
      if (partial) {
        snapshot.push({ role: 'assistant', content: partial });
      }
      input.onMessagesChange(snapshot);
    };

    const emitProgress = (partialAssistant?: string, force = false): void => {
      if (!input.onMessagesChange) return;
      const now = Date.now();
      if (force) {
        forcedPartialAssistant = partialAssistant ?? forcedPartialAssistant;
        if (forcedEmitQueued) return;
        forcedEmitQueued = true;
        queueMicrotask(flushForcedEmit);
        return;
      }
      if (now - lastProgressEmit < LIVE_TRANSCRIPT_EMIT_MS) return;
      lastProgressEmit = now;
      const snapshot = cloneSubAgentMessages(messages);
      if (partialAssistant) {
        snapshot.push({ role: 'assistant', content: partialAssistant });
      }
      input.onMessagesChange(snapshot);
    };

    emitProgress(undefined, true);

    await loadToolCallsMeta();
    const provider = await resolveProvider(input.providerId);
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

      let body = applySamplerToBody(
        {
          model: input.modelId || undefined,
          messages: finalMessages,
          stream: true,
        },
        resolvedSampler.preset,
        resolvedSampler.maxTokens,
      ) as SubAgentCompletionBody;
      mergeThinkingIntoCompletionBody(
        body as unknown as Record<string, unknown>,
        resolvedThinking.mode,
        provider,
        sendCaps,
      );

      let usedOutcomeResponseFormat = false;
      const outcomeFormat = buildSubAgentOutcomeResponseFormat(summarySchema);
      if (
        outcomeFormat &&
        isStructuredOutcomeResponseFormatAvailable(input.modelId, providerCapabilities)
      ) {
        body = { ...body, response_format: outcomeFormat };
        usedOutcomeResponseFormat = true;
      }

      const preferNonStreamFinalization =
        usedOutcomeResponseFormat &&
        providerCapabilities?.structuredOutputStreaming !== true;
      if (preferNonStreamFinalization) {
        body.stream = false;
      }

      const runFinalizationTurn = async (
        attemptBody: SubAgentCompletionBody,
      ): Promise<Awaited<ReturnType<typeof streamSubAgentTurn>>> => {
        if (attemptBody.stream === false) {
          return runSubAgentNonStreamTurn(
            input.providerId,
            attemptBody,
            input.signal,
            provider,
            sendCaps,
          );
        }
        try {
          return await streamSubAgentTurn(
            input.providerId,
            attemptBody,
            input.signal,
            input.type,
            undefined,
            { provider, modelCapabilities: sendCaps },
          );
        } catch (streamErr) {
          if (usedOutcomeResponseFormat && isResponseFormatRejectionError(streamErr)) {
            usedOutcomeResponseFormat = false;
            return streamSubAgentTurn(
              input.providerId,
              stripResponseFormatFromBody(attemptBody),
              input.signal,
              input.type,
              undefined,
              { provider, modelCapabilities: sendCaps },
            );
          }
          throw streamErr;
        }
      };

      let turnResult = await runFinalizationTurn(body);
      await ledgerSubAgentTurn(input, turnResult);

      const turnUsage = turnResult.streamMeta.usage ?? {};
      const turnStats = turnResult.streamMeta.stats ?? {};
      if (Object.keys(turnUsage).length > 0) usageSegments.push(turnUsage);
      if (Object.keys(turnStats).length > 0 || Object.keys(turnUsage).length > 0) {
        statsSegments.push({ stats: turnStats, usage: turnUsage });
      }

      let rawText = await completionTextForTurn(
        turnResult,
        body,
        provider,
        sendCaps,
        input.signal,
      );

      if (!rawText && usedOutcomeResponseFormat) {
        usedOutcomeResponseFormat = false;
        body = stripResponseFormatFromBody(body);
        turnResult = await runFinalizationTurn(body);
        await ledgerSubAgentTurn(input, turnResult);
        rawText = await completionTextForTurn(
          turnResult,
          body,
          provider,
          sendCaps,
          input.signal,
        );
      }

      logSubAgentDebug('finalization_turn', {
        repair,
        usedOutcomeResponseFormat,
        finishReason: turnResult.finishReason ?? null,
        rawLen: rawText.length,
        preview: rawText ? `${rawText.slice(0, 200)}${rawText.length > 200 ? '…' : ''}` : '',
      });

      if (!rawText) {
        return {
          ok: false,
          parseError: 'Empty response from provider on final turn',
          rawText: '',
        };
      }

      try {
        const parsed = parseStructuredOutcomeJson(rawText);
        const outcome = validateStructuredOutcome(parsed, summarySchema);
        if (outcome) return { ok: true, outcome, rawText };
        const preview =
          rawText.length > 200 ? `${rawText.slice(0, 200)}…` : rawText;
        return {
          ok: false,
          parseError: `JSON did not match summary schema (preview: ${JSON.stringify(preview)})`,
          rawText,
        };
      } catch {
        const preview =
          rawText.length > 200 ? `${rawText.slice(0, 200)}…` : rawText;
        return {
          ok: false,
          parseError: `Invalid JSON in final response (preview: ${JSON.stringify(preview)})`,
          rawText,
        };
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
      mergeThinkingIntoCompletionBody(
        body as unknown as Record<string, unknown>,
        resolvedThinking.mode,
        provider,
        sendCaps,
      );

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
        streamSubAgentTurn(
          input.providerId,
          turnBody,
          input.signal,
          input.type,
          (fullSoFar) => {
            streamingAssistant = fullSoFar;
            emitProgress(streamingAssistant);
          },
          { provider, modelCapabilities: sendCaps },
        );

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

      logSubAgentDebug('work_turn', {
        turn,
        toolTurns,
        finishReason: turnResult.finishReason ?? null,
        toolCallCount: turnResult.toolCalls.length,
        proseLen: turnResult.fullText.length,
      });

      if (turnResult.toolCalls.length > 0) {
        toolTurns += 1;
        const assistantContent = resolveStreamedCompletionText(
          turnResult.fullText,
          turnResult.reasoningText,
        );
        messages.push({
          role: 'assistant',
          content: assistantContent || null,
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
            ...(toolOut.codeChange ? { codeChange: toolOut.codeChange } : {}),
          });
          emitProgress(undefined, true);
        }
        continue;
      }

      let prose = await completionTextForTurn(
        turnResult,
        body,
        provider,
        sendCaps,
        input.signal,
      );

      if (
        !prose &&
        toolTurns > 0 &&
        hasPostToolTail(messages as Message[]) &&
        emptyPostToolRetries < MAX_EMPTY_POST_TOOL_RETRIES
      ) {
        emptyPostToolRetries += 1;
        messages.push({ role: 'user', content: EMPTY_POST_TOOL_CONTINUE_INSTRUCTION });
        emitProgress(undefined, true);
        continue;
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

      if (
        input.tools.length > 0 &&
        toolTurns === 0 &&
        turn < maxToolTurns - 1
      ) {
        messages.push({ role: 'user', content: SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION });
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

      const proseOutcome = tryParseStructuredOutcomeFromAssistantProse(prose, summarySchema);
      if (proseOutcome) {
        messages.push({ role: 'assistant', content: prose });
        emitProgress(undefined, true);
        return {
          summary: proseOutcome.summary,
          structuredOutcome: proseOutcome,
          toolTurns,
          messages,
          budgetEvents: budgetEvents.length ? budgetEvents : undefined,
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
