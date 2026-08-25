import { getChatAbort, setChatAbort, setStreaming } from '../app-state';
import {
  isActiveChatStreaming,
  isBackgroundStreamBlockingSend,
  isStreamDomVisible,
} from '../chat/streaming-state';
import {
  cancelAssistantBubbleRenderDebounce,
  finishStreamingBubbleRender,
  scheduleAssistantBubbleRender,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import { completeStreamAnnouncer } from '../ui/a11y/stream-announcer';
import { resolveModelInfo } from './models';
import {
  isFirstUserMessagePending,
  scheduleChatTitleGeneration,
} from '../chat/titles/schedule';
import {
  ensureChatHistoryLoaded,
  getActiveChat,
  scheduleSaveSessions,
  recordChatMessage,
} from '../state/sessions';
import { resolveEffectiveChatModelBinding } from '../ui/default-model';
import { applyModelSelectValueToChat } from '../lib/model-select-key';
import { clearComposerAfterSend } from '../ui/composer-draft';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import type {
  ApiMessage,
  AssistantMessage,
  ChatCompletionChunk,
  LlamaPromptProgress,
  LlamaTimings,
  ModelInfo,
  Stats,
  ToolCall,
  ToolCallAccumulator,
  Usage,
} from '../types';
import { formatGenerationErrorMessage } from './generations';
import { normalizeModeId } from '../chat/modes/types.ts';
import { markMessageStopped } from '../ui/stopped-affordance';
import { recordMainChatTurnUsage } from '../usage/record-chat-usage';
import { getActiveProvider } from '../providers/store';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import {
  setComposerStreamingMode,
  syncComposerFromStreamingState,
} from '../ui/composer-send';
import {
  appendBubble,
  appendInjectionNoticesDom,
  appendStats,
  appendStreamingAssistantRow,
  revealAssistantProseBubble,
  setAssistantErrorBubble,
} from '../ui/messages';
import { streamDeltaContentToText } from './message-content.ts';
import {
  extractInlineThinkingFromContent,
  HarmonyChannelRouter,
  InlineContentThinkingRouter,
  modelLikelyUsesInlineThinking,
  type RoutedContentPart,
} from './inline-thinking';
import { extractReasoningDelta, extractReasoningMessage } from './reasoning';
import {
  renderThoughtsToggle,
  ThoughtBubbleController,
  syncThoughtsCaretPulse,
  thoughtsScopeFromEl,
} from '../ui/thought-bubbles';
import { ThinkingDurationTracker } from '../ui/thinking-duration';
import {
  appendInjectionNoticesForTurn,
  isUiOnlyTranscriptMessage,
} from '../chat/context/injection-notice';
import { resolveOutboundSystemMessages } from '../chat/prompts/compose-context';
import { resolveContextLimit } from '../chat/context-usage';
import {
  recordAssistantReplyOnChat,
  setSidebarStreamPhase,
  syncChatItemDotsInDom,
} from '../ui/chat-item-dot';
import { renderSidebar } from '../ui/sidebar';
import {
  completeNonStreamingViaGenerations,
  postChatCompletions,
} from '../providers/fetch-chat';
import {
  createSseEventBuffer,
  feedSseEventBuffer,
  flushSseEventBuffer,
  parseSsePayloads,
} from './sse-parse';
import { setStatus } from '../ui/status';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';
import { createStreamingStatsPublisher } from '../chat/streaming-stats';
import { llamaRuntimeStatusView } from '../chat/llama-runtime-status';

export { parseSsePayloads } from './sse-parse';

/** Accumulated metadata from SSE chunks (stats, usage, model_info). */
export interface StreamMetaAccumulator {
  stats?: Stats;
  usage?: Usage;
  model_info?: ModelInfo;
  model?: string;
  finish_reason?: string;
  error?: string;
  /** Latest llama.cpp `timings` block seen on the stream. */
  timings?: LlamaTimings;
  /** Latest llama.cpp `prompt_progress` seen on the stream. */
  prompt_progress?: LlamaPromptProgress;
}

/** Non-streaming completion body (multimodal messages + optional tools). */
export interface ChatCompletionBody {
  model?: string;
  messages: ApiMessage[];
  temperature: number;
  max_tokens: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  presence_penalty?: number;
  tools?: OpenAIFunctionDefinition[];
  tool_choice?: 'auto';
  response_format?: {
    type: 'json_schema';
    json_schema: {
      name: string;
      strict?: boolean;
      schema: Record<string, unknown>;
    };
  };
}

// --- Stream / stats helpers ---
// LM Studio v0 streaming omits stats/model_info; usage arrives in a final chunk when requested.
// Assistant prose uses `content` only; reasoning uses `extractReasoningDelta` (see `./reasoning`).

/** Re-export reasoning helpers for callers that already import `chat.ts`. */
export {
  extractReasoningDelta,
  extractReasoningMessage,
  splitThinkingSegments,
} from './reasoning';

/** Provider error payload on an SSE chunk (OpenAI-style `error` or `finish_reason: error`). */
export function extractStreamErrorMessage(chunk: ChatCompletionChunk): string | undefined {
  const raw = chunk.error;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  if (raw && typeof raw === 'object') {
    const message = raw.message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }
  const finish = chunk.choices?.[0]?.finish_reason;
  if (finish === 'error') {
    return 'The provider reported a stream error.';
  }
  return undefined;
}

/** Pull visible assistant text from one SSE JSON chunk. */
export function extractStreamDelta(chunk: ChatCompletionChunk): string {
  const choice = chunk.choices?.[0];
  if (!choice) return '';
  const fromDelta = streamDeltaContentToText(choice.delta?.content);
  if (fromDelta) return fromDelta;
  return streamDeltaContentToText(choice.message?.content);
}

/** Merge streaming `tool_calls` fragments into an accumulator keyed by `index`. */
export function mergeToolCallDelta(
  acc: ToolCallAccumulator,
  chunk: ChatCompletionChunk
): ToolCallAccumulator {
  const deltas = chunk.choices?.[0]?.delta?.tool_calls;
  if (!deltas?.length) return acc;

  const next: ToolCallAccumulator = { ...acc };
  for (const d of deltas) {
    const idx = d.index;
    const existing = next[idx] || { type: 'function' as const, function: { name: '', arguments: '' } };
    const merged: Partial<ToolCall> = {
      ...existing,
      type: 'function',
      function: {
        name: existing.function?.name || '',
        arguments: existing.function?.arguments || '',
      },
    };
    if (d.id) merged.id = d.id;
    if (d.function?.name) {
      merged.function = {
        ...merged.function!,
        name: (merged.function?.name || '') + d.function.name,
      };
    }
    if (d.function?.arguments) {
      merged.function = {
        ...merged.function!,
        arguments: (merged.function?.arguments || '') + d.function.arguments,
      };
    }
    next[idx] = merged;
  }
  return next;
}

export { getLatestStreamingToolName } from './tool-call-stream.ts';

/** Turn a streaming accumulator into complete `ToolCall` rows (sorted by index). */
export function finalizeToolCalls(acc: ToolCallAccumulator): ToolCall[] {
  return Object.keys(acc)
    .map((k) => Number(k))
    .filter((idx) => Number.isFinite(idx))
    .sort((a, b) => a - b)
    .map((idx) => {
      const partial = acc[idx];
      return {
        id: partial?.id || `call_${idx}`,
        type: 'function' as const,
        function: {
          name: partial?.function?.name || '',
          arguments: partial?.function?.arguments || '',
        },
      };
    })
    .filter((tc) => Boolean(tc.function.name));
}

/** Plain message content from a non-streaming completion. */
export function extractMessageText(
  message: { content?: string | unknown } | null | undefined,
): string {
  if (!message?.content) return '';
  if (typeof message.content === 'string') return message.content;
  return streamDeltaContentToText(message.content);
}

/**
 * Assistant text from a completion message: prose content, structured parsed JSON, or refusal.
 */
export function extractAssistantCompletionText(
  message:
    | {
        content?: string | unknown;
        parsed?: unknown;
        refusal?: string;
      }
    | null
    | undefined,
): string {
  const fromContent = extractMessageText(message).trim();
  if (fromContent) return fromContent;

  const parsed = message?.parsed;
  if (parsed != null && typeof parsed === 'object') {
    return JSON.stringify(parsed);
  }
  if (typeof parsed === 'string' && parsed.trim()) {
    return parsed.trim();
  }

  const refusal = message?.refusal;
  if (typeof refusal === 'string' && refusal.trim()) {
    return refusal.trim();
  }

  return '';
}

/**
 * llama.cpp `timings` in the shape the stats reconciler already understands.
 *
 * Returns null until there is something worth trusting: the first chunk of a stream
 * reports `predicted_n: 1` over `predicted_ms: 0.001`, which is a million tokens per
 * second and not a measurement.
 */
export function statsFromLlamaTimings(timings: LlamaTimings | undefined): Stats | null {
  if (!timings) return null;
  const predictedN = Number(timings.predicted_n);
  const predictedMs = Number(timings.predicted_ms);
  if (!(predictedN >= 2) || !(predictedMs > 0)) return null;

  const out: Stats = {
    generation_time: predictedMs / 1000,
    tokens_per_second:
      Number(timings.predicted_per_second) > 0
        ? Number(timings.predicted_per_second)
        : (predictedN / predictedMs) * 1000,
  };
  // Prefill time is the engine's own time-to-first-token, measured rather than
  // inferred from when the browser saw the first byte.
  if (Number(timings.prompt_ms) > 0) out.time_to_first_token = Number(timings.prompt_ms) / 1000;
  if (Number(timings.prompt_per_second) > 0) {
    out.prompt_tokens_per_second = Number(timings.prompt_per_second);
  }
  const draftN = Number(timings.draft_n);
  const draftAccepted = Number(timings.draft_n_accepted);
  if (draftN > 0 && Number.isFinite(draftAccepted)) {
    out.draft_acceptance = draftAccepted / draftN;
  }
  return out;
}

/** Merge stats, usage, model_info, and finish_reason from successive chunks. */
export function mergeStreamMeta(
  acc: StreamMetaAccumulator | null | undefined,
  chunk: ChatCompletionChunk
): StreamMetaAccumulator {
  const next: StreamMetaAccumulator = { ...(acc || {}) };
  // llama.cpp sends these on every chunk once the request opts in; the last one is
  // the complete picture. Folded into `stats` so the existing reconciler can weigh
  // them against usage the same way it weighs any other server timing.
  if (chunk.timings) {
    next.timings = { ...next.timings, ...chunk.timings };
    const derived = statsFromLlamaTimings(next.timings);
    if (derived) next.stats = { ...next.stats, ...derived };
  }
  if (chunk.prompt_progress) next.prompt_progress = chunk.prompt_progress;
  if (chunk.stats) next.stats = { ...next.stats, ...chunk.stats };
  if (chunk.usage) next.usage = { ...next.usage, ...chunk.usage };
  if (chunk.model_info) next.model_info = { ...next.model_info, ...chunk.model_info };
  if (chunk.model) next.model = chunk.model;
  const finish = chunk.choices?.[0]?.finish_reason;
  if (finish) next.finish_reason = finish;
  const streamError = extractStreamErrorMessage(chunk);
  if (streamError) next.error = streamError;
  return next;
}

/** Upper bound for believable decode throughput (guards bad provider stats). */
export const MAX_PLAUSIBLE_TOKENS_PER_SECOND = 2000;

const MIN_DECODE_SECONDS = 0.001;

/**
 * Wall-clock decode window for tok/s. When the first visible token arrives in a
 * final burst (common with reasoning models), use full stream duration instead
 * of a sub-millisecond slice so throughput matches chat-style metrics.
 */
export function resolveDecodeSeconds(
  t0: number,
  tFirst: number | null,
  tEnd: number,
  completionTokens: number | null | undefined,
): { ttft: number; genTime: number } | null {
  if (tFirst == null) return null;
  const ttft = (tFirst - t0) / 1000;
  const streamSec = Math.max((tEnd - t0) / 1000, MIN_DECODE_SECONDS);
  let genTime = Math.max((tEnd - tFirst) / 1000, MIN_DECODE_SECONDS);
  if (completionTokens != null && completionTokens > 0) {
    const burstTps = completionTokens / genTime;
    if (burstTps > MAX_PLAUSIBLE_TOKENS_PER_SECOND) {
      genTime = streamSec;
    }
  }
  return { ttft, genTime };
}

/** Client-side TTFT / generation time / TPS when the server omits stats. */
export function buildClientStats(
  t0: number,
  tFirst: number | null,
  tEnd: number,
  usage: Usage | undefined,
  finishReason: string | undefined
): Stats {
  const completionTokens = usage?.completion_tokens;
  const timings = resolveDecodeSeconds(t0, tFirst, tEnd, completionTokens);
  if (!timings) return {};
  const tps = completionTokens != null ? completionTokens / timings.genTime : null;
  const stats: Stats = {
    time_to_first_token: timings.ttft,
    generation_time: timings.genTime,
  };
  if (tps != null) stats.tokens_per_second = tps;
  if (finishReason) stats.stop_reason = finishReason;
  return stats;
}

/** Relative error allowed between tps×genTime and completion_tokens. */
const USAGE_TIMING_TOLERANCE = 0.35;

function serverTimingMatchesUsage(server: Stats, usage: Usage | undefined): boolean {
  const completion = usage?.completion_tokens;
  const tps = server.tokens_per_second;
  const gen = server.generation_time;
  if (completion == null || completion <= 0) return true;
  if (tps == null || gen == null || !Number.isFinite(tps) || !Number.isFinite(gen) || gen <= 0) {
    return true;
  }
  if (tps > MAX_PLAUSIBLE_TOKENS_PER_SECOND) return false;
  const implied = tps * gen;
  return Math.abs(implied - completion) / completion <= USAGE_TIMING_TOLERANCE;
}

/** Whether server decode time yields a plausible tok/s for reported completion tokens. */
function serverGenerationTimeMatchesUsage(server: Stats, usage: Usage | undefined): boolean {
  const completion = usage?.completion_tokens;
  const gen = server.generation_time;
  if (completion == null || completion <= 0) return false;
  if (gen == null || !Number.isFinite(gen) || gen <= 0) return false;
  return completion / gen <= MAX_PLAUSIBLE_TOKENS_PER_SECOND;
}

function serverTimingMatchesClientWallClock(server: Stats, client: Stats): boolean {
  const serverGen = server.generation_time;
  const clientGen = client.generation_time;
  if (
    serverGen == null ||
    clientGen == null ||
    !Number.isFinite(serverGen) ||
    !Number.isFinite(clientGen) ||
    clientGen <= 0
  ) {
    return true;
  }
  if (clientGen < 1) return true;
  return serverGen >= clientGen * 0.2;
}

function applyServerTimingFields(out: Stats, serverStats: Stats): void {
  if (serverStats.time_to_first_token != null) {
    out.time_to_first_token = serverStats.time_to_first_token;
  }
  if (serverStats.generation_time != null) out.generation_time = serverStats.generation_time;
  if (serverStats.tokens_per_second != null) out.tokens_per_second = serverStats.tokens_per_second;
}

function recomputeTokensPerSecond(out: Stats, usage: Usage | undefined): void {
  const completion = usage?.completion_tokens;
  const gen = out.generation_time;
  if (completion != null && gen != null && gen > 0) {
    out.tokens_per_second = completion / gen;
  }
}

/**
 * Prefer provider timing when usage-coherent (full or partial trust); otherwise
 * keep client timings and recompute tok/s from completion_tokens.
 */
export function reconcileCompletionStats(
  clientStats: Stats,
  serverStats: Stats,
  usage: Usage | undefined
): Stats {
  const out: Stats = { ...clientStats };
  if (serverStats.stop_reason) out.stop_reason = serverStats.stop_reason;

  const hasServerTiming =
    serverStats.tokens_per_second != null ||
    serverStats.generation_time != null ||
    serverStats.time_to_first_token != null;
  if (!hasServerTiming) return out;

  const fullTrust =
    serverTimingMatchesUsage(serverStats, usage) &&
    serverTimingMatchesClientWallClock(serverStats, clientStats);

  if (fullTrust) {
    applyServerTimingFields(out, serverStats);
    return out;
  }

  // Partial trust: engine decode window fits usage even when client prose-only tFirst disagrees.
  if (serverGenerationTimeMatchesUsage(serverStats, usage)) {
    if (serverStats.time_to_first_token != null) {
      out.time_to_first_token = serverStats.time_to_first_token;
    }
    if (serverStats.generation_time != null) out.generation_time = serverStats.generation_time;
    recomputeTokensPerSecond(out, usage);
    return out;
  }

  // Client fallback when server timing is not usage-coherent.
  recomputeTokensPerSecond(out, usage);
  return out;
}

/** Combine server stream meta with client timing into final stats + usage. */
export function finalizeResponseMeta(
  streamMeta: StreamMetaAccumulator,
  t0: number,
  tFirst: number | null,
  tEnd: number
): { stats: Stats; usage: Usage; model_info: ModelInfo } {
  const usage = streamMeta.usage || {};
  const serverStats = streamMeta.stats || {};
  const clientStats = buildClientStats(t0, tFirst, tEnd, usage, streamMeta.finish_reason);
  const stats = reconcileCompletionStats(clientStats, serverStats, usage);
  return {
    stats,
    usage,
    model_info: streamMeta.model_info || {},
  };
}

/** Non-streaming fallback when SSE yields no assistant text. */
export async function tryNonStreamingFallback(
  body: ChatCompletionBody,
  signal: AbortSignal,
  chatProviderId?: string,
): Promise<ChatCompletionChunk> {
  const provider = await getActiveProvider(chatProviderId);
  return completeNonStreamingViaGenerations(provider, body, signal);
}

/** Send the composer text to LM Studio with SSE streaming and optional JSON fallback. */
export async function sendMessage(): Promise<void> {
  if (isActiveChatStreaming()) return;
  if (isBackgroundStreamBlockingSend()) {
    setStatus('spin', 'Stop or wait for the reply in the other chat first');
    return;
  }
  const input = document.getElementById('msgInput') as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text) return;

  const chat = getActiveChat();
  const binding = resolveEffectiveChatModelBinding(chat);
  const modelId = binding.modelId;
  if (binding.selectValue && !chat.modelId?.trim()) {
    applyModelSelectValueToChat(chat, binding.selectValue);
  }
  const temp = parseFloat((document.getElementById('temperature') as HTMLInputElement).value);
  const maxTok = parseInt((document.getElementById('maxTokens') as HTMLInputElement).value, 10);
  const legacySysPrompt = (
    document.getElementById('systemPrompt') as HTMLTextAreaElement
  ).value.trim();

  if (!modelId) {
    setStatus('err', 'Select a model first');
    return;
  }
  if (!Number.isFinite(temp) || temp < 0 || temp > 2) {
    setStatus('err', 'Temperature must be 0 to 2');
    return;
  }
  if (!Number.isFinite(maxTok) || maxTok < 1) {
    setStatus('err', 'Max tokens must be at least 1');
    return;
  }
  getChatAbort(chat.id)?.abort();
  const controller = new AbortController();
  setChatAbort(chat.id, controller);
  const chatSignal = controller.signal;

  chat.modelId = binding.modelId || chat.modelId;
  // C.1: defensive hydrate before first history mutation (no-op when lazy flag is off).
  await ensureChatHistoryLoaded(chat.id);
  const shouldScheduleTitle = isFirstUserMessagePending(chat);
  const firstUserSend = shouldScheduleTitle;
  chat.history.push({ role: 'user', content: text });
  clearComposerAfterSend(chat, input);
  recordChatMessage(chat);
  scheduleSaveSessions();
  renderSidebar();
  appendBubble('user', text);

  const outbound = await resolveOutboundSystemMessages(chat, legacySysPrompt, {
    userMessagePreview: text,
    routeUserText: text,
    firstUserSend,
    modelContextLimit: modelId ? resolveContextLimit(modelId, chat) : null,
  });

  const injectionAdded = appendInjectionNoticesForTurn(
    chat,
    outbound.injectionBlocks,
  );
  if (injectionAdded.length > 0) {
    scheduleSaveSessions();
    appendInjectionNoticesDom(
      injectionAdded,
      chat.history.length - injectionAdded.length,
      { chatId: chat.id },
    );
  }

  const messages: ApiMessage[] = [];
  if (outbound.composed) {
    messages.push({ role: 'system', content: outbound.composed });
  }
  if (outbound.userRules) {
    messages.push({ role: 'system', content: outbound.userRules });
  }
  for (const m of chat.history) {
    if (isUiOnlyTranscriptMessage(m)) continue;
    if (m.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: m.content,
      });
      continue;
    }
    if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.tool_calls,
      });
      continue;
    }
    messages.push({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    });
  }

  const body = {
    model: modelId || undefined,
    messages,
    temperature: temp,
    max_tokens: maxTok,
    stream: true,
    stream_options: { include_usage: true },
  };

  const { wrap, bubble, cursor, streamStatus } = appendStreamingAssistantRow(chat.id);
  const revealProse = (): void => {
    if (!isStreamDomVisible(chat.id)) return;
    revealAssistantProseBubble(wrap, bubble, streamStatus);
  };

  const thinkingTracker = new ThinkingDurationTracker((elapsedMs) => {
    thoughtController.setThinkingElapsed(elapsedMs);
  });

  const thoughtController = new ThoughtBubbleController(wrap, {
    onThinkingStart: (): void => {
      streamStatus.setPhase('thinking');
      setSidebarStreamPhase('thinking', chat.id);
      thinkingTracker.startSegment();
    },
    onReasoningEnded: (): void => {
      thinkingTracker.endSegment();
      streamStatus.setThinkingElapsed(null);
      if (wrap.classList.contains('msg--awaiting-prose')) {
        streamStatus.setPhase('generating');
        setSidebarStreamPhase('generating', chat.id);
      } else {
        setSidebarStreamPhase(null, chat.id);
      }
    },
  });

  setStreaming(true, chat.id);
  if (isStreamDomVisible(chat.id)) {
    setComposerStreamingMode('streaming');
    setStatus('spin', 'Generating reply…');
  } else {
    syncComposerFromStreamingState();
  }

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  const t0 = performance.now();
  let tFirst: number | null = null;
  const streamingStatsPublisher = createStreamingStatsPublisher(chat);
  const inlineRouter = new InlineContentThinkingRouter({
    thinkingModel: modelLikelyUsesInlineThinking(modelId),
  });
  const harmonyRouter = new HarmonyChannelRouter();

  function processRoutedParts(parts: RoutedContentPart[]): void {
    for (const [text, isThinking] of parts) {
      if (text && tFirst == null) tFirst = performance.now();
      if (isThinking) {
        if (text) {
          thoughtController.appendReasoningDelta(text);
        }
        continue;
      }
      if (!text) {
        continue;
      }
      thoughtController.endReasoningPhase();
      revealProse();
      fullText += text;
      if (isStreamDomVisible(chat.id)) {
        scheduleAssistantBubbleRender(bubble, fullText, cursor);
      }
    }
  }

  function routeContentDelta(delta: string): void {
    if (!delta) {
      return;
    }
    for (const [harmonyText, isHarmonyThinking] of harmonyRouter.feed(delta)) {
      if (isHarmonyThinking) {
        if (harmonyText) {
          thoughtController.appendReasoningDelta(harmonyText);
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
          thoughtController.appendReasoningDelta(harmonyText);
        }
        continue;
      }
      processRoutedParts(inlineRouter.feed(harmonyText));
    }
    processRoutedParts(inlineRouter.flush());
  }

  try {
    const provider = await getActiveProvider(chat.providerId);
    chat.providerId = provider.id;
    const res = await postChatCompletions(provider, body, chatSignal);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const sseBuffer = createSseEventBuffer();

    function handleChunk(chunk: ChatCompletionChunk): void {
      streamMeta = mergeStreamMeta(streamMeta, chunk);
      const reasoning = extractReasoningDelta(chunk);
      if (reasoning) {
        if (tFirst == null) tFirst = performance.now();
        thoughtController.appendReasoningDelta(reasoning);
      }
      const contentDelta = extractStreamDelta(chunk);
      if (contentDelta) {
        routeContentDelta(contentDelta);
      }
      // Local llama.cpp streams carry prefill progress and a running token count.
      // Everything else reports neither, and the view collapses to empty.
      const runtime = llamaRuntimeStatusView(streamMeta, tFirst != null);
      if (runtime.phase === 'prompt_processing' && tFirst == null) {
        streamStatus.setPhase('prompt_processing');
      }
      streamStatus.setRuntimeDetail(runtime.detail || null);
      streamingStatsPublisher.schedule({
        streamMeta,
        t0,
        tFirst,
        partialText: fullText,
        partialThinking: thoughtController.getJoinedDisplayText(),
        modelId,
        modelInfo: chat.modelInfo ?? undefined,
      });
      if (isStreamDomVisible(chat.id)) {
        scrollChatIfPinned();
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      feedSseEventBuffer(sseBuffer, decoder.decode(value, { stream: true }), handleChunk);
    }

    flushSseEventBuffer(sseBuffer, handleChunk);

    flushContentRouters();

    thoughtController.endReasoningPhase();

    const split = extractInlineThinkingFromContent(fullText);
    if (split.thinking.length && split.reply.trim()) {
      thoughtController.ingestCompletedReasoning(split.thinking.join('\n\n'));
      fullText = split.reply;
    }

    cancelAssistantBubbleRenderDebounce();
    finishStreamingBubbleRender(bubble, cursor);

    if (!fullText) {
      revealProse();
      const fallback = await tryNonStreamingFallback(
        {
          model: modelId || undefined,
          messages,
          temperature: temp,
          max_tokens: maxTok,
        },
        chatSignal,
        chat.providerId,
      );
      const fbMsg = fallback.choices?.[0]?.message;
      fullText = extractMessageText(fbMsg);
      const fbReason = extractReasoningMessage(fbMsg);
      if (fbReason) {
        thoughtController.ingestCompletedReasoning(fbReason);
      }
      streamMeta = mergeStreamMeta(streamMeta, fallback);
      setAssistantBubbleContent(bubble, fullText || 'The model returned no text.', {
        streaming: false,
        modeId: chat.modeId,
      });
      completeStreamAnnouncer(fullText || 'The model returned no text.');
    } else {
      revealProse();
      setAssistantBubbleContent(bubble, fullText, { streaming: false, modeId: chat.modeId });
      completeStreamAnnouncer(fullText);
    }

    if (fullText) {
      const tEnd = performance.now();
      const meta = finalizeResponseMeta(
        streamMeta,
        t0,
        tFirst ?? tEnd,
        tEnd,
      );
      const resolvedProvider = await getActiveProvider(chat.providerId);
      void recordMainChatTurnUsage(chat, {
        providerId: resolvedProvider.id,
        modelId: streamMeta.model || modelId,
        streamMeta,
        t0,
        tFirst,
        tEnd,
      });
      const modelInfo = resolveModelInfo(streamMeta.model || modelId, meta.model_info);
      const thinkingNorm = thoughtController.getSegmentsNormalized();
      const thinkingDurationMs = thinkingTracker.finalize();
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: fullText,
        stats: meta.stats,
        usage: meta.usage,
      };
      if (thinkingNorm.length > 0) {
        assistantMsg.thinking = thinkingNorm;
        if (thinkingDurationMs > 0) {
          assistantMsg.thinkingDurationMs = thinkingDurationMs;
        }
      }
      chat.history.push(assistantMsg);
      recordAssistantReplyOnChat(chat);
      chat.lastStats = buildLastStatsSnapshot(meta.stats, meta.usage);
      chat.modelInfo = { ...modelInfo };
      chat.modelId = binding.modelId || chat.modelId;
      recordChatMessage(chat);
      appendStats(wrap, meta.stats, meta.usage);
      if (thinkingNorm.length > 0) {
        renderThoughtsToggle(wrap, thinkingNorm, {
          durationMs: thinkingDurationMs > 0 ? thinkingDurationMs : undefined,
        });
        syncThoughtsCaretPulse(thoughtsScopeFromEl(wrap));
      }
      updateStrip(meta.stats, meta.usage, modelInfo);
      setStatus('ok', 'Ready');
      if (shouldScheduleTitle) {
        scheduleChatTitleGeneration(chat.id, text, {
          modelId: modelId || chat.modelId,
          providerId: chat.providerId,
        });
      }
      renderSidebar();
      scheduleSaveSessions();
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e && e.name === 'AbortError') {
      thinkingTracker.abort();
      streamStatus.setThinkingElapsed(null);
      cancelAssistantBubbleRenderDebounce();
      finishStreamingBubbleRender(bubble, cursor);
      thoughtController.abort();

      const text = fullText.trim();
      const thinkingNorm = thoughtController.getSegmentsNormalized();
      if (text && wrap.isConnected) {
        wrap.classList.remove('msg--awaiting-prose');
        bubble.classList.remove('msg-bubble--awaiting');
        setAssistantBubbleContent(bubble, text, { streaming: false, modeId: chat.modeId });
        completeStreamAnnouncer(text);
        markMessageStopped(wrap);
      } else if (wrap.isConnected && wrap.classList.contains('msg--awaiting-prose')) {
        wrap.remove();
      }

      if (text || thinkingNorm.length > 0) {
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: text || thinkingNorm.join('\n\n'),
          stopped: true,
        };
        if (thinkingNorm.length > 0) {
          assistantMsg.thinking = thinkingNorm;
        }
        chat.history.push(assistantMsg);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        scheduleSaveSessions();
      }

      streamStatus.dispose();
      setStatus('ok', 'Stopped');
      return;
    }
    cancelAssistantBubbleRenderDebounce();
    finishStreamingBubbleRender(bubble, cursor);
    revealProse();
    setAssistantErrorBubble(
      bubble,
      `Could not complete this reply: ${formatGenerationErrorMessage(e.message ?? 'Unknown error')}`,
    );
    const msg = e.message ?? '';
    const statusMsg = msg.length > 48 ? `${msg.slice(0, 45)}…` : msg;
    setStatus('err', statusMsg);
    thoughtController.abort();
    thinkingTracker.abort();
  } finally {
    streamingStatsPublisher.reset();
    thoughtController.abort();
    setStreaming(false, chat.id);
    setSidebarStreamPhase(null, chat.id);
    syncChatItemDotsInDom();
    syncComposerFromStreamingState();
    if (getChatAbort(chat.id)?.signal === chatSignal) {
      setChatAbort(chat.id, null);
    }
    if (isStreamDomVisible(chat.id)) {
      scrollChatIfPinned();
    }
  }
}
