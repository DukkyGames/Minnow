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
import { applyClassifiedStreamEnd, classifyStreamEnd } from '../api/stream-end';
import { repairUnpairedToolCalls } from '../api/provider-message-normalize';
import { reportBackgroundError } from '../boot/report-background-error.ts';
import {
  extractInlineThinkingFromContent,
  HarmonyChannelRouter,
  InlineContentThinkingRouter,
  modelLikelyUsesInlineThinking,
  type RoutedContentPart,
} from '../api/inline-thinking';
import {
  extractReasoningDelta,
  extractReasoningMessage,
  modelRequiresReasoningContentReplay,
  outboundReasoningReplayFields,
} from '../api/reasoning';
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
import { isVisionModel } from '../providers/vision-model';
import { toolImageFollowUpFromAttachments } from '../chat/tool-image-follow-up';
import {
  getToolCallsMetaSync,
  isConstrainedDecodingEnabledForProvider,
  loadToolCallsMeta,
} from '../config/tool-calls-meta';
import { getModelRowForSelectOrCanonicalId } from '../api/models';
import { resolveProvider } from '../providers/store';
import { resolveModelApi } from '../providers/resolve-model-api';
import { runHeadlessToolBatch } from '../tools/headless-tool-batch';
import {
  DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
  estimateApiMessagesTokens,
  resolveContextBudget,
} from '../chat/context-budget';
import { applyContextPolicy } from '../chat/context/apply-policy';
import { SUB_AGENT_CONTEXT_BUDGET_ERROR } from './sub-agent-outcome';
import { buildSubAgentOutcomeResponseFormat } from './sub-agent-outcome-response-format';
import {
  buildSubAgentFinalizationPrompt,
  legacyOutcomeFromSummary,
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
import { resolveThinkingMode, resolveThinkingBudgetTokens } from './resolve-thinking';
import {
  ThinkingBudgetTracker,
  buildBudgetContinuationMessages,
  buildThinkingPrefillAssistantMessage,
  stripCarriedTextEcho,
  stripPrefillEchoFromDelta,
} from './thinking-budget';
import { retryOnceOnTransientFetch } from '../lib/transient-fetch-retry';
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from '../providers/types';
import { resolveSamplerPreset } from './resolve-sampler';
import { applySamplerToBody } from './sampler-types';
import { findChatById } from '../state/sessions';
import {
  modelUsesComposerReasoningDropdown,
  resolveEffectiveReasoningEffort,
} from '../lib/reasoning-effort';
import { resolveSendCapabilities } from '../providers/model-capabilities';
import type { SubAgentRunner, SubAgentRunnerOutput, SubAgentLiveActivity } from './types';
import type { ProviderPublic } from '../providers/types';

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
  const finishReasonRaw = chunk.choices?.[0]?.finish_reason;
  const finishReason = finishReasonRaw == null ? undefined : finishReasonRaw;
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
  return contextLengthFromModelRow(cached) ?? null;
}

/** Throttle live transcript pushes so the drawer can keep up while streaming. */
const LIVE_TRANSCRIPT_EMIT_MS = 80;

/** Deep-clone messages for orchestrator state + UI subscribers. */
export function cloneSubAgentMessages(messages: ApiMessage[]): ApiMessage[] {
  return structuredClone(messages);
}

/** Build the assistant row after a tool turn (DeepSeek needs `reasoning_content` replay). */
function buildSubAgentToolAssistantMessage(
  modelId: string,
  turnResult: {
    fullText: string;
    reasoningText: string;
    toolCalls: ReturnType<typeof finalizeToolCalls>;
  },
): ApiMessage {
  let reasoningText = turnResult.reasoningText.trim();
  let content = turnResult.fullText.trim() || null;

  // Some DeepSeek proxies stream thinking on `content` instead of `reasoning_content`.
  if (modelRequiresReasoningContentReplay(modelId) && !reasoningText && content) {
    reasoningText = content;
    content = null;
  }

  return {
    role: 'assistant',
    content,
    tool_calls: turnResult.toolCalls,
    ...outboundReasoningReplayFields(modelId, reasoningText, undefined, {
      toolCallTurn: true,
    }),
  };
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

interface SubAgentStreamOptions {
  thinkingBudgetTracker?: ThinkingBudgetTracker | null;
  prefillEchoPartial?: string;
  /** Prose already streamed before a budget continuation — seeds `proseText`. */
  carriedText?: string;
  /** Reasoning already streamed before a budget continuation — seeds `reasoningText`. */
  carriedReasoning?: string;
  onReasoningDelta?: (reasoningSoFar: string) => void;
  onToolCallDelta?: (toolName: string) => void;
}

interface SubAgentTurnResult {
  fullText: string;
  reasoningText: string;
  finishReason: string | undefined;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
  streamMeta: StreamMetaAccumulator;
  t0: number;
  tFirst: number | null;
  tEnd: number;
  thinkingBudgetExceeded?: boolean;
  partialThinkingText?: string;
  /** Channel the reasoning actually arrived on, when any was seen. */
  thinkingChannel?: 'native' | 'inline';
}

/** Headless SSE turn (no DOM). Retries once on transient fetch errors. */
async function streamSubAgentTurn(
  providerId: string,
  body: SubAgentCompletionBody,
  signal: AbortSignal,
  fallbackRole: string,
  onDelta?: (delta: string) => void,
  sanitizeOptions?: { provider?: ProviderPublic; modelCapabilities?: ModelCapabilities | null },
  streamOptions?: SubAgentStreamOptions,
): Promise<SubAgentTurnResult> {
  return retryOnceOnTransientFetch(() =>
    streamSubAgentTurnOnce(
      providerId,
      body,
      signal,
      fallbackRole,
      onDelta,
      sanitizeOptions,
      streamOptions,
    ),
  );
}

/** Single attempt at a headless SSE sub-agent turn. */
async function streamSubAgentTurnOnce(
  providerId: string,
  body: SubAgentCompletionBody,
  signal: AbortSignal,
  fallbackRole: string,
  onDelta?: (delta: string) => void,
  sanitizeOptions?: { provider?: ProviderPublic; modelCapabilities?: ModelCapabilities | null },
  streamOptions?: SubAgentStreamOptions,
): Promise<SubAgentTurnResult> {
  const provider = sanitizeOptions?.provider ?? (await resolveProvider(providerId));
  const sanitized = sanitizeSubAgentBody(
    body,
    provider,
    sanitizeOptions?.modelCapabilities,
  );
  const turnAbort = new AbortController();
  if (signal.aborted) {
    turnAbort.abort();
  } else {
    signal.addEventListener('abort', () => turnAbort.abort(), { once: true });
  }
  const res = await postChatCompletions(provider, sanitized, turnAbort.signal, {
    fallbackRole,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  const modelId = body.model ?? '';
  const inlineRouter = new InlineContentThinkingRouter({
    thinkingModel: modelLikelyUsesInlineThinking(modelId),
  });
  const harmonyRouter = new HarmonyChannelRouter();
  const carriedText = streamOptions?.carriedText ?? '';
  let proseText = carriedText;
  let reasoningText = streamOptions?.carriedReasoning ?? '';
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};
  const t0 = performance.now();
  let tFirst: number | null = null;
  const thinkingBudgetTracker = streamOptions?.thinkingBudgetTracker ?? null;
  let prefillEchoPartial = streamOptions?.prefillEchoPartial?.trim() ?? '';
  let carriedEchoPending = carriedText.trim().length > 0;
  let toolCallPhaseStarted = false;
  let budgetTripped = false;
  let thinkingChannel: 'native' | 'inline' | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  if (carriedText) {
    // Re-emit what the aborted attempt already produced so the live transcript never blanks.
    onDelta?.(proseText);
  }

  function feedThinkingBudget(delta: string): void {
    if (!thinkingBudgetTracker || !delta) return;
    thinkingBudgetTracker.feed(delta);
    if (thinkingBudgetTracker.exceeded && !budgetTripped) {
      budgetTripped = true;
      void reader?.cancel();
      turnAbort.abort();
    }
  }

  function noteThinkingChannel(channel: 'native' | 'inline'): void {
    thinkingChannel ??= channel;
  }

  function notifyReasoningDelta(): void {
    if (!reasoningText) return;
    streamOptions?.onReasoningDelta?.(reasoningText);
  }

  function processRoutedParts(parts: RoutedContentPart[]): void {
    for (const [text, isThinking] of parts) {
      if (isThinking) {
        if (text) {
          noteThinkingChannel('inline');
          feedThinkingBudget(text);
          reasoningText += text;
          notifyReasoningDelta();
        }
        continue;
      }
      if (!text) {
        continue;
      }
      thinkingBudgetTracker?.endSession();
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
          noteThinkingChannel('inline');
          feedThinkingBudget(harmonyText);
          reasoningText += harmonyText;
          notifyReasoningDelta();
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
          noteThinkingChannel('inline');
          feedThinkingBudget(harmonyText);
          reasoningText += harmonyText;
          notifyReasoningDelta();
        }
        continue;
      }
      processRoutedParts(inlineRouter.feed(harmonyText));
    }
    processRoutedParts(inlineRouter.flush());
  }

  reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const sseBuffer = createSseEventBuffer();

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const reasoningDelta = extractReasoningDelta(chunk);
    if (reasoningDelta) {
      noteThinkingChannel('native');
      feedThinkingBudget(reasoningDelta);
      reasoningText += reasoningDelta;
      notifyReasoningDelta();
    }
    const contentDelta = extractStreamDelta(chunk);
    if (contentDelta) {
      let routedDelta = contentDelta;
      if (prefillEchoPartial) {
        routedDelta = stripPrefillEchoFromDelta(routedDelta, prefillEchoPartial);
        prefillEchoPartial = '';
      }
      if (carriedEchoPending) {
        routedDelta = stripCarriedTextEcho(routedDelta, carriedText);
        carriedEchoPending = false;
      }
      routeContentDelta(routedDelta);
    }
    // Reasoning ends before tool_calls JSON streams — bank the phase once, at the boundary.
    if (!toolCallPhaseStarted && Object.keys(toolAcc).length > 0) {
      toolCallPhaseStarted = true;
      thinkingBudgetTracker?.endSession();
    }
    const partialTools = finalizeToolCalls(toolAcc);
    const streamingToolName = partialTools[0]?.function?.name?.trim();
    if (streamingToolName) {
      streamOptions?.onToolCallDelta?.(streamingToolName);
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      feedSseEventBuffer(sseBuffer, decoder.decode(value, { stream: true }), handleChunk);
      if (budgetTripped) break;
    }
  } catch (err) {
    const e = err as { name?: string };
    if (e?.name !== 'AbortError' || !budgetTripped) {
      throw err;
    }
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
  const toolCalls = mergeContentJsonToolCalls(fullText, streamedToolCalls, {
    harmonyParseText: harmonyRouter.getCommentaryParseText(),
  });
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
    thinkingBudgetExceeded: budgetTripped,
    partialThinkingText: budgetTripped ? thinkingBudgetTracker?.sessionText : undefined,
    thinkingChannel,
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
    const resolvedThinkingBudget = resolveThinkingBudgetTokens({
      kind: 'sub-agent',
      agentKey: input.type,
      subAgentType: typeConfig,
    });
    let toolUseNudgeSent = false;
    const contextBudget = input.contextBudget ?? {
      enforcementPolicy: DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
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

    let liveEmitQueued = false;
    let pendingLive: SubAgentLiveActivity | null = null;

    const flushLiveActivity = (): void => {
      liveEmitQueued = false;
      if (!pendingLive || !input.onLiveActivity) return;
      const snapshot = pendingLive;
      pendingLive = null;
      input.onLiveActivity(snapshot);
    };

    const emitLiveActivity = (
      patch: Partial<SubAgentLiveActivity>,
      force = false,
    ): void => {
      if (!input.onLiveActivity) return;
      pendingLive = {
        phase: pendingLive?.phase ?? null,
        partialReasoning: pendingLive?.partialReasoning,
        currentToolName: pendingLive?.currentToolName,
        ...patch,
      };
      if (force) {
        flushLiveActivity();
        return;
      }
      if (liveEmitQueued) return;
      liveEmitQueued = true;
      queueMicrotask(flushLiveActivity);
    };

    emitProgress(undefined, true);
    emitLiveActivity({ phase: 'generating', partialReasoning: undefined, currentToolName: null }, true);

    await loadToolCallsMeta();
    const provider = await resolveProvider(input.providerId);
    const sendCaps = resolveSendCapabilities(input.providerId, input.modelId, provider.apiKind);
    const turnReasoningEffort = modelUsesComposerReasoningDropdown(sendCaps)
      ? resolveEffectiveReasoningEffort(parentChat ?? {}, sendCaps, resolvedThinking.mode)
      : undefined;
    const providerCapabilities = await readProviderCapabilities(input.providerId);
    const toolCallsMeta = getToolCallsMetaSync();
    const constrainedUserEnabled = isConstrainedDecodingEnabledForProvider(
      provider,
      toolCallsMeta,
    );

    const enforceContextBudget = async (turnIndex: number): Promise<boolean> => {
      const budgetResolved = resolveContextBudget({
        agentConfig: contextBudget,
        modelLimit: modelContextLimit,
      });
      const budgetApplied = await applyContextPolicy({
        messages,
        policy: contextBudget.enforcementPolicy,
        modelLimit: modelContextLimit,
        agentConfig: contextBudget,
        providerId: input.providerId,
        modelId: input.modelId,
        signal: input.signal,
      });
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
      const limit = budgetResolved.effectiveLimit;
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
        'off',
        provider,
        sendCaps,
      );

      const modelRow = getModelRowForSelectOrCanonicalId(input.modelId);
      const resolvedApi = resolveModelApi(provider, input.modelId, modelRow ?? undefined);
      const anthropicFinalization = resolvedApi === 'anthropic-v1';

      let usedOutcomeResponseFormat = false;
      const outcomeFormat = buildSubAgentOutcomeResponseFormat(summarySchema);
      if (
        outcomeFormat &&
        !anthropicFinalization &&
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

    // Budget is per sub-agent turn, not per tool-loop iteration — one tracker for the loop.
    let turnThinkingBudgetTracker: ThinkingBudgetTracker | null = null;
    let turnBudgetContinuationAttempts = 0;

    for (let turn = 0; ; turn++) {
      if (!(await enforceContextBudget(turn))) {
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

      // Context trimming can drop a tool result while keeping its assistant row;
      // repair in place so every send this round (and the transcript we return)
      // carries paired tool calls.
      const repaired = repairUnpairedToolCalls(messages);
      messages.length = 0;
      messages.push(...repaired);

      const body = applySamplerToBody(
        {
          model: input.modelId || undefined,
          messages,
          stream: true,
        },
        resolvedSampler.preset,
        resolvedSampler.maxTokens,
      ) as SubAgentCompletionBody;
      const llamaSupportsThinkingBudget =
        provider.id === LLAMA_CPP_LOCAL_PROVIDER_ID &&
        providerCapabilities?.supportsThinkingBudget === true;
      const { nativeBudgetApplied } = mergeThinkingIntoCompletionBody(
        body as unknown as Record<string, unknown>,
        resolvedThinking.mode,
        provider,
        sendCaps,
        turnReasoningEffort,
        undefined,
        resolvedThinkingBudget.budgetTokens,
        { llamaSupportsThinkingBudget },
      );
      let thinkingBudgetTracker: ThinkingBudgetTracker | null = null;
      if (
        resolvedThinkingBudget.budgetTokens != null &&
        !nativeBudgetApplied &&
        resolvedThinking.mode === 'on'
      ) {
        turnThinkingBudgetTracker ??= new ThinkingBudgetTracker(
          resolvedThinkingBudget.budgetTokens,
        );
        thinkingBudgetTracker = turnThinkingBudgetTracker;
      }

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
      const streamProgress = {
        onReasoningDelta: (reasoningSoFar: string) => {
          emitLiveActivity({
            phase: 'thinking',
            partialReasoning: reasoningSoFar,
            currentToolName: null,
          });
        },
        onToolCallDelta: (toolName: string) => {
          emitLiveActivity({
            phase: 'tools',
            currentToolName: toolName,
          });
        },
      };
      const runSubTurn = (
        turnBody: SubAgentCompletionBody,
        streamOpts?: SubAgentStreamOptions,
      ) =>
        streamSubAgentTurn(
          input.providerId,
          turnBody,
          input.signal,
          input.type,
          (fullSoFar) => {
            streamingAssistant = fullSoFar;
            emitLiveActivity({
              phase: 'generating',
              partialReasoning: undefined,
              currentToolName: null,
            });
            emitProgress(streamingAssistant);
          },
          { provider, modelCapabilities: sendCaps },
          {
            ...streamOpts,
            ...streamProgress,
          },
        );

      const runSubTurnWithThinkingBudget = async (): Promise<SubAgentTurnResult> => {
        let currentBody = body;
        const tracker = thinkingBudgetTracker;
        let prefillPartial = '';
        let carriedText = '';
        let carriedReasoning = '';
        const maxContinuations = 2;
        const streamOpts = (): SubAgentStreamOptions => ({
          thinkingBudgetTracker: tracker,
          prefillEchoPartial: prefillPartial || undefined,
          carriedText: carriedText || undefined,
          carriedReasoning: carriedReasoning || undefined,
        });

        while (true) {
          let turnResult: SubAgentTurnResult;
          try {
            turnResult = await runSubTurn(currentBody, streamOpts());
          } catch (streamErr) {
            if (usedConstrained && isResponseFormatRejectionError(streamErr)) {
              usedConstrained = false;
              currentBody = stripResponseFormatFromBody(currentBody);
              turnResult = await runSubTurn(currentBody, streamOpts());
            } else {
              throw streamErr;
            }
          }

          if (
            !turnResult.thinkingBudgetExceeded ||
            !tracker ||
            turnBudgetContinuationAttempts >= maxContinuations
          ) {
            // The escalation only runs once per turn — later rounds must not be cut again.
            if (turnBudgetContinuationAttempts > 0) tracker?.disarm();
            return turnResult;
          }

          turnBudgetContinuationAttempts += 1;
          // Carried text and reasoning were seeded into the stream, so both are cumulative;
          // the tracker only holds the phase that tripped.
          const partialThinking =
            turnResult.reasoningText.trim() || (turnResult.partialThinkingText ?? '');
          const partialText = turnResult.fullText;
          const isFinalAttempt = turnBudgetContinuationAttempts >= maxContinuations;

          if (!isFinalAttempt) {
            // Trust the channel the reasoning actually arrived on; guess only when none was seen.
            const canPrefill =
              turnResult.thinkingChannel === 'inline' ||
              (turnResult.thinkingChannel == null &&
                (modelLikelyUsesInlineThinking(input.modelId) ||
                  (provider.id === LLAMA_CPP_LOCAL_PROVIDER_ID &&
                    !llamaSupportsThinkingBudget)));
            // Prefill carries thinking only, so prose has to go through the payload builder.
            const usePrefill = canPrefill && !partialText.trim();
            currentBody = {
              ...body,
              messages: [
                ...messages,
                ...(usePrefill
                  ? [buildThinkingPrefillAssistantMessage(partialThinking)]
                  : buildBudgetContinuationMessages({ partialThinking, partialText })),
              ],
            };
            prefillPartial = usePrefill ? partialThinking : '';
            carriedText = partialText;
            carriedReasoning = turnResult.reasoningText;
            tracker.beginContinuation();
            continue;
          }

          const continuationBody = applySamplerToBody(
            {
              model: input.modelId || undefined,
              messages: [
                ...messages,
                ...buildBudgetContinuationMessages({ partialThinking, partialText }),
              ],
              stream: true,
            },
            resolvedSampler.preset,
            resolvedSampler.maxTokens,
          ) as SubAgentCompletionBody;
          mergeThinkingIntoCompletionBody(
            continuationBody as unknown as Record<string, unknown>,
            'off',
            provider,
            sendCaps,
            turnReasoningEffort,
          );
          if (input.tools.length > 0) {
            continuationBody.tools = input.tools;
            continuationBody.tool_choice = 'auto';
          }
          currentBody = continuationBody;
          prefillPartial = '';
          carriedText = partialText;
          carriedReasoning = turnResult.reasoningText;
          tracker.disarm();
        }
      };

      let turnResult: SubAgentTurnResult;
      turnResult = await runSubTurnWithThinkingBudget();

      const subFinishReason =
        turnResult.finishReason ||
        (turnResult.toolCalls.length > 0 ? 'tool_calls' : undefined);
      const subStreamEnd = classifyStreamEnd({
        finishReason: subFinishReason,
        toolCallsCount: turnResult.toolCalls.length,
        textLength: turnResult.fullText.trim().length,
        streamError: turnResult.streamMeta.error,
      });
      if (subStreamEnd.kind !== 'complete' && subStreamEnd.kind !== 'truncated') {
        reportBackgroundError('stream-end-abnormal', {
          kind: subStreamEnd.kind,
          providerId: input.providerId,
          modelId: input.modelId,
          finishReason: subFinishReason ?? null,
          textLength: turnResult.fullText.trim().length,
          round: turn,
        });
      }
      applyClassifiedStreamEnd(subStreamEnd, {
        hasPostToolTail: hasPostToolTail(messages as Message[]),
        textLength: turnResult.fullText.trim().length,
      });

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
        messages.push(
          buildSubAgentToolAssistantMessage(input.modelId, turnResult),
        );
        const firstTool = turnResult.toolCalls[0]?.function?.name?.trim();
        emitLiveActivity(
          {
            phase: 'tools',
            currentToolName: firstTool || null,
            partialReasoning: undefined,
          },
          true,
        );
        emitProgress(undefined, true);

        const outcomes = await runHeadlessToolBatch({
          toolCalls: turnResult.toolCalls,
          constrained: usedConstrained,
          signal: input.signal,
          execute: (name, args, ctx) =>
            input.executeTool(name, args as Record<string, unknown>, {
              ...input.toolExecuteContext,
              toolCallId: ctx.toolCallId,
            }),
        });

        for (const outcome of outcomes) {
          const tc = outcome.toolCall;
          if (outcome.parseError) {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: outcome.parseError,
            });
          } else {
            const toolOut = outcome.result ?? { content: '' };
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: toolOut.content,
            });
            if (isVisionModel(input.modelId)) {
              const followUp = toolImageFollowUpFromAttachments(toolOut.attachments);
              if (followUp) messages.push(followUp);
            }
          }
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
        messages.push({ role: 'assistant', content: prose });
        messages.push({ role: 'user', content: PROSE_QUESTION_RETRY_INSTRUCTION });
        emitProgress(undefined, true);
        continue;
      }

      if (
        input.tools.length > 0 &&
        toolTurns === 0 &&
        !toolUseNudgeSent
      ) {
        toolUseNudgeSent = true;
        messages.push({ role: 'user', content: SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION });
        emitProgress(undefined, true);
        continue;
      }

      if (!(await enforceContextBudget(turn))) {
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

      const returnProseFallbackOutcome = (): SubAgentRunnerOutput => {
        messages.push({ role: 'assistant', content: prose });
        emitProgress(undefined, true);
        const legacy = legacyOutcomeFromSummary(prose);
        logSubAgentDebug('prose_fallback_outcome', { proseLen: prose.length, toolTurns });
        return {
          summary: legacy.summary,
          structuredOutcome: legacy,
          toolTurns,
          messages,
          budgetEvents: budgetEvents.length ? budgetEvents : undefined,
          usage: usageSegments.length ? sumUsageSegments(usageSegments) : undefined,
          stats: statsSegments.length ? averageStatsSegments(statsSegments) : undefined,
        };
      };

      try {
        const firstFinal = await requestStructuredOutcome(false);
        const finalized = firstFinal.ok
          ? firstFinal
          : await requestStructuredOutcome(true);

        if (finalized.ok === false) {
          if (prose.trim() && toolTurns > 0) {
            return returnProseFallbackOutcome();
          }
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
      } catch (finalErr) {
        if (prose.trim() && toolTurns > 0) {
          logSubAgentDebug('finalization_error_prose_fallback', {
            proseLen: prose.length,
            toolTurns,
            error: finalErr instanceof Error ? finalErr.message : String(finalErr),
          });
          return returnProseFallbackOutcome();
        }
        throw finalErr;
      }
    }
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
