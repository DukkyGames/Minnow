import {
  chatFetchAbort,
  setChatFetchAbort,
  setStreaming,
} from '../app-state';
import {
  isActiveChatStreaming,
  isBackgroundStreamBlockingSend,
  isStreamDomVisible,
} from '../chat/streaming-state';
import {
  cancelAssistantBubbleRenderDebounce,
  scheduleAssistantBubbleRender,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import { resolveModelInfo } from './models';
import {
  isFirstUserMessagePending,
  scheduleChatTitleGeneration,
} from '../chat/titles/schedule';
import {
  getActiveChat,
  scheduleSaveSessions,
  recordChatMessage,
} from '../state/sessions';
import { autoResize } from '../ui/input';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import type {
  ApiMessage,
  AssistantMessage,
  ChatCompletionChunk,
  ModelInfo,
  Stats,
  ToolCall,
  ToolCallAccumulator,
  Usage,
} from '../types';
import { formatGenerationErrorMessage } from './generations';
import { markChatStalledForUi } from '../agents/supervisor/state.ts';
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
  appendStats,
  appendStreamingAssistantRow,
  revealAssistantProseBubble,
  setAssistantErrorBubble,
} from '../ui/messages';
import { streamDeltaContentToText } from './message-content.ts';
import { extractReasoningDelta, extractReasoningMessage } from './reasoning';
import { renderThoughtsToggle, ThoughtBubbleController } from '../ui/thought-bubbles';
import { ThinkingDurationTracker } from '../ui/thinking-duration';
import { resolveOutboundSystemMessages } from '../chat/prompts/compose-context';
import {
  recordAssistantReplyOnChat,
  setSidebarStreamPhase,
  syncChatItemDotsInDom,
} from '../ui/chat-item-dot';
import { renderSidebar } from '../ui/sidebar';
import { postChatCompletions } from '../providers/fetch-chat';
import {
  createSseEventBuffer,
  feedSseEventBuffer,
  flushSseEventBuffer,
  parseCompletionResponseBody,
  parseSsePayloads,
} from './sse-parse';
import { setStatus } from '../ui/status';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';

export { parseSsePayloads } from './sse-parse';

/** Accumulated metadata from SSE chunks (stats, usage, model_info). */
export interface StreamMetaAccumulator {
  stats?: Stats;
  usage?: Usage;
  model_info?: ModelInfo;
  model?: string;
  finish_reason?: string;
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

/** Merge stats, usage, model_info, and finish_reason from successive chunks. */
export function mergeStreamMeta(
  acc: StreamMetaAccumulator | null | undefined,
  chunk: ChatCompletionChunk
): StreamMetaAccumulator {
  const next: StreamMetaAccumulator = { ...(acc || {}) };
  if (chunk.stats) next.stats = { ...next.stats, ...chunk.stats };
  if (chunk.usage) next.usage = { ...next.usage, ...chunk.usage };
  if (chunk.model_info) next.model_info = { ...next.model_info, ...chunk.model_info };
  if (chunk.model) next.model = chunk.model;
  const finish = chunk.choices?.[0]?.finish_reason;
  if (finish) next.finish_reason = finish;
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

/**
 * Prefer provider timing when it agrees with usage and browser wall clock; otherwise
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

  const trustServer =
    serverTimingMatchesUsage(serverStats, usage) &&
    serverTimingMatchesClientWallClock(serverStats, clientStats);

  if (trustServer) {
    if (serverStats.time_to_first_token != null) {
      out.time_to_first_token = serverStats.time_to_first_token;
    }
    if (serverStats.generation_time != null) out.generation_time = serverStats.generation_time;
    if (serverStats.tokens_per_second != null) out.tokens_per_second = serverStats.tokens_per_second;
    return out;
  }

  const completion = usage?.completion_tokens;
  const gen = out.generation_time;
  if (completion != null && gen != null && gen > 0) {
    out.tokens_per_second = completion / gen;
  }
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
  const res = await postChatCompletions(provider, { ...body, stream: false }, signal, {
    stream: false,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return parseCompletionResponseBody(text);
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
  const modelId = (document.getElementById('modelSelect') as HTMLSelectElement).value;
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
  if (chatFetchAbort) chatFetchAbort.abort();
  const controller = new AbortController();
  setChatFetchAbort(controller);
  const chatSignal = controller.signal;

  chat.modelId = modelId || chat.modelId;
  const shouldScheduleTitle = isFirstUserMessagePending(chat);
  chat.history.push({ role: 'user', content: text });
  recordChatMessage(chat);
  scheduleSaveSessions();
  renderSidebar();
  appendBubble('user', text);

  input.value = '';
  autoResize(input);

  const outbound = await resolveOutboundSystemMessages(chat, legacySysPrompt, {
    userMessagePreview: text,
    routeUserText: text,
  });

  const messages: ApiMessage[] = [];
  if (outbound.composed) {
    messages.push({ role: 'system', content: outbound.composed });
  }
  if (outbound.userRules) {
    messages.push({ role: 'system', content: outbound.userRules });
  }
  for (const m of chat.history) {
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
    streamStatus.setThinkingElapsed(elapsedMs);
  });

  const thoughtController = new ThoughtBubbleController(wrap, {
    onThinkingStart: (): void => {
      streamStatus.setPhase('thinking');
      setSidebarStreamPhase('thinking');
      thinkingTracker.startSegment();
    },
    onReasoningEnded: (): void => {
      thinkingTracker.endSegment();
      streamStatus.setThinkingElapsed(null);
      if (wrap.classList.contains('msg--awaiting-prose')) {
        streamStatus.setPhase('generating');
        setSidebarStreamPhase('generating');
      } else {
        setSidebarStreamPhase(null);
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

  try {
    const provider = await getActiveProvider(chat.providerId);
    chat.providerId = provider.id;
    if (shouldScheduleTitle) {
      scheduleChatTitleGeneration(chat.id, text, {
        modelId: modelId || chat.modelId,
        providerId: provider.id,
      });
    }
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
        thoughtController.appendReasoningDelta(reasoning);
      }
      const delta = extractStreamDelta(chunk);
      if (delta) {
        thoughtController.endReasoningPhase();
        revealProse();
        if (tFirst == null) tFirst = performance.now();
        fullText += delta;
        if (isStreamDomVisible(chat.id)) {
          scheduleAssistantBubbleRender(bubble, fullText, cursor);
        }
      }
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

    thoughtController.endReasoningPhase();

    cancelAssistantBubbleRenderDebounce();
    cursor.remove();

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
    } else {
      revealProse();
      setAssistantBubbleContent(bubble, fullText, { streaming: false, modeId: chat.modeId });
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
      chat.modelId =
        (document.getElementById('modelSelect') as HTMLSelectElement).value || chat.modelId;
      recordChatMessage(chat);
      appendStats(wrap, meta.stats, meta.usage);
      if (thinkingNorm.length > 0) {
        renderThoughtsToggle(wrap, thinkingNorm, {
          durationMs: thinkingDurationMs > 0 ? thinkingDurationMs : undefined,
        });
      }
      updateStrip(meta.stats, meta.usage, modelInfo);
      setStatus('ok', 'Ready');
      renderSidebar();
      scheduleSaveSessions();
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e && e.name === 'AbortError') {
      thinkingTracker.abort();
      streamStatus.setThinkingElapsed(null);
      cancelAssistantBubbleRenderDebounce();
      if (cursor.parentElement) cursor.remove();
      thoughtController.abort();

      const text = fullText.trim();
      const thinkingNorm = thoughtController.getSegmentsNormalized();
      if (text && wrap.isConnected) {
        wrap.classList.remove('msg--awaiting-prose');
        bubble.classList.remove('msg-bubble--awaiting');
        setAssistantBubbleContent(bubble, text, { streaming: false, modeId: chat.modeId });
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

      if (normalizeModeId(chat.modeId) === 'orchestrate') {
        markChatStalledForUi(chat.id, false);
      }

      streamStatus.dispose();
      setStatus('ok', 'Stopped');
      return;
    }
    cancelAssistantBubbleRenderDebounce();
    cursor.remove();
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
    thoughtController.abort();
    setStreaming(false);
    setSidebarStreamPhase(null);
    syncChatItemDotsInDom();
    syncComposerFromStreamingState();
    if (chatFetchAbort && chatFetchAbort.signal === chatSignal) {
      setChatFetchAbort(null);
    }
    if (isStreamDomVisible(chat.id)) {
      scrollChatIfPinned();
    }
  }
}
