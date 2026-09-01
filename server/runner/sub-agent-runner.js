/**
 * Isolated sub-agent completion + tool loop (MIN-698).
 *
 * I/O is injected via createSubAgentRunner so this module never imports src/,
 * the session store, or a board. There is one implementation; the renderer
 * adapter is src/agents/sub-agent-runner.ts.
 */
import {
  extractAssistantCompletionText,
  extractStreamDelta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta
} from "./stream-parse.js";
import {
  createSseEventBuffer,
  feedSseEventBuffer,
  flushSseEventBuffer,
  parseCompletionResponseBody
} from "./sse-parse.js";
import { applyClassifiedStreamEnd, classifyStreamEnd } from "./stream-end.js";
import { repairUnpairedToolCalls } from "./provider-message-normalize.js";
import {
  extractInlineThinkingFromContent,
  HarmonyChannelRouter,
  InlineContentThinkingRouter,
  modelLikelyUsesInlineThinking
} from "./inline-thinking.js";
import {
  extractReasoningDelta,
  extractReasoningMessage,
  modelRequiresReasoningContentReplay,
  outboundReasoningReplayFields
} from "./reasoning.js";
import {
  applyConstrainedToolCallsToBody,
  isResponseFormatRejectionError,
  stripResponseFormatFromBody
} from "./constrained-tool-calls.js";
import { mergeContentJsonToolCalls } from "./constrained-tool-content.js";
import {
  ContentToolCallRouter,
  hasXmlToolCallMarkup,
  stripXmlToolCallBlocks
} from "./xml-tool-calls.js";
import { sanitizeCompletionBodyForProvider } from "../providers/sanitize-completion-body.js";
import { toolImageFollowUpFromAttachments } from "./tool-image-follow-up.js";
import { resolveModelApi } from "../generations/resolve-model-api.js";
import {
  DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
  estimateApiMessagesTokens,
  resolveContextBudget
} from "./context-budget.js";
import { estimateToolsTokens } from "./token-estimate-core.js";
import { SUB_AGENT_CONTEXT_BUDGET_ERROR } from "./sub-agent-outcome.js";
import { buildSubAgentOutcomeResponseFormat } from "./sub-agent-outcome-response-format.js";
import {
  buildSubAgentFinalizationPrompt,
  legacyOutcomeFromSummary,
  parseStructuredOutcomeJson,
  SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT,
  tryParseStructuredOutcomeFromAssistantProse,
  validateStructuredOutcome
} from "./sub-agent-structured-outcome.js";
import { averageStatsSegments, sumUsageSegments } from "./stats-math.js";
import { looksLikeProseStructuredQuestion } from "./prose-question-detect.js";
import {
  EMPTY_POST_TOOL_CONTINUE_INSTRUCTION,
  hasPostToolTail,
  MAX_EMPTY_POST_TOOL_RETRIES,
  MAX_PROSE_QUESTION_RETRIES,
  PROSE_QUESTION_RETRY_INSTRUCTION,
  SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION
} from "./turn-continuation.js";
import { mergeThinkingIntoCompletionBody } from "./merge-thinking-body.js";
import {
  ThinkingBudgetTracker,
  buildBudgetContinuationMessages,
  buildThinkingPrefillAssistantMessage,
  stripCarriedTextEcho,
  stripPrefillEchoFromDelta
} from "./thinking-budget.js";
import { retryOnceOnTransientFetch } from "./transient-fetch-retry.js";
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from "./provider-ids.js";
import { applySamplerToBody } from "./sampler-types.js";
import { buildOpeningMessages } from "./opening-messages.js";
import {
  modelUsesComposerReasoningDropdown,
  resolveEffectiveReasoningEffort
} from "./reasoning-effort.js";
function createSubAgentRunner(deps) {
  const postChatCompletions = (provider, body, signal, options) => deps.postChatCompletions(provider, body, signal, options);
  const runHeadlessToolBatch = (options) => deps.runHeadlessToolBatch(options);
  const resolveProvider = (id) => deps.resolveProvider(id);
  const getSubAgentTypeConfig = (type) => deps.getSubAgentTypeConfig(type);
  const resolveSamplerPreset = (input) => deps.resolveSamplerPreset(input);
  const resolveThinkingMode = (input) => deps.resolveThinkingMode(input);
  const resolveThinkingBudgetTokens = (input) => deps.resolveThinkingBudgetTokens(input);
  const loadToolCallsMeta = () => deps.loadToolCallsMeta();
  const getToolCallsMetaSync = () => deps.getToolCallsMetaSync();
  const isConstrainedDecodingEnabledForProvider = (provider, meta) => deps.isConstrainedDecodingEnabledForProvider(provider, meta);
  const readProviderCapabilities = (id) => deps.readProviderCapabilities(id);
  const isStructuredOutcomeResponseFormatAvailable = (modelId, caps) => deps.isStructuredOutcomeResponseFormatAvailable(modelId, caps);
  const resolveSendCapabilities = (providerId, modelId, apiKind) => deps.resolveSendCapabilities(providerId, modelId, apiKind);
  const applyContextPolicy = (input) => deps.applyContextPolicy(input);
  const isVisionModel = (modelId) => deps.isVisionModel?.(modelId) === true;
  const getModelRowForSelectOrCanonicalId = (id) => deps.getModelRow?.(id) ?? null;
  const recordSubAgentTurnUsage = (parentChatId, payload) => deps.recordTurnUsage?.({ parentChatId, ...payload }, payload) ?? Promise.resolve();
  const reportBackgroundError = (kind, detail) => deps.reportBackgroundError?.(kind, detail);
  function findChatById(chatId) {
    return deps.transcriptStore.load(chatId)?.meta;
  }
  async function tryNonStreamingFallback(body, signal, providerId) {
    const provider = await resolveProvider(providerId);
    const res = await postChatCompletions(
      provider,
      { ...body, stream: false },
      signal,
      { stream: false, fallbackRole: "sub-agent" }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCompletionResponseBody(await res.text());
  }
  function resolveStreamedCompletionText(content, reasoning) {
    const prose = content.trim();
    if (prose) return prose;
    return reasoning.trim();
  }
  async function completionTextForTurn(turnResult, body, provider, sendCaps, signal) {
    let text = resolveStreamedCompletionText(turnResult.fullText, turnResult.reasoningText);
    if (text.trim()) return text.trim();
    const { stream: _stream, ...fallbackBody } = sanitizeSubAgentBody(body, provider, sendCaps);
    const fallback = await tryNonStreamingFallback(fallbackBody, signal, provider.id);
    const message = fallback.choices?.[0]?.message;
    text = resolveStreamedCompletionText(
      extractAssistantCompletionText(message).trim(),
      extractReasoningMessage(message).trim()
    );
    return text.trim();
  }
  function sanitizeSubAgentBody(body, provider, sendCaps) {
    return sanitizeCompletionBodyForProvider(
      body,
      provider,
      sendCaps
    );
  }
  async function runSubAgentNonStreamTurn(providerId, body, signal, provider, sendCaps) {
    const t0 = performance.now();
    const sanitized = sanitizeSubAgentBody(body, provider, sendCaps);
    const { stream: _stream, ...fallbackBody } = sanitized;
    const chunk = await tryNonStreamingFallback(fallbackBody, signal, providerId);
    const message = chunk.choices?.[0]?.message;
    const fullText = extractAssistantCompletionText(message);
    const reasoningText = extractReasoningMessage(message).trim();
    const finishReasonRaw = chunk.choices?.[0]?.finish_reason;
    const finishReason = finishReasonRaw == null ? void 0 : finishReasonRaw;
    return {
      fullText,
      reasoningText,
      finishReason,
      toolCalls: [],
      streamMeta: {
        usage: chunk.usage,
        stats: chunk.stats,
        finish_reason: finishReason
      },
      t0,
      tFirst: t0,
      tEnd: performance.now()
    };
  }
  function logSubAgentDebug(event, detail) {
    void event;
    void detail;
  }
  function resolveSubAgentModelContextLimit(modelId) {
    const id = modelId.trim();
    if (!id) return null;
    if (deps.resolveModelContextLimit) return deps.resolveModelContextLimit(id);
    return null;
  }
  const LIVE_TRANSCRIPT_EMIT_MS = 80;
  function cloneSubAgentMessages2(messages) {
    return structuredClone(messages);
  }
  function buildSubAgentToolAssistantMessage(modelId, turnResult) {
    let reasoningText = turnResult.reasoningText.trim();
    let content = turnResult.fullText.trim() || null;
    if (modelRequiresReasoningContentReplay(modelId) && !reasoningText && content) {
      reasoningText = content;
      content = null;
    }
    return {
      role: "assistant",
      content,
      tool_calls: turnResult.toolCalls,
      ...outboundReasoningReplayFields(modelId, reasoningText, void 0, {
        toolCallTurn: true
      })
    };
  }
  async function streamSubAgentTurn(providerId, body, signal, fallbackRole, onDelta, sanitizeOptions, streamOptions) {
    return retryOnceOnTransientFetch(
      () => streamSubAgentTurnOnce(
        providerId,
        body,
        signal,
        fallbackRole,
        onDelta,
        sanitizeOptions,
        streamOptions
      )
    );
  }
  async function streamSubAgentTurnOnce(providerId, body, signal, fallbackRole, onDelta, sanitizeOptions, streamOptions) {
    const provider = sanitizeOptions?.provider ?? await resolveProvider(providerId);
    const sanitized = sanitizeSubAgentBody(
      body,
      provider,
      sanitizeOptions?.modelCapabilities
    );
    const turnAbort = new AbortController();
    if (signal.aborted) {
      turnAbort.abort();
    } else {
      signal.addEventListener("abort", () => turnAbort.abort(), { once: true });
    }
    const res = await postChatCompletions(provider, sanitized, turnAbort.signal, {
      fallbackRole
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    const modelId = body.model ?? "";
    const inlineRouter = new InlineContentThinkingRouter({
      thinkingModel: modelLikelyUsesInlineThinking(modelId)
    });
    const harmonyRouter = new HarmonyChannelRouter();
    const toolCallRouter = new ContentToolCallRouter();
    const thinkingToolCallRouter = new ContentToolCallRouter();
    const carriedText = streamOptions?.carriedText ?? "";
    let proseText = carriedText;
    let reasoningText = streamOptions?.carriedReasoning ?? "";
    let streamMeta = {};
    let toolAcc = {};
    const t0 = performance.now();
    let tFirst = null;
    const thinkingBudgetTracker = streamOptions?.thinkingBudgetTracker ?? null;
    let prefillEchoPartial = streamOptions?.prefillEchoPartial?.trim() ?? "";
    let carriedEchoPending = carriedText.trim().length > 0;
    let toolCallPhaseStarted = false;
    let budgetTripped = false;
    let thinkingChannel;
    let reader = null;
    if (carriedText) {
      onDelta?.(proseText);
    }
    function feedThinkingBudget(delta) {
      if (!thinkingBudgetTracker || !delta) return;
      thinkingBudgetTracker.feed(delta);
      if (thinkingBudgetTracker.exceeded && !budgetTripped) {
        budgetTripped = true;
        void reader?.cancel();
        turnAbort.abort();
      }
    }
    function noteThinkingChannel(channel) {
      thinkingChannel ??= channel;
    }
    function notifyReasoningDelta() {
      if (!reasoningText) return;
      streamOptions?.onReasoningDelta?.(reasoningText);
    }
    function emitThinking(text) {
      if (!text) {
        return;
      }
      feedThinkingBudget(text);
      reasoningText += text;
      notifyReasoningDelta();
    }
    function processRoutedParts(parts) {
      for (const [text, isThinking] of parts) {
        if (isThinking) {
          if (text) {
            noteThinkingChannel("inline");
            emitThinking(thinkingToolCallRouter.feed(text));
          }
          continue;
        }
        if (!text) {
          continue;
        }
        thinkingBudgetTracker?.endSession();
        if (tFirst == null) tFirst = performance.now();
        emitProse(toolCallRouter.feed(text));
      }
    }
    function emitProse(text) {
      if (!text) {
        return;
      }
      proseText += text;
      onDelta?.(proseText);
    }
    function routeContentDelta(delta) {
      if (!delta) {
        return;
      }
      for (const [harmonyText, isHarmonyThinking] of harmonyRouter.feed(delta)) {
        if (isHarmonyThinking) {
          if (harmonyText) {
            noteThinkingChannel("inline");
            feedThinkingBudget(harmonyText);
            reasoningText += harmonyText;
            notifyReasoningDelta();
          }
          continue;
        }
        processRoutedParts(inlineRouter.feed(harmonyText));
      }
    }
    function flushContentRouters() {
      for (const [harmonyText, isHarmonyThinking] of harmonyRouter.flush()) {
        if (isHarmonyThinking) {
          if (harmonyText) {
            noteThinkingChannel("inline");
            feedThinkingBudget(harmonyText);
            reasoningText += harmonyText;
            notifyReasoningDelta();
          }
          continue;
        }
        processRoutedParts(inlineRouter.feed(harmonyText));
      }
      processRoutedParts(inlineRouter.flush());
      emitThinking(thinkingToolCallRouter.flush());
      emitProse(toolCallRouter.flush());
    }
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    const sseBuffer = createSseEventBuffer();
    function handleChunk(chunk) {
      streamMeta = mergeStreamMeta(streamMeta, chunk);
      toolAcc = mergeToolCallDelta(toolAcc, chunk);
      const reasoningDelta = extractReasoningDelta(chunk);
      if (reasoningDelta) {
        noteThinkingChannel("native");
        feedThinkingBudget(reasoningDelta);
        reasoningText += reasoningDelta;
        notifyReasoningDelta();
      }
      const contentDelta = extractStreamDelta(chunk);
      if (contentDelta) {
        let routedDelta = contentDelta;
        if (prefillEchoPartial) {
          routedDelta = stripPrefillEchoFromDelta(routedDelta, prefillEchoPartial);
          prefillEchoPartial = "";
        }
        if (carriedEchoPending) {
          routedDelta = stripCarriedTextEcho(routedDelta, carriedText);
          carriedEchoPending = false;
        }
        routeContentDelta(routedDelta);
      }
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
      const e = err;
      if (e?.name !== "AbortError" || !budgetTripped) {
        throw err;
      }
    }
    flushSseEventBuffer(sseBuffer, handleChunk);
    flushContentRouters();
    let fullText = proseText;
    const split = extractInlineThinkingFromContent(fullText);
    if (split.thinking.length && split.reply.trim()) {
      reasoningText += split.thinking.join("\n\n");
      fullText = split.reply;
    }
    const streamedToolCalls = finalizeToolCalls(toolAcc);
    const toolCalls = mergeContentJsonToolCalls(fullText, streamedToolCalls, {
      harmonyParseText: harmonyRouter.getCommentaryParseText(),
      xmlParseText: toolCallRouter.getToolCallParseText(),
      // Thinking-side markup: the streamed think span, plus a block the post-stream split
      // just moved out of `fullText` and into reasoning.
      thinkingXmlParseText: [
        thinkingToolCallRouter.getToolCallParseText(),
        ...split.thinking
      ].join("\n")
    });
    if (toolCalls.length > 0 && hasXmlToolCallMarkup(fullText)) {
      fullText = stripXmlToolCallBlocks(fullText);
    }
    const finishReason = streamMeta.finish_reason || (toolCalls.length > 0 ? "tool_calls" : void 0);
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
      partialThinkingText: budgetTripped ? thinkingBudgetTracker?.sessionText : void 0,
      thinkingChannel
    };
  }
  async function ledgerSubAgentTurn(input, turn) {
    await recordSubAgentTurnUsage(input.parentChatId, {
      subAgentType: input.type,
      runId: input.runId,
      providerId: input.providerId,
      modelId: input.modelId,
      streamMeta: turn.streamMeta,
      t0: turn.t0,
      tFirst: turn.tFirst,
      tEnd: turn.tEnd
    });
  }
  const defaultSubAgentRunner = {
    async run(input) {
      // Isolated (no priorMessages): [system, user(task)]. Continue: prior
      // transcript plus this turn's systemPrompt (P6-C).
      const messages = buildOpeningMessages(
        input.systemPrompt,
        input.task,
        input.priorMessages
      );
      let toolTurns = 0;
      let proseQuestionRetries = 0;
      let emptyPostToolRetries = 0;
      const hasAskQuestionTool = input.tools.some((t) => t.function.name === "ask_question");
      const typeConfig = await getSubAgentTypeConfig(input.type);
      const resolvedSampler = resolveSamplerPreset({
        kind: "sub-agent",
        agentKey: input.type,
        global: { maxTokens: 2048, preset: {} },
        subAgentMaxTokensFallback: 2048,
        subAgentType: typeConfig
      });
      const parentChat = input.parentChatId ? findChatById(input.parentChatId) : void 0;
      const resolvedThinking = resolveThinkingMode({
        kind: "sub-agent",
        agentKey: input.type,
        chatThinkingMode: parentChat?.thinkingMode,
        subAgentType: typeConfig
      });
      const resolvedThinkingBudget = resolveThinkingBudgetTokens({
        kind: "sub-agent",
        agentKey: input.type,
        subAgentType: typeConfig
      });
      let toolUseNudgeSent = false;
      const contextBudget = input.contextBudget ?? {
        enforcementPolicy: DEFAULT_CONTEXT_ENFORCEMENT_POLICY
      };
      const modelContextLimit = input.modelContextLimit !== void 0 ? input.modelContextLimit : resolveSubAgentModelContextLimit(input.modelId);
      let lastProgressEmit = 0;
      let forcedEmitQueued = false;
      let forcedPartialAssistant;
      const usageSegments = [];
      const statsSegments = [];
      // Report each segment as it lands, not only in the return value. A turn
      // that unwinds by throwing — which is how `run-turn`'s report tool ends a
      // successful attempt — never reaches the return, and its tokens would
      // otherwise be uncountable.
      const noteUsage = (segment) => {
        if (typeof input.onUsage !== "function") return;
        try {
          input.onUsage(segment);
        } catch {
          /* accounting must never break a run */
        }
      };
      const budgetEvents = [];
      const summarySchema = input.summarySchema;
      const flushForcedEmit = () => {
        forcedEmitQueued = false;
        if (!input.onMessagesChange) return;
        lastProgressEmit = Date.now();
        const snapshot = cloneSubAgentMessages2(messages);
        const partial = forcedPartialAssistant;
        forcedPartialAssistant = void 0;
        if (partial) {
          snapshot.push({ role: "assistant", content: partial });
        }
        input.onMessagesChange(snapshot);
      };
      const emitProgress = (partialAssistant, force = false) => {
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
        const snapshot = cloneSubAgentMessages2(messages);
        if (partialAssistant) {
          snapshot.push({ role: "assistant", content: partialAssistant });
        }
        input.onMessagesChange(snapshot);
      };
      let liveEmitQueued = false;
      let pendingLive = null;
      const flushLiveActivity = () => {
        liveEmitQueued = false;
        if (!pendingLive || !input.onLiveActivity) return;
        const snapshot = pendingLive;
        pendingLive = null;
        input.onLiveActivity(snapshot);
      };
      const emitLiveActivity = (patch, force = false) => {
        if (!input.onLiveActivity) return;
        pendingLive = {
          phase: pendingLive?.phase ?? null,
          partialReasoning: pendingLive?.partialReasoning,
          currentToolName: pendingLive?.currentToolName,
          ...patch
        };
        if (force) {
          flushLiveActivity();
          return;
        }
        if (liveEmitQueued) return;
        liveEmitQueued = true;
        queueMicrotask(flushLiveActivity);
      };
      emitProgress(void 0, true);
      emitLiveActivity({ phase: "generating", partialReasoning: void 0, currentToolName: null }, true);
      await loadToolCallsMeta();
      const provider = await resolveProvider(input.providerId);
      const sendCaps = resolveSendCapabilities(input.providerId, input.modelId, provider.apiKind);
      const turnReasoningEffort = modelUsesComposerReasoningDropdown(sendCaps) ? resolveEffectiveReasoningEffort(parentChat ?? {}, sendCaps, resolvedThinking.mode) : void 0;
      const providerCapabilities = await readProviderCapabilities(input.providerId);
      const toolCallsMeta = getToolCallsMetaSync();
      const constrainedUserEnabled = isConstrainedDecodingEnabledForProvider(
        provider,
        toolCallsMeta
      );
      const toolsReserveTokens = estimateToolsTokens(input.tools);
      const enforceContextBudget = async (turnIndex) => {
        const budgetResolved = resolveContextBudget({
          agentConfig: contextBudget,
          modelLimit: modelContextLimit,
          reservedTokens: toolsReserveTokens
        });
        const budgetApplied = await applyContextPolicy({
          messages,
          policy: contextBudget.enforcementPolicy,
          modelLimit: modelContextLimit,
          agentConfig: contextBudget,
          providerId: input.providerId,
          modelId: input.modelId,
          signal: input.signal,
          reservedTokens: toolsReserveTokens
        });
        if (budgetApplied.applied) {
          messages.length = 0;
          messages.push(...budgetApplied.messages);
          if (budgetApplied.statusMessage) {
            budgetEvents.push({
              turn: turnIndex,
              label: budgetApplied.statusMessage,
              estimatedTokens: budgetApplied.tokensAfter
            });
          }
        }
        const limit = budgetResolved.effectiveLimit;
        if (limit != null && estimateApiMessagesTokens(messages) > limit) {
          return false;
        }
        return true;
      };
      const requestStructuredOutcome = async (repair) => {
        const finalMessages = cloneSubAgentMessages2(messages);
        if (repair) {
          finalMessages.push({
            role: "user",
            content: SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT
          });
        } else {
          finalMessages.push({
            role: "user",
            content: buildSubAgentFinalizationPrompt(summarySchema).trim()
          });
        }
        let body = applySamplerToBody(
          {
            model: input.modelId || void 0,
            messages: finalMessages,
            stream: true
          },
          resolvedSampler.preset,
          resolvedSampler.maxTokens
        );
        mergeThinkingIntoCompletionBody(
          body,
          "off",
          provider,
          sendCaps
        );
        const modelRow = getModelRowForSelectOrCanonicalId(input.modelId);
        const resolvedApi = resolveModelApi(provider, input.modelId, modelRow ?? void 0);
        const anthropicFinalization = resolvedApi === "anthropic-v1";
        let usedOutcomeResponseFormat = false;
        const outcomeFormat = buildSubAgentOutcomeResponseFormat(summarySchema);
        if (outcomeFormat && !anthropicFinalization && isStructuredOutcomeResponseFormatAvailable(input.modelId, providerCapabilities)) {
          body = { ...body, response_format: outcomeFormat };
          usedOutcomeResponseFormat = true;
        }
        const preferNonStreamFinalization = usedOutcomeResponseFormat && providerCapabilities?.structuredOutputStreaming !== true;
        if (preferNonStreamFinalization) {
          body.stream = false;
        }
        const runFinalizationTurn = async (attemptBody) => {
          if (attemptBody.stream === false) {
            return runSubAgentNonStreamTurn(
              input.providerId,
              attemptBody,
              input.signal,
              provider,
              sendCaps
            );
          }
          try {
            return await streamSubAgentTurn(
              input.providerId,
              attemptBody,
              input.signal,
              input.type,
              void 0,
              { provider, modelCapabilities: sendCaps }
            );
          } catch (streamErr) {
            if (usedOutcomeResponseFormat && isResponseFormatRejectionError(streamErr)) {
              usedOutcomeResponseFormat = false;
              return streamSubAgentTurn(
                input.providerId,
                stripResponseFormatFromBody(attemptBody),
                input.signal,
                input.type,
                void 0,
                { provider, modelCapabilities: sendCaps }
              );
            }
            throw streamErr;
          }
        };
        let turnResult = await runFinalizationTurn(body);
        await ledgerSubAgentTurn(input, turnResult);
        const turnUsage = turnResult.streamMeta.usage ?? {};
        const turnStats = turnResult.streamMeta.stats ?? {};
        if (Object.keys(turnUsage).length > 0) {
          usageSegments.push(turnUsage);
          noteUsage(turnUsage);
        }
        if (Object.keys(turnStats).length > 0 || Object.keys(turnUsage).length > 0) {
          statsSegments.push({ stats: turnStats, usage: turnUsage });
        }
        let rawText = await completionTextForTurn(
          turnResult,
          body,
          provider,
          sendCaps,
          input.signal
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
            input.signal
          );
        }
        logSubAgentDebug("finalization_turn", {
          repair,
          usedOutcomeResponseFormat,
          finishReason: turnResult.finishReason ?? null,
          rawLen: rawText.length,
          preview: rawText ? `${rawText.slice(0, 200)}${rawText.length > 200 ? "\u2026" : ""}` : ""
        });
        if (!rawText) {
          return {
            ok: false,
            parseError: "Empty response from provider on final turn",
            rawText: ""
          };
        }
        try {
          const parsed = parseStructuredOutcomeJson(rawText);
          const outcome = validateStructuredOutcome(parsed, summarySchema);
          if (outcome) return { ok: true, outcome, rawText };
          const preview = rawText.length > 200 ? `${rawText.slice(0, 200)}\u2026` : rawText;
          return {
            ok: false,
            parseError: `JSON did not match summary schema (preview: ${JSON.stringify(preview)})`,
            rawText
          };
        } catch {
          const preview = rawText.length > 200 ? `${rawText.slice(0, 200)}\u2026` : rawText;
          return {
            ok: false,
            parseError: `Invalid JSON in final response (preview: ${JSON.stringify(preview)})`,
            rawText
          };
        }
      };
      let turnThinkingBudgetTracker = null;
      let turnBudgetContinuationAttempts = 0;
      for (let turn = 0; ; turn++) {
        if (!await enforceContextBudget(turn)) {
          return {
            summary: SUB_AGENT_CONTEXT_BUDGET_ERROR,
            toolTurns,
            messages,
            contextBudgetExhausted: true,
            budgetEvents,
            usage: usageSegments.length ? sumUsageSegments(usageSegments) : void 0,
            stats: statsSegments.length ? averageStatsSegments(statsSegments) : void 0
          };
        }
        const repaired = repairUnpairedToolCalls(messages);
        messages.length = 0;
        messages.push(...repaired);
        const body = applySamplerToBody(
          {
            model: input.modelId || void 0,
            messages,
            stream: true
          },
          resolvedSampler.preset,
          resolvedSampler.maxTokens
        );
        const llamaSupportsThinkingBudget = provider.id === LLAMA_CPP_LOCAL_PROVIDER_ID && providerCapabilities?.supportsThinkingBudget === true;
        const { nativeBudgetApplied } = mergeThinkingIntoCompletionBody(
          body,
          resolvedThinking.mode,
          provider,
          sendCaps,
          turnReasoningEffort,
          void 0,
          resolvedThinkingBudget.budgetTokens,
          { llamaSupportsThinkingBudget }
        );
        let thinkingBudgetTracker = null;
        if (resolvedThinkingBudget.budgetTokens != null && !nativeBudgetApplied && resolvedThinking.mode === "on") {
          turnThinkingBudgetTracker ??= new ThinkingBudgetTracker(
            resolvedThinkingBudget.budgetTokens
          );
          thinkingBudgetTracker = turnThinkingBudgetTracker;
        }
        if (input.tools.length > 0) {
          body.tools = input.tools;
          body.tool_choice = "auto";
        }
        let usedConstrained = false;
        if (input.tools.length > 0) {
          const constrainedApplied = applyConstrainedToolCallsToBody(body, {
            providerId: input.providerId,
            modelId: input.modelId,
            userEnabled: constrainedUserEnabled,
            capabilities: providerCapabilities,
            enabledTools: input.tools
          });
          Object.assign(body, constrainedApplied.body);
          usedConstrained = constrainedApplied.usedConstrained;
        }
        let streamingAssistant = "";
        const streamProgress = {
          onReasoningDelta: (reasoningSoFar) => {
            emitLiveActivity({
              phase: "thinking",
              partialReasoning: reasoningSoFar,
              currentToolName: null
            });
          },
          onToolCallDelta: (toolName) => {
            emitLiveActivity({
              phase: "tools",
              currentToolName: toolName
            });
          }
        };
        const runSubTurn = (turnBody, streamOpts) => streamSubAgentTurn(
          input.providerId,
          turnBody,
          input.signal,
          input.type,
          (fullSoFar) => {
            streamingAssistant = fullSoFar;
            emitLiveActivity({
              phase: "generating",
              partialReasoning: void 0,
              currentToolName: null
            });
            emitProgress(streamingAssistant);
          },
          { provider, modelCapabilities: sendCaps },
          {
            ...streamOpts,
            ...streamProgress
          }
        );
        const runSubTurnWithThinkingBudget = async () => {
          let currentBody = body;
          const tracker = thinkingBudgetTracker;
          let prefillPartial = "";
          let carriedText = "";
          let carriedReasoning = "";
          const maxContinuations = 2;
          const streamOpts = () => ({
            thinkingBudgetTracker: tracker,
            prefillEchoPartial: prefillPartial || void 0,
            carriedText: carriedText || void 0,
            carriedReasoning: carriedReasoning || void 0
          });
          while (true) {
            let turnResult2;
            try {
              turnResult2 = await runSubTurn(currentBody, streamOpts());
            } catch (streamErr) {
              if (usedConstrained && isResponseFormatRejectionError(streamErr)) {
                usedConstrained = false;
                currentBody = stripResponseFormatFromBody(currentBody);
                turnResult2 = await runSubTurn(currentBody, streamOpts());
              } else {
                throw streamErr;
              }
            }
            if (!turnResult2.thinkingBudgetExceeded || !tracker || turnBudgetContinuationAttempts >= maxContinuations) {
              if (turnBudgetContinuationAttempts > 0) tracker?.disarm();
              return turnResult2;
            }
            turnBudgetContinuationAttempts += 1;
            const partialThinking = turnResult2.reasoningText.trim() || (turnResult2.partialThinkingText ?? "");
            const partialText = turnResult2.fullText;
            const isFinalAttempt = turnBudgetContinuationAttempts >= maxContinuations;
            if (!isFinalAttempt) {
              const canPrefill = turnResult2.thinkingChannel === "inline" || turnResult2.thinkingChannel == null && (modelLikelyUsesInlineThinking(input.modelId) || provider.id === LLAMA_CPP_LOCAL_PROVIDER_ID && !llamaSupportsThinkingBudget);
              const usePrefill = canPrefill && !partialText.trim();
              currentBody = {
                ...body,
                messages: [
                  ...messages,
                  ...usePrefill ? [buildThinkingPrefillAssistantMessage(partialThinking)] : buildBudgetContinuationMessages({ partialThinking, partialText })
                ]
              };
              prefillPartial = usePrefill ? partialThinking : "";
              carriedText = partialText;
              carriedReasoning = turnResult2.reasoningText;
              tracker.beginContinuation();
              continue;
            }
            const continuationBody = applySamplerToBody(
              {
                model: input.modelId || void 0,
                messages: [
                  ...messages,
                  ...buildBudgetContinuationMessages({ partialThinking, partialText })
                ],
                stream: true
              },
              resolvedSampler.preset,
              resolvedSampler.maxTokens
            );
            mergeThinkingIntoCompletionBody(
              continuationBody,
              "off",
              provider,
              sendCaps,
              turnReasoningEffort
            );
            if (input.tools.length > 0) {
              continuationBody.tools = input.tools;
              continuationBody.tool_choice = "auto";
            }
            currentBody = continuationBody;
            prefillPartial = "";
            carriedText = partialText;
            carriedReasoning = turnResult2.reasoningText;
            tracker.disarm();
          }
        };
        let turnResult;
        turnResult = await runSubTurnWithThinkingBudget();
        const subFinishReason = turnResult.finishReason || (turnResult.toolCalls.length > 0 ? "tool_calls" : void 0);
        const subStreamEnd = classifyStreamEnd({
          finishReason: subFinishReason,
          toolCallsCount: turnResult.toolCalls.length,
          textLength: turnResult.fullText.trim().length,
          streamError: turnResult.streamMeta.error
        });
        if (subStreamEnd.kind !== "complete" && subStreamEnd.kind !== "truncated") {
          reportBackgroundError("stream-end-abnormal", {
            kind: subStreamEnd.kind,
            providerId: input.providerId,
            modelId: input.modelId,
            finishReason: subFinishReason ?? null,
            textLength: turnResult.fullText.trim().length,
            round: turn
          });
        }
        applyClassifiedStreamEnd(subStreamEnd, {
          hasPostToolTail: hasPostToolTail(messages),
          textLength: turnResult.fullText.trim().length
        });
        await ledgerSubAgentTurn(input, turnResult);
        const turnUsage = turnResult.streamMeta.usage ?? {};
        const turnStats = turnResult.streamMeta.stats ?? {};
        if (Object.keys(turnUsage).length > 0) {
          usageSegments.push(turnUsage);
          noteUsage(turnUsage);
        }
        if (Object.keys(turnStats).length > 0 || Object.keys(turnUsage).length > 0) {
          statsSegments.push({ stats: turnStats, usage: turnUsage });
        }
        logSubAgentDebug("work_turn", {
          turn,
          toolTurns,
          finishReason: turnResult.finishReason ?? null,
          toolCallCount: turnResult.toolCalls.length,
          proseLen: turnResult.fullText.length
        });
        if (turnResult.toolCalls.length > 0) {
          toolTurns += 1;
          messages.push(
            buildSubAgentToolAssistantMessage(input.modelId, turnResult)
          );
          const firstTool = turnResult.toolCalls[0]?.function?.name?.trim();
          emitLiveActivity(
            {
              phase: "tools",
              currentToolName: firstTool || null,
              partialReasoning: void 0
            },
            true
          );
          emitProgress(void 0, true);
          const outcomes = await runHeadlessToolBatch({
            toolCalls: turnResult.toolCalls,
            constrained: usedConstrained,
            signal: input.signal,
            execute: (name, args, ctx) => input.executeTool(name, args, {
              ...input.toolExecuteContext,
              toolCallId: ctx.toolCallId
            })
          });
          for (const outcome of outcomes) {
            const tc = outcome.toolCall;
            if (outcome.parseError) {
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: outcome.parseError
              });
            } else {
              const toolOut = outcome.result ?? { content: "" };
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: toolOut.content
              });
              if (isVisionModel(input.modelId)) {
                const followUp = toolImageFollowUpFromAttachments(toolOut.attachments);
                if (followUp) messages.push(followUp);
              }
            }
            emitProgress(void 0, true);
          }
          continue;
        }
        let prose = await completionTextForTurn(
          turnResult,
          body,
          provider,
          sendCaps,
          input.signal
        );
        if (!prose && toolTurns > 0 && hasPostToolTail(messages) && emptyPostToolRetries < MAX_EMPTY_POST_TOOL_RETRIES) {
          emptyPostToolRetries += 1;
          messages.push({ role: "user", content: EMPTY_POST_TOOL_CONTINUE_INSTRUCTION });
          emitProgress(void 0, true);
          continue;
        }
        if (hasAskQuestionTool && prose && looksLikeProseStructuredQuestion(prose) && proseQuestionRetries < MAX_PROSE_QUESTION_RETRIES) {
          proseQuestionRetries += 1;
          messages.push({ role: "assistant", content: prose });
          messages.push({ role: "user", content: PROSE_QUESTION_RETRY_INSTRUCTION });
          emitProgress(void 0, true);
          continue;
        }
        if (input.nudgeToolUse !== false && input.tools.length > 0 && toolTurns === 0 && !toolUseNudgeSent) {
          toolUseNudgeSent = true;
          messages.push({ role: "user", content: SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION });
          emitProgress(void 0, true);
          continue;
        }
        if (!await enforceContextBudget(turn)) {
          return {
            summary: SUB_AGENT_CONTEXT_BUDGET_ERROR,
            toolTurns,
            messages,
            contextBudgetExhausted: true,
            budgetEvents,
            usage: usageSegments.length ? sumUsageSegments(usageSegments) : void 0,
            stats: statsSegments.length ? averageStatsSegments(statsSegments) : void 0
          };
        }
        const returnProseWithoutFinalization = () => {
          messages.push({ role: "assistant", content: prose });
          emitProgress(void 0, true);
          return {
            summary: prose || "",
            toolTurns,
            messages,
            budgetEvents: budgetEvents.length ? budgetEvents : void 0,
            usage: usageSegments.length ? sumUsageSegments(usageSegments) : void 0,
            stats: statsSegments.length ? averageStatsSegments(statsSegments) : void 0
          };
        };
        // Chat (P6-C) skips structured-outcome finalization. Board / sub-agent
        // callers leave this unset so today's extra completion still runs.
        if (input.finalizeStructuredOutcome === false) {
          return returnProseWithoutFinalization();
        }
        const proseOutcome = tryParseStructuredOutcomeFromAssistantProse(prose, summarySchema);
        if (proseOutcome) {
          messages.push({ role: "assistant", content: prose });
          emitProgress(void 0, true);
          return {
            summary: proseOutcome.summary,
            structuredOutcome: proseOutcome,
            toolTurns,
            messages,
            budgetEvents: budgetEvents.length ? budgetEvents : void 0,
            usage: usageSegments.length ? sumUsageSegments(usageSegments) : void 0,
            stats: statsSegments.length ? averageStatsSegments(statsSegments) : void 0
          };
        }
        const returnProseFallbackOutcome = () => {
          messages.push({ role: "assistant", content: prose });
          emitProgress(void 0, true);
          const legacy = legacyOutcomeFromSummary(prose);
          logSubAgentDebug("prose_fallback_outcome", { proseLen: prose.length, toolTurns });
          return {
            summary: legacy.summary,
            structuredOutcome: legacy,
            toolTurns,
            messages,
            budgetEvents: budgetEvents.length ? budgetEvents : void 0,
            usage: usageSegments.length ? sumUsageSegments(usageSegments) : void 0,
            stats: statsSegments.length ? averageStatsSegments(statsSegments) : void 0
          };
        };
        try {
          const firstFinal = await requestStructuredOutcome(false);
          const finalized = firstFinal.ok ? firstFinal : await requestStructuredOutcome(true);
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
              budgetEvents: budgetEvents.length ? budgetEvents : void 0,
              usage: usageSegments.length ? sumUsageSegments(usageSegments) : void 0,
              stats: statsSegments.length ? averageStatsSegments(statsSegments) : void 0
            };
          }
          messages.push({ role: "assistant", content: finalized.rawText });
          emitProgress(void 0, true);
          return {
            summary: finalized.outcome.summary,
            structuredOutcome: finalized.outcome,
            toolTurns,
            messages,
            budgetEvents: budgetEvents.length ? budgetEvents : void 0,
            usage: usageSegments.length ? sumUsageSegments(usageSegments) : void 0,
            stats: statsSegments.length ? averageStatsSegments(statsSegments) : void 0
          };
        } catch (finalErr) {
          if (prose.trim() && toolTurns > 0) {
            logSubAgentDebug("finalization_error_prose_fallback", {
              proseLen: prose.length,
              toolTurns,
              error: finalErr instanceof Error ? finalErr.message : String(finalErr)
            });
            return returnProseFallbackOutcome();
          }
          throw finalErr;
        }
      }
    }
  };
  return defaultSubAgentRunner;
}
function cloneSubAgentMessages(messages) {
  return structuredClone(messages);
}
export {
  cloneSubAgentMessages,
  createSubAgentRunner
};
