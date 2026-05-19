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
import { scrollBottom } from './input';
import { closeDrawer } from './settings';
import { setStatus } from './status';
import { updateStrip } from './stats';
import { renderSidebar } from './sidebar';
import { renderThoughtsToggle } from './thought-bubbles';
import { renderToolCall, renderToolResult } from './tool-messages';

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
  const area = document.getElementById('chatArea')!;
  area.innerHTML = '';
  if (!chat.history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.id = 'emptyState';
    empty.innerHTML = EMPTY_STATE_HTML;
    area.appendChild(empty);
    return;
  }
  const toolResultMap = new Map<string, string>();
  for (const msg of chat.history) {
    if (msg?.role !== 'tool') continue;
    const toolMsg = msg as ToolResultMessage;
    toolResultMap.set(toolMsg.tool_call_id, toolMsg.content);
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
        const result = toolResultMap.get(tc.id);
        if (result !== undefined) {
          renderToolResult(toolWrap, result);
        }
      }
      continue;
    }

    const text = msg.content ?? '';
    const { wrap } = appendBubble('assistant', text);
    const withThinking = msg as AssistantMessage;
    if (withThinking.thinking && withThinking.thinking.length > 0) {
      renderThoughtsToggle(wrap, withThinking.thinking);
    }
    if (msg.stats || msg.usage) {
      appendStats(wrap, msg.stats || {}, msg.usage || {});
    }
  }
  scrollBottom();
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
  scrollBottom();
  return { wrap, bubble };
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
