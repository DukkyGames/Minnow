import {
  chatFetchAbort,
  setChatFetchAbort,
  setStreaming,
  streaming,
} from '../app-state';
import {
  cancelAssistantBubbleRenderDebounce,
  scheduleAssistantBubbleRender,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import { resolveModelInfo } from './models';
import {
  getActiveChat,
  maybeAutoTitleFromFirstUserMessage,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
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
import { setSendLoading } from '../ui/input';
import {
  appendBubble,
  appendStats,
  appendStreamingAssistantRow,
  revealAssistantProseBubble,
} from '../ui/messages';
import { extractReasoningDelta, extractReasoningMessage } from './reasoning';
import { renderThoughtsToggle, ThoughtBubbleController } from '../ui/thought-bubbles';
import { renderSidebar } from '../ui/sidebar';
import { parseServerBaseUrl, serverUrl, setStatus } from '../ui/status';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';

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
  tools?: OpenAIFunctionDefinition[];
  tool_choice?: 'auto';
}

/** Scroll the message list to the latest content. */
function scrollBottom(): void {
  const area = document.getElementById('chatArea')!;
  area.scrollTop = area.scrollHeight;
}

// â”€â”€ Stream / stats helpers â”€â”€
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
  const delta = choice.delta;
  if (delta?.content) return delta.content;
  if (choice.message?.content) return choice.message.content;
  return '';
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
export function extractMessageText(message: { content?: string } | null | undefined): string {
  if (!message?.content) return '';
  return message.content;
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

/** Parse SSE `data:` lines and invoke onChunk for each JSON payload. */
export function parseSsePayloads(text: string, onChunk: (chunk: ChatCompletionChunk) => void): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') continue;
    try {
      onChunk(JSON.parse(payload) as ChatCompletionChunk);
    } catch {
      /* Ignore malformed SSE lines. */
    }
  }
}

/** Client-side TTFT / generation time / TPS when the server omits stats. */
export function buildClientStats(
  t0: number,
  tFirst: number | null,
  tEnd: number,
  usage: Usage | undefined,
  finishReason: string | undefined
): Stats {
  if (tFirst == null) return {};
  const ttft = (tFirst - t0) / 1000;
  const genTime = Math.max((tEnd - tFirst) / 1000, 0.001);
  const completionTokens = usage?.completion_tokens;
  const tps = completionTokens != null ? completionTokens / genTime : null;
  const stats: Stats = {
    time_to_first_token: ttft,
    generation_time: genTime,
  };
  if (tps != null) stats.tokens_per_second = tps;
  if (finishReason) stats.stop_reason = finishReason;
  return stats;
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
  const stats: Stats = {
    ...clientStats,
    ...serverStats,
  };
  return {
    stats,
    usage,
    model_info: streamMeta.model_info || {},
  };
}

/** Non-streaming fallback when SSE yields no assistant text. */
export async function tryNonStreamingFallback(
  serverBase: string,
  body: ChatCompletionBody,
  signal: AbortSignal
): Promise<ChatCompletionChunk> {
  const res = await fetch(`${serverBase}/api/v0/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ChatCompletionChunk>;
}

/** Send the composer text to LM Studio with SSE streaming and optional JSON fallback. */
export async function sendMessage(): Promise<void> {
  if (streaming) return;
  const input = document.getElementById('msgInput') as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text) return;

  const chat = getActiveChat();
  const modelId = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  const temp = parseFloat((document.getElementById('temperature') as HTMLInputElement).value);
  const maxTok = parseInt((document.getElementById('maxTokens') as HTMLInputElement).value, 10);
  const sysPrompt = (document.getElementById('systemPrompt') as HTMLTextAreaElement).value.trim();

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
  const base = parseServerBaseUrl(serverUrl());
  if (!base) {
    setStatus('err', 'Check server URL in Settings');
    return;
  }

  if (chatFetchAbort) chatFetchAbort.abort();
  const controller = new AbortController();
  setChatFetchAbort(controller);
  const chatSignal = controller.signal;

  chat.modelId = modelId || chat.modelId;
  maybeAutoTitleFromFirstUserMessage(chat, text);
  chat.history.push({ role: 'user', content: text });
  touchChat(chat);
  scheduleSaveSessions();
  renderSidebar();
  appendBubble('user', text);

  input.value = '';
  input.style.height = 'auto';

  const messages: ApiMessage[] = [];
  if (sysPrompt) messages.push({ role: 'system', content: sysPrompt });
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

  const { wrap, bubble, cursor, streamStatus } = appendStreamingAssistantRow();
  const revealProse = (): void => revealAssistantProseBubble(wrap, bubble, streamStatus);

  const thoughtController = new ThoughtBubbleController(wrap, {
    onThinkingStart: (): void => {
      streamStatus.setPhase('thinking');
    },
    onReasoningEnded: (): void => {
      if (wrap.classList.contains('msg--awaiting-prose')) {
        streamStatus.setPhase('generating');
      }
    },
  });

  setStreaming(true);
  setSendLoading(true);
  setStatus('spin', 'Generating reply…');

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  const t0 = performance.now();
  let tFirst: number | null = null;

  try {
    const res = await fetch(`${base}/api/v0/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: chatSignal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
        scheduleAssistantBubbleRender(bubble, fullText, cursor);
      }
      scrollBottom();
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      parseSsePayloads(lines.join('\n'), handleChunk);
    }

    if (buffer.trim()) parseSsePayloads(buffer, handleChunk);

    thoughtController.endReasoningPhase();

    cancelAssistantBubbleRenderDebounce();
    cursor.remove();

    if (!fullText) {
      revealProse();
      const fallback = await tryNonStreamingFallback(
        base,
        {
          model: modelId || undefined,
          messages,
          temperature: temp,
          max_tokens: maxTok,
        },
        chatSignal
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
      });
    } else {
      revealProse();
      setAssistantBubbleContent(bubble, fullText, { streaming: false });
    }

    if (fullText) {
      const meta = finalizeResponseMeta(
        streamMeta,
        t0,
        tFirst ?? performance.now(),
        performance.now()
      );
      const modelInfo = resolveModelInfo(streamMeta.model || modelId, meta.model_info);
      const thinkingNorm = thoughtController.getSegmentsNormalized();
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: fullText,
        stats: meta.stats,
        usage: meta.usage,
      };
      if (thinkingNorm.length > 0) {
        assistantMsg.thinking = thinkingNorm;
      }
      chat.history.push(assistantMsg);
      chat.lastStats = buildLastStatsSnapshot(meta.stats, meta.usage);
      chat.modelInfo = { ...modelInfo };
      chat.modelId =
        (document.getElementById('modelSelect') as HTMLSelectElement).value || chat.modelId;
      touchChat(chat);
      appendStats(wrap, meta.stats, meta.usage);
      if (thinkingNorm.length > 0) {
        renderThoughtsToggle(wrap, thinkingNorm);
      }
      updateStrip(meta.stats, meta.usage, modelInfo);
      setStatus('ok', 'Ready');
      renderSidebar();
      scheduleSaveSessions();
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e && e.name === 'AbortError') {
      thoughtController.abort();
      streamStatus.dispose();
      return;
    }
    cancelAssistantBubbleRenderDebounce();
    cursor.remove();
    revealProse();
    bubble.classList.remove('msg-bubble--md');
    bubble.textContent = `Could not complete this reply: ${e.message ?? 'Unknown error'}`;
    bubble.style.color = 'var(--red)';
    const msg = e.message ?? '';
    const statusMsg = msg.length > 48 ? `${msg.slice(0, 45)}…` : msg;
    setStatus('err', statusMsg);
    thoughtController.abort();
  } finally {
    thoughtController.abort();
    setStreaming(false);
    setSendLoading(false);
    if (chatFetchAbort && chatFetchAbort.signal === chatSignal) {
      setChatFetchAbort(null);
    }
    scrollBottom();
  }
}
