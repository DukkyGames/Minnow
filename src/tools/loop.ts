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
  isFirstUserMessagePending,
  scheduleChatTitleGeneration,
} from '../chat/titles/schedule';
import {
  getActiveChat,
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
  ToolCallAccumulator,
} from '../types';
import { setSendLoading } from '../ui/input';
import { refreshExpertSelectDisabled } from '../ui/expert-select';
import { refreshModeSelectorDisabled } from '../ui/mode-selector';
import {
  appendBubble,
  appendStats,
  appendStreamingAssistantRow,
  revealAssistantProseBubble,
} from '../ui/messages';
import { renderThoughtsToggle, ThoughtBubbleController } from '../ui/thought-bubbles';
import { renderToolCall, renderToolResult } from '../ui/tool-messages';
import { renderSidebar } from '../ui/sidebar';
import { postChatCompletions } from '../providers/fetch-chat';
import { getActiveProvider } from '../providers/store';
import { setStatus } from '../ui/status';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';
import { resolveComposedSystemPrompt } from '../chat/prompts/compose-context';
import { normalizeModeId } from '../chat/modes/types';
import {
  detectLocalServer,
  executeTool,
  getEnabledToolDefinitionsForMode,
} from './client';

/** Maximum assistantâ†’tool rounds before aborting with an error. */
export const MAX_TOOL_TURNS = 8;

/** Options for {@link buildApiMessages} when the composer has pending files. */
export interface BuildApiMessagesOptions {
  /** Active model id (used to detect VLM for multimodal user content). */
  modelId?: string;
  /** Raw user text from the composer for the in-flight turn (not history placeholders). */
  pendingUserText?: string;
  /** Pre-composed system prompt (Step 04); overrides legacy sysPrompt when set. */
  composedSystemPrompt?: string;
}

interface ChatCompletionBody {
  model?: string;
  messages: ApiMessage[];
  temperature: number;
  max_tokens: number;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: ReturnType<typeof getEnabledToolDefinitionsForMode>;
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
 * inlined file blocks; history stays string-only with `[image: â€¦]` placeholders.
 */
export function buildApiMessages(
  chat: Chat,
  sysPrompt: string,
  options?: BuildApiMessagesOptions,
): ApiMessage[] {
  const messages: ApiMessage[] = [];
  const systemContent =
    options?.composedSystemPrompt?.trim() || sysPrompt.trim();
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
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
  provider: Awaited<ReturnType<typeof getActiveProvider>>,
  body: ChatCompletionBody,
  bubble: HTMLDivElement,
  cursor: HTMLDivElement,
  signal: AbortSignal,
  thoughtController: ThoughtBubbleController | null,
  onFirstProseDelta?: () => void,
): Promise<StreamTurnResult> {
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
      onFirstProseDelta?.();
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
  await detectLocalServer();

  if (chatFetchAbort) chatFetchAbort.abort();
  const controller = new AbortController();
  setChatFetchAbort(controller);
  const chatSignal = controller.signal;

  chat.modelId = modelId || chat.modelId;
  const historyContent = buildHistoryUserContent(text, validAttachments);
  const titleSeed = text || validAttachments[0]?.name || 'Attachment';
  const shouldScheduleTitle = isFirstUserMessagePending(chat);
  chat.history.push({ role: 'user', content: historyContent });
  if (shouldScheduleTitle) {
    scheduleChatTitleGeneration(chat.id, titleSeed);
  }
  touchChat(chat);
  scheduleSaveSessions();
  renderSidebar();
  appendBubble('user', historyContent);

  input.value = '';
  input.style.height = 'auto';

  setStreaming(true);
  refreshModeSelectorDisabled();
  refreshExpertSelectDisabled();
  setSendLoading(true);
  setStatus('spin', 'Generating reply…');

  let streamRow = appendStreamingAssistantRow();
  let { wrap, bubble, cursor, streamStatus } = streamRow;
  const streamCtx = { wrap, streamStatus };
  let revealProse = (): void =>
    revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);

  let completedNormally = false;
  let lastWrap = wrap;
  let thoughtController: ThoughtBubbleController | null = null;

  const thoughtPhaseCallbacks = {
    onThinkingStart: (): void => {
      streamCtx.streamStatus.setPhase('thinking');
    },
    onReasoningEnded: (): void => {
      if (streamCtx.wrap.classList.contains('msg--awaiting-prose')) {
        streamCtx.streamStatus.setPhase('generating');
      }
    },
  };

  let composedSystemPrompt = '';
  try {
    composedSystemPrompt = await resolveComposedSystemPrompt(chat, {
      userMessagePreview: text,
      routeUserText: text,
    });
  } catch {
    composedSystemPrompt = '';
  }
  const sysPrompt = composedSystemPrompt.trim() || legacySysPrompt;

  try {
    const provider = await getActiveProvider(chat.providerId);
    thoughtController = new ThoughtBubbleController(wrap, thoughtPhaseCallbacks);

    const activeModeId = normalizeModeId(chat.modeId);

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const enabledTools = getEnabledToolDefinitionsForMode(activeModeId);
      const messages = buildApiMessages(chat, sysPrompt, {
        modelId,
        pendingUserText: text,
        composedSystemPrompt: sysPrompt,
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
        provider,
        body,
        bubble,
        cursor,
        chatSignal,
        thoughtController,
        revealProse,
      );

      cancelAssistantBubbleRenderDebounce();
      cursor.remove();

      const finishReason =
        turnResult.finishReason ||
        (turnResult.toolCalls.length > 0 ? 'tool_calls' : undefined);

      if (finishReason === 'tool_calls' && turnResult.toolCalls.length > 0) {
        if (turnResult.fullText) {
          revealProse();
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

        streamRow = appendStreamingAssistantRow();
        ({ wrap, bubble, cursor, streamStatus } = streamRow);
        streamCtx.wrap = wrap;
        streamCtx.streamStatus = streamStatus;
        lastWrap = wrap;
        revealProse = (): void =>
          revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);
        thoughtController.setAssistantWrap(wrap);
        thoughtController.resetStreamPhaseHints();

        setStatus('spin', 'Generating reply…');
        continue;
      }

      let fullText = turnResult.fullText;
      let streamMeta = turnResult.streamMeta;

      if (!fullText) {
        revealProse();
        const fallbackBody: ChatCompletionBody = {
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
          fallbackBody,
          chatSignal,
          chat.providerId,
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
        revealProse();
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
      streamCtx.streamStatus.dispose();
      return;
    }
    cancelAssistantBubbleRenderDebounce();
    if (cursor.parentElement) cursor.remove();
    revealProse();
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
    refreshModeSelectorDisabled();
  refreshExpertSelectDisabled();
    setSendLoading(false);
    if (chatFetchAbort && chatFetchAbort.signal === chatSignal) {
      setChatFetchAbort(null);
    }
    scrollBottom();
  }
}
