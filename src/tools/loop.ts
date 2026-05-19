/**
 * Tool-aware chat send path (SA-7): streams completions, runs tool_calls loop,
 * and persists assistant / tool messages in session history.
 */

import {
  chatFetchAbort,
  modelCache,
  setChatFetchAbort,
  setStreaming,
  streaming,
} from '../app-state';
import {
  clearAttachments,
  getPendingAttachments,
} from '../attachments/store';
import type { Attachment } from '../attachments/types';
import {
  extractMessageText,
  extractStreamDelta,
  finalizeResponseMeta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
  parseSsePayloads,
  tryNonStreamingFallback,
  type StreamMetaAccumulator,
} from '../api/chat';
import { extractReasoningDelta, extractReasoningMessage } from '../api/reasoning';
import { resolveModelInfo } from '../api/models';
import {
  cancelAssistantBubbleRenderDebounce,
  scheduleAssistantBubbleRender,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import {
  getActiveChat,
  maybeAutoTitleFromFirstUserMessage,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type {
  ApiMessage,
  ApiMessageContent,
  AssistantMessage,
  AssistantToolCallMessage,
  Chat,
  ChatCompletionChunk,
  ContentPart,
  Message,
  Stats,
  ToolCallAccumulator,
  Usage,
} from '../types';
import { setSendLoading } from '../ui/input';
import { renderThoughtsToggle, ThoughtBubbleController } from '../ui/thought-bubbles';
import { renderToolCall, renderToolResult } from '../ui/tool-messages';
import { renderSidebar } from '../ui/sidebar';
import { parseServerBaseUrl, serverUrl, setStatus } from '../ui/status';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';
import { detectLocalServer, executeTool, getEnabledToolDefinitions } from './client';

/** Maximum assistant→tool rounds before aborting with an error. */
export const MAX_TOOL_TURNS = 8;

/** Options for {@link buildApiMessages} when the composer has pending files. */
export interface BuildApiMessagesOptions {
  /** Active model id (used to detect VLM for multimodal user content). */
  modelId?: string;
  /** Raw user text from the composer for the in-flight turn (not history placeholders). */
  pendingUserText?: string;
}

interface ChatCompletionBody {
  model?: string;
  messages: ApiMessage[];
  temperature: number;
  max_tokens: number;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: ReturnType<typeof getEnabledToolDefinitions>;
  tool_choice?: 'auto';
}

/** History placeholder for an image attachment (persisted in UserMessage.content). */
function imageHistoryPlaceholder(name: string): string {
  return `[image: ${name}]`;
}

/** Inline file block for text/PDF content in string user messages. */
function fileContentBlock(name: string, body: string): string {
  const safeName = name.replace(/"/g, "'");
  return `<file name="${safeName}">\n${body}\n</file>`;
}

/** User-visible / persisted content: text, file blocks, and image placeholders. */
export function buildHistoryUserContent(
  userText: string,
  attachments: Attachment[],
): string {
  const parts: string[] = [];
  const trimmed = userText.trim();
  if (trimmed) parts.push(trimmed);

  for (const att of attachments) {
    if (att.kind === 'error') continue;
    if (att.kind === 'image') {
      parts.push(imageHistoryPlaceholder(att.name));
      continue;
    }
    if ((att.kind === 'text' || att.kind === 'pdf') && att.text) {
      parts.push(fileContentBlock(att.name, att.text));
    }
  }

  return parts.join('\n\n');
}

/** Non-VLM API payload: one string with text, file blocks, and image placeholders. */
function buildStringUserApiContent(
  userText: string,
  attachments: Attachment[],
): string {
  return buildHistoryUserContent(userText, attachments);
}

/** VLM API payload: text part plus image_url parts (no image placeholders in text). */
function buildVlmUserApiContent(
  userText: string,
  attachments: Attachment[],
): ContentPart[] {
  const textParts: string[] = [];
  const trimmed = userText.trim();
  if (trimmed) textParts.push(trimmed);

  for (const att of attachments) {
    if (att.kind === 'error' || att.kind === 'image') continue;
    if ((att.kind === 'text' || att.kind === 'pdf') && att.text) {
      textParts.push(fileContentBlock(att.name, att.text));
    }
  }

  const parts: ContentPart[] = [];
  const combinedText = textParts.join('\n\n');
  if (combinedText) {
    parts.push({ type: 'text', text: combinedText });
  }

  for (const att of attachments) {
    if (att.kind === 'image' && att.dataUrl) {
      parts.push({
        type: 'image_url',
        image_url: { url: att.dataUrl, detail: 'auto' },
      });
    }
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: trimmed || '' });
  }

  return parts;
}

function isVlmModel(modelId: string | undefined): boolean {
  if (!modelId) return false;
  return modelCache.get(modelId)?.type === 'vlm';
}

function indexOfLastUserMessage(history: Message[]): number {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'user') return i;
  }
  return -1;
}

/**
 * Serialize session history for LM Studio, including tool_calls and tool results.
 * Pending attachments on the last user turn become multimodal API content (VLM) or
 * inlined file blocks; history stays string-only with `[image: …]` placeholders.
 */
export function buildApiMessages(
  chat: Chat,
  sysPrompt: string,
  options?: BuildApiMessagesOptions,
): ApiMessage[] {
  const messages: ApiMessage[] = [];
  if (sysPrompt.trim()) {
    messages.push({ role: 'system', content: sysPrompt.trim() });
  }

  const pending = getPendingAttachments().filter((a) => a.kind !== 'error');
  const lastUserIdx = indexOfLastUserMessage(chat.history);
  const modelId = options?.modelId;
  const vlm = isVlmModel(modelId);

  for (let i = 0; i < chat.history.length; i += 1) {
    const m = chat.history[i];
    if (m.role === 'user') {
      const isLastUser = i === lastUserIdx;
      if (isLastUser && pending.length > 0) {
        const userText = options?.pendingUserText ?? m.content;
        const content: ApiMessageContent = vlm
          ? buildVlmUserApiContent(userText, pending)
          : buildStringUserApiContent(userText, pending);
        messages.push({ role: 'user', content });
      } else {
        messages.push({ role: 'user', content: m.content });
      }
      continue;
    }

    if (m.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: m.content,
      });
      continue;
    }

    if (m.role === 'assistant') {
      const withTools = m as AssistantToolCallMessage;
      if (withTools.tool_calls?.length) {
        messages.push({
          role: 'assistant',
          content: withTools.content ?? null,
          tool_calls: withTools.tool_calls,
        });
      } else {
        messages.push({ role: 'assistant', content: m.content });
      }
    }
  }

  return messages;
}

/** Scroll the message list to the latest content. */
function scrollBottom(): void {
  const area = document.getElementById('chatArea')!;
  area.scrollTop = area.scrollHeight;
}

/** Append a user or assistant bubble to the chat area. */
function appendBubble(
  role: 'user' | 'assistant',
  content: string,
): { wrap: HTMLDivElement; bubble: HTMLDivElement } {
  const empty = document.getElementById('emptyState');
  if (empty) empty.remove();

  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = role === 'user' ? 'You' : 'Assistant';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (role === 'assistant') {
    setAssistantBubbleContent(bubble, content, { streaming: false });
  } else {
    bubble.textContent = content;
  }

  wrap.appendChild(label);
  wrap.appendChild(bubble);
  document.getElementById('chatArea')!.appendChild(wrap);
  scrollBottom();
  return { wrap, bubble };
}

/** Add inference metric chips under an assistant message row. */
function appendStats(
  wrap: HTMLElement,
  stats: Stats | undefined,
  usage: Usage | undefined,
): void {
  const s = stats || {};
  const u = usage || {};

  const chips = document.createElement('div');
  chips.className = 'msg-stats';

  const defs: Array<[string, boolean, string]> = [
    ['c', s.tokens_per_second != null, `<span>${s.tokens_per_second?.toFixed(1)}</span> tok/s`],
    [
      'g',
      s.time_to_first_token != null,
      `TTFT <span>${s.time_to_first_token?.toFixed(3)}s</span>`,
    ],
    ['y', s.generation_time != null, `gen <span>${s.generation_time?.toFixed(3)}s</span>`],
    ['r', u.total_tokens != null, `<span>${u.total_tokens}</span> tokens`],
  ];

  defs.forEach(([cls, show, html]) => {
    if (!show) return;
    const chip = document.createElement('div');
    chip.className = `stat-chip ${cls}`;
    chip.innerHTML = html;
    chips.appendChild(chip);
  });

  if (chips.children.length) wrap.appendChild(chips);
}

/** Parse tool arguments JSON from the model; fall back to empty object. */
function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

interface StreamTurnResult {
  fullText: string;
  streamMeta: StreamMetaAccumulator;
  t0: number;
  tFirst: number | null;
  tEnd: number;
  finishReason: string | undefined;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
}

/**
 * Stream one completion request; accumulate text, tool_call deltas, and usage meta.
 */
async function streamCompletionTurn(
  base: string,
  body: ChatCompletionBody,
  bubble: HTMLDivElement,
  cursor: HTMLDivElement,
  signal: AbortSignal,
  thoughtController: ThoughtBubbleController | null,
): Promise<StreamTurnResult> {
  const res = await fetch(`${base}/api/v0/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

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
  let buffer = '';

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const reasoning = extractReasoningDelta(chunk);
    if (reasoning) {
      thoughtController?.appendReasoningDelta(reasoning);
    }
    const delta = extractStreamDelta(chunk);
    if (delta) {
      thoughtController?.endReasoningPhase();
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

  // Flush any trailing reasoning when the stream ends (e.g. tool_calls with no prose yet).
  thoughtController?.endReasoningPhase();

  const tEnd = performance.now();
  const finishReason = streamMeta.finish_reason;
  const toolCalls = finalizeToolCalls(toolAcc);

  return {
    fullText,
    streamMeta,
    t0,
    tFirst,
    tEnd,
    finishReason,
    toolCalls,
  };
}

/** Send the composer text with tool calling (SSE loop, max {@link MAX_TOOL_TURNS} rounds). */
export async function sendMessageWithTools(): Promise<void> {
  if (streaming) return;
  const input = document.getElementById('msgInput') as HTMLTextAreaElement;
  const text = input.value.trim();
  const pending = getPendingAttachments();
  const validAttachments = pending.filter((a) => a.kind !== 'error');
  if (!text && validAttachments.length === 0) return;

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

  await detectLocalServer();

  if (chatFetchAbort) chatFetchAbort.abort();
  const controller = new AbortController();
  setChatFetchAbort(controller);
  const chatSignal = controller.signal;

  chat.modelId = modelId || chat.modelId;
  const historyContent = buildHistoryUserContent(text, validAttachments);
  const titleSeed = text || validAttachments[0]?.name || 'Attachment';
  maybeAutoTitleFromFirstUserMessage(chat, titleSeed);
  chat.history.push({ role: 'user', content: historyContent });
  touchChat(chat);
  scheduleSaveSessions();
  renderSidebar();
  appendBubble('user', historyContent);

  input.value = '';
  input.style.height = 'auto';

  setStreaming(true);
  setSendLoading(true);
  setStatus('spin', 'Generating reply…');

  let { wrap, bubble } = appendBubble('assistant', '');
  let cursor = document.createElement('div');
  cursor.className = 'cursor';
  bubble.appendChild(cursor);

  let completedNormally = false;
  let lastWrap = wrap;
  let thoughtController: ThoughtBubbleController | null = null;

  try {
    thoughtController = new ThoughtBubbleController(wrap);

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const enabledTools = getEnabledToolDefinitions();
      const messages = buildApiMessages(chat, sysPrompt, {
        modelId,
        pendingUserText: text,
      });
      const body: ChatCompletionBody = {
        model: modelId || undefined,
        messages,
        temperature: temp,
        max_tokens: maxTok,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (enabledTools.length > 0) {
        body.tools = enabledTools;
        body.tool_choice = 'auto';
      }

      thoughtController.setAssistantWrap(wrap);
      const turnResult = await streamCompletionTurn(
        base,
        body,
        bubble,
        cursor,
        chatSignal,
        thoughtController,
      );

      cancelAssistantBubbleRenderDebounce();
      cursor.remove();

      const finishReason =
        turnResult.finishReason ||
        (turnResult.toolCalls.length > 0 ? 'tool_calls' : undefined);

      if (finishReason === 'tool_calls' && turnResult.toolCalls.length > 0) {
        if (turnResult.fullText) {
          setAssistantBubbleContent(bubble, turnResult.fullText, { streaming: false });
        } else {
          wrap.remove();
        }

        const assistantToolMsg: AssistantToolCallMessage = {
          role: 'assistant',
          content: turnResult.fullText || null,
          tool_calls: turnResult.toolCalls,
        };
        chat.history.push(assistantToolMsg);
        touchChat(chat);
        scheduleSaveSessions();

        setStatus('spin', 'Running tools…');

        const area = document.getElementById('chatArea')!;
        for (const tc of turnResult.toolCalls) {
          const args = parseToolArguments(tc.function.arguments);
          const toolWrap = renderToolCall(tc.function.name, args);
          area.appendChild(toolWrap);
          scrollBottom();

          const result = await executeTool(tc.function.name, args);
          renderToolResult(toolWrap, result);

          chat.history.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
          scrollBottom();
        }

        touchChat(chat);
        scheduleSaveSessions();
        renderSidebar();

        if (turn + 1 >= MAX_TOOL_TURNS) {
          setStatus('err', 'Maximum tool turns reached');
          break;
        }

        const next = appendBubble('assistant', '');
        wrap = next.wrap;
        bubble = next.bubble;
        lastWrap = wrap;
        cursor = document.createElement('div');
        cursor.className = 'cursor';
        bubble.appendChild(cursor);

        setStatus('spin', 'Generating reply…');
        continue;
      }

      let fullText = turnResult.fullText;
      let streamMeta = turnResult.streamMeta;

      if (!fullText) {
        setAssistantBubbleContent(bubble, '', { streaming: false });
        const fallbackBody: Parameters<typeof tryNonStreamingFallback>[1] = {
          model: modelId || undefined,
          messages,
          temperature: temp,
          max_tokens: maxTok,
        };
        if (enabledTools.length > 0) {
          fallbackBody.tools = enabledTools;
          fallbackBody.tool_choice = 'auto';
        }
        const fallback = await tryNonStreamingFallback(
          base,
          fallbackBody,
          chatSignal,
        );
        const fbMsg = fallback.choices?.[0]?.message;
        fullText = extractMessageText(fbMsg);
        const fbReason = extractReasoningMessage(fbMsg);
        if (fbReason) {
          thoughtController?.ingestCompletedReasoning(fbReason);
        }
        streamMeta = mergeStreamMeta(streamMeta, fallback);
        setAssistantBubbleContent(bubble, fullText || 'The model returned no text.', {
          streaming: false,
        });
      } else {
        setAssistantBubbleContent(bubble, fullText, { streaming: false });
      }

      if (fullText) {
        const meta = finalizeResponseMeta(
          streamMeta,
          turnResult.t0,
          turnResult.tFirst ?? turnResult.tEnd,
          turnResult.tEnd,
        );
        const modelInfo = resolveModelInfo(streamMeta.model || modelId, meta.model_info);
        const thinkingNorm = thoughtController?.getSegmentsNormalized() ?? [];
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
        appendStats(lastWrap, meta.stats, meta.usage);
        if (thinkingNorm.length > 0) {
          renderThoughtsToggle(lastWrap, thinkingNorm);
        }
        updateStrip(meta.stats, meta.usage, modelInfo);
        setStatus('ok', 'Ready');
        renderSidebar();
        scheduleSaveSessions();
      }

      completedNormally = true;
      break;
    }

    if (!completedNormally) {
      const attachHint =
        getPendingAttachments().length > 0 ? ' Attachments kept for retry.' : '';
      setStatus('err', `Maximum tool turns reached.${attachHint}`);
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e && e.name === 'AbortError') {
      thoughtController?.abort();
      return;
    }
    cancelAssistantBubbleRenderDebounce();
    if (cursor.parentElement) cursor.remove();
    bubble.classList.remove('msg-bubble--md');
    bubble.textContent = `Could not complete this reply: ${e.message ?? 'Unknown error'}`;
    bubble.style.color = 'var(--red)';
    const msg = e.message ?? '';
    const statusMsg = msg.length > 48 ? `${msg.slice(0, 45)}…` : msg;
    const attachHint =
      getPendingAttachments().length > 0 ? ' Attachments kept for retry.' : '';
    setStatus('err', statusMsg + attachHint);
  } finally {
    thoughtController?.abort();
    if (completedNormally) {
      // Clear-on-success-only: retain chips after abort, errors, or max tool turns for retry.
      clearAttachments();
    }
    setStreaming(false);
    setSendLoading(false);
    if (chatFetchAbort && chatFetchAbort.signal === chatSignal) {
      setChatFetchAbort(null);
    }
    scrollBottom();
  }
}
