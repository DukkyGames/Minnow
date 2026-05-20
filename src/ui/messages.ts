import { EMPTY_STATE_HTML } from '../constants';
import { modelCache, streaming } from '../app-state';
import { setAssistantBubbleContent } from '../markdown/renderer';
import {
  getActiveChat,
  touchChat,
  scheduleSaveSessions,
} from '../state/sessions';
import type {
  AssistantToolCallMessage,
  AssistantMessage,
  Chat,
  Message,
  ModelInfo,
  Stats,
  ToolResultMessage,
  Usage,
} from '../types';
import {
  pinChatScroll,
  scrollChatIfPinned,
  scrollChatToBottom,
} from './chat-scroll';
import { closeDrawer } from './settings';
import { setStatus } from './status';
import { updateStrip } from './stats';
import { renderSidebar } from './sidebar';
import { renderThoughtsToggle } from './thought-bubbles';
import { renderToolCall, renderToolResult } from './tool-messages';
import {
  clearSubAgentCardDomRegistry,
  renderPersistedSubAgentCardsForChat,
} from './sub-agent-cards';
import {
  attachStreamStatus,
  type StreamingStatusHandle,
  type StreamPhase,
} from './stream-status';

/** Parse stored tool `arguments` JSON for display in the args <details> block. */
function parseToolArgsForDisplay(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

function isAssistantToolCallMessage(msg: Message): msg is AssistantToolCallMessage {
  return (
    msg.role === 'assistant' &&
    'tool_calls' in msg &&
    Array.isArray((msg as AssistantToolCallMessage).tool_calls) &&
    (msg as AssistantToolCallMessage).tool_calls.length > 0
  );
}

export function resolveModelInfo(
  modelId: string,
  fromResponse: ModelInfo | undefined
): ModelInfo {
  const cached = modelCache.get(modelId);
  const fromCache = cached
    ? {
        arch: cached.arch,
        quant: cached.quantization,
        context_length: cached.max_context_length,
      }
    : {};
  return { ...fromCache, ...(fromResponse || {}) };
}

/** Refresh arch/quant/context on the strip from the model list cache. */
export function showCachedModelInfo(): void {
  const modelId = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  if (!modelId) return;
  updateStrip({}, {}, resolveModelInfo(modelId, undefined));
}

export function renderStatsForChat(chat: Chat): void {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const mid = (sel && sel.value) || chat.modelId || '';
  const ls = chat.lastStats;
  const hasNumeric =
    ls &&
    (ls.tokens_per_second != null ||
      ls.time_to_first_token != null ||
      ls.generation_time != null ||
      ls.total_tokens != null);
  if (hasNumeric) {
    const stats: Stats = {
      tokens_per_second: ls!.tokens_per_second ?? undefined,
      time_to_first_token: ls!.time_to_first_token ?? undefined,
      generation_time: ls!.generation_time ?? undefined,
      stop_reason: ls!.stop_reason ?? undefined,
    };
    const usage: Usage = {
      total_tokens: ls!.total_tokens ?? undefined,
      prompt_tokens: ls!.prompt_tokens ?? undefined,
      completion_tokens: ls!.completion_tokens ?? undefined,
    };
    updateStrip(stats, usage, resolveModelInfo(mid, chat.modelInfo || {}));
  } else {
    updateStrip({}, {}, resolveModelInfo(mid, chat.modelInfo || {}));
  }
}

export function renderChatFromHistory(chat: Chat): void {
  clearSubAgentCardDomRegistry();
  const area = document.getElementById('chatArea')!;
  area.innerHTML = '';
  if (!chat.history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.id = 'emptyState';
    empty.innerHTML = EMPTY_STATE_HTML;
    area.appendChild(empty);
    renderPersistedSubAgentCardsForChat(chat);
    scrollChatToBottom();
    return;
  }
  const toolResultMap = new Map<
    string,
    { content: string; attachments?: ToolResultMessage['attachments'] }
  >();
  for (const msg of chat.history) {
    if (msg?.role !== 'tool') continue;
    const toolMsg = msg as ToolResultMessage;
    toolResultMap.set(toolMsg.tool_call_id, {
      content: toolMsg.content,
      attachments: toolMsg.attachments,
    });
  }

  for (const msg of chat.history) {
    if (!msg || !msg.role) continue;
    if (msg.role === 'tool') continue;

    if (msg.role === 'user') {
      appendBubble('user', msg.content);
      continue;
    }

    if (isAssistantToolCallMessage(msg)) {
      const prose = msg.content != null ? String(msg.content).trim() : '';
      if (prose) {
        const { wrap } = appendBubble('assistant', prose);
        if (msg.stats || msg.usage) {
          appendStats(wrap, msg.stats || {}, msg.usage || {});
        }
      }

      for (const tc of msg.tool_calls) {
        const argsObj = parseToolArgsForDisplay(tc.function.arguments);
        const toolWrap = renderToolCall(tc.function.name, argsObj);
        area.appendChild(toolWrap);
        const stored = toolResultMap.get(tc.id);
        if (stored !== undefined) {
          renderToolResult(toolWrap, stored.content, stored.attachments);
        }
      }
      continue;
    }

    const text = msg.content ?? '';
    const trimmed = text.trim();
    const withThinking = msg as AssistantMessage;
    const hasThinking =
      withThinking.thinking != null && withThinking.thinking.length > 0;
    if (!trimmed && !hasThinking) {
      continue;
    }
    const { wrap } = appendBubble('assistant', trimmed);
    if (withThinking.thinking && withThinking.thinking.length > 0) {
      const durationMs = withThinking.thinkingDurationMs;
      renderThoughtsToggle(wrap, withThinking.thinking, {
        durationMs: durationMs != null && durationMs > 0 ? durationMs : undefined,
      });
    }
    if (withThinking.stopped) {
      markMessageStopped(wrap);
    }
    if (msg.stats || msg.usage) {
      appendStats(wrap, msg.stats || {}, msg.usage || {});
    }
  }
  renderPersistedSubAgentCardsForChat(chat);
  scrollChatToBottom();
}

export function appendBubble(
  role: 'user' | 'assistant',
  content: string
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
  if (role === 'user') {
    scrollChatToBottom();
  } else {
    scrollChatIfPinned();
  }
  return { wrap, bubble };
}

/** DOM row for an in-flight assistant reply (prose bubble hidden until first token). */
export interface StreamingAssistantRow {
  wrap: HTMLDivElement;
  bubble: HTMLDivElement;
  cursor: HTMLDivElement;
  streamStatus: StreamingStatusHandle;
}

/** Update the live stream phase label on an in-flight assistant row. */
export function setStreamingRowPhase(wrap: HTMLElement, phase: StreamPhase): void {
  const phaseAttr = wrap.dataset.streamPhase;
  if (!phaseAttr) return;
  const status = wrap.querySelector('.stream-status');
  if (!status) return;
  const label = status.querySelector('.stream-status__label');
  if (phase === 'prose' || phase === 'done') {
    status.classList.add('hidden');
    status.setAttribute('aria-busy', 'false');
    wrap.dataset.streamPhase = phase;
    return;
  }
  status.classList.remove('hidden');
  status.setAttribute('aria-busy', 'true');
  status.classList.remove('stream-status--generating', 'stream-status--thinking');
  status.classList.add(
    phase === 'thinking' ? 'stream-status--thinking' : 'stream-status--generating',
  );
  if (label) {
    label.textContent =
      phase === 'thinking' ? 'Thinking…' : 'Generating response…';
  }
  wrap.dataset.streamPhase = phase;
}

/**
 * Create an assistant message shell for SSE streaming without showing an empty bubble.
 * Thought bubbles attach to `wrap`; call {@link revealAssistantProseBubble} on first prose delta.
 */
export function appendStreamingAssistantRow(): StreamingAssistantRow {
  const empty = document.getElementById('emptyState');
  if (empty) empty.remove();

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant msg--awaiting-prose';

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'Assistant';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble msg-bubble--awaiting';

  const cursor = document.createElement('div');
  cursor.className = 'cursor cursor--prose';
  cursor.setAttribute('aria-hidden', 'true');

  wrap.appendChild(label);
  const streamStatus = attachStreamStatus(wrap);
  wrap.appendChild(bubble);
  bubble.appendChild(cursor);
  document.getElementById('chatArea')!.appendChild(wrap);
  pinChatScroll();
  scrollChatToBottom();
  return { wrap, bubble, cursor, streamStatus };
}

/** Show the assistant prose bubble once streamed content (or fallback text) is ready. */
export function revealAssistantProseBubble(
  wrap: HTMLElement,
  bubble: HTMLElement,
  streamStatus?: StreamingStatusHandle,
): void {
  wrap.classList.remove('msg--awaiting-prose');
  bubble.classList.remove('msg-bubble--awaiting');
  streamStatus?.setPhase('prose');
}

/** Label a finished assistant row as user-stopped (live stream or history reload). */
export function markMessageStopped(wrap: HTMLElement): void {
  wrap.classList.add('msg--stopped');
  if (wrap.querySelector('.msg-stopped-chip')) return;
  const chip = document.createElement('div');
  chip.className = 'msg-stopped-chip';
  chip.textContent = 'Generation stopped';
  const label = wrap.querySelector('.msg-label');
  if (label?.parentElement === wrap) {
    label.insertAdjacentElement('afterend', chip);
  } else {
    wrap.prepend(chip);
  }
}

/** Add per-turn metric chips under an assistant bubble. */
export function appendStats(
  wrap: HTMLElement,
  stats: Stats | undefined,
  usage: Usage | undefined
): void {
  const s = stats || {};
  const u = usage || {};

  const chips = document.createElement('div');
  chips.className = 'msg-stats';

  const defs: [string, boolean, string][] = [
    ['c', s.tokens_per_second != null, `<span>${s.tokens_per_second?.toFixed(1)}</span> tok/s`],
    ['g', s.time_to_first_token != null, `TTFT <span>${s.time_to_first_token?.toFixed(3)}s</span>`],
    ['y', s.generation_time != null, `gen <span>${s.generation_time?.toFixed(3)}s</span>`],
    ['r', u.total_tokens != null, `<span>${u.total_tokens}</span> tokens`],
  ];

  for (const [cls, show, html] of defs) {
    if (!show) continue;
    const chip = document.createElement('div');
    chip.className = `stat-chip ${cls}`;
    chip.innerHTML = html;
    chips.appendChild(chip);
  }

  if (chips.children.length) wrap.appendChild(chips);
}

/** Clear the active chat's message history (session row remains). */
export function clearChat(): void {
  if (streaming) {
    setStatus('spin', 'Finish the current reply first');
    return;
  }
  if (!confirm('Clear all messages in this chat? The chat stays in your sidebar.')) return;
  const chat = getActiveChat();
  chat.history = [];
  chat.lastStats = null;
  chat.modelInfo = {};
  touchChat(chat);
  renderChatFromHistory(chat);
  renderStatsForChat(chat);
  renderSidebar();
  scheduleSaveSessions();
  closeDrawer();
}
