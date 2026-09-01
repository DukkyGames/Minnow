/**
 * Shared read-only transcript renderer (messages, tool calls, tool results).
 * Sub-agent Activity and benchmark drawers share this path; reasoning uses the
 * same Thoughts toggle as main chat (`renderThoughtsToggle`).
 */

import { apiMessageContentToText } from '../api/message-content.ts';
import { isHiddenTranscriptUserMessage } from '../chat/hidden-transcript-user-messages.ts';
import type {
  ApiMessageContent,
  CodeChangeStats,
  ToolImageAttachment,
} from '../types';
import { normalizeCodeChangePayload } from '../usage/code-change-payload';
import { humanizeToolName } from './tool-messages';
import { renderToolCall, renderToolResult } from './tool-messages';
import type { SubAgentTranscriptLive } from './sub-agent-live-status';
import {
  STREAM_LABEL_GENERATING,
  STREAM_LABEL_THINKING,
} from './stream-status';
import { renderThoughtsToggle } from './thought-bubbles';

/** Parse stored tool `arguments` JSON for display. */
export function parseToolArgsForTranscriptDisplay(raw: string): Record<string, unknown> {
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

/** Render multimodal user content (text blocks + inline images). */
function appendUserTranscriptRow(body: HTMLElement, content: ApiMessageContent): void {
  const wrap = document.createElement('div');
  wrap.className = 'transcript-view__user';

  if (typeof content === 'string') {
    wrap.textContent = content;
    body.appendChild(wrap);
    return;
  }

  if (!Array.isArray(content)) {
    wrap.textContent = apiMessageContentToText(content);
    body.appendChild(wrap);
    return;
  }

  for (const part of content) {
    if (part.type === 'text' && part.text) {
      const textEl = document.createElement('p');
      textEl.className = 'transcript-view__user-text';
      textEl.textContent = part.text;
      wrap.appendChild(textEl);
      continue;
    }
    if (part.type === 'image_url' && part.image_url?.url) {
      const img = document.createElement('img');
      img.className = 'transcript-view__user-image';
      img.src = part.image_url.url;
      img.alt = 'Attached image';
      img.loading = 'lazy';
      wrap.appendChild(img);
    }
  }

  if (!wrap.childNodes.length) {
    wrap.textContent = apiMessageContentToText(content);
  }

  body.appendChild(wrap);
}

/** Reasoning channel text stored on an assistant message (wire / hydrate fields). */
function assistantTranscriptReasoning(msg: Record<string, unknown>): string {
  if (typeof msg.reasoning === 'string' && msg.reasoning.trim()) {
    return msg.reasoning.trim();
  }
  if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
    return msg.reasoning_content.trim();
  }
  return '';
}

/**
 * Thinking segments for the Thoughts toggle — main-chat `thinking[]` first,
 * then sub-agent hydrate `reasoning` / `reasoning_content`.
 */
export function assistantTranscriptThinkingSegments(
  msg: Record<string, unknown>,
): string[] {
  if (Array.isArray(msg.thinking)) {
    const fromArray = msg.thinking.filter(
      (s): s is string => typeof s === 'string' && s.trim().length > 0,
    );
    if (fromArray.length > 0) return fromArray;
  }
  const reasoning = assistantTranscriptReasoning(msg);
  return reasoning ? [reasoning] : [];
}

/** Visible assistant prose from `content` only (never the reasoning channel). */
function assistantTranscriptContentProse(msg: Record<string, unknown>): string {
  return apiMessageContentToText(msg.content as ApiMessageContent).trim();
}

/** Options when painting a settled assistant row inside a live run. */
interface AssistantTranscriptPaintOpts {
  /** Pulse the Thoughts caret while this row is the live reasoning turn. */
  liveThinking?: boolean;
  thinkingDurationMs?: number;
}

/**
 * Paint Thoughts (main-chat toggle) then prose. Callers append tool rows after
 * so reasoning stays before tool calls for the turn.
 */
function appendAssistantTranscriptRow(
  body: HTMLElement,
  msg: Record<string, unknown>,
  opts: AssistantTranscriptPaintOpts = {},
): void {
  const prose = assistantTranscriptContentProse(msg);
  const segments = assistantTranscriptThinkingSegments(msg);
  if (!prose && segments.length === 0) return;

  const wrap = document.createElement('div');
  wrap.className = 'transcript-view__assistant-turn';

  // Match main chat: Thoughts above the bubble, then tools (caller) below.
  if (segments.length > 0) {
    renderThoughtsToggle(wrap, segments, {
      pulse: opts.liveThinking === true,
      label: opts.liveThinking === true ? STREAM_LABEL_THINKING : undefined,
      durationMs:
        !opts.liveThinking &&
        opts.thinkingDurationMs != null &&
        opts.thinkingDurationMs > 0
          ? opts.thinkingDurationMs
          : undefined,
    });
  }

  if (prose) {
    const row = document.createElement('div');
    row.className = 'transcript-view__assistant';
    row.textContent = prose;
    wrap.appendChild(row);
  }

  body.appendChild(wrap);
}

/** Build the animated dots + label row used during live sub-agent turns. */
export function createTranscriptStreamStatus(
  phase: 'thinking' | 'generating',
): HTMLElement {
  const statusEl = document.createElement('div');
  statusEl.className = `stream-status stream-status--${phase} transcript-view__stream-status`;
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.setAttribute('aria-busy', 'true');

  const dots = document.createElement('span');
  dots.className = 'stream-status__dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'stream-status__dot';
    dots.appendChild(dot);
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'stream-status__label';
  labelEl.textContent =
    phase === 'thinking' ? STREAM_LABEL_THINKING : STREAM_LABEL_GENERATING;

  statusEl.appendChild(dots);
  statusEl.appendChild(labelEl);
  return statusEl;
}

/** Inline tool-call spinner while a nested tool executes or streams in. */
function createTranscriptToolIndicator(toolName: string): HTMLElement {
  const indicatorEl = document.createElement('div');
  indicatorEl.className = 'tool-start-indicator transcript-view__tool-indicator';
  indicatorEl.setAttribute('role', 'status');
  indicatorEl.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('span');
  spinner.className = 'tool-call-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const labelEl = document.createElement('span');
  labelEl.className = 'tool-start-indicator__label';
  labelEl.textContent = `Calling ${humanizeToolName(toolName)}…`;

  indicatorEl.appendChild(spinner);
  indicatorEl.appendChild(labelEl);
  return indicatorEl;
}

/** Append a throttled generating tail so "Generating response…" is never an empty row. */
function appendGeneratingPartial(tail: HTMLElement, live: SubAgentTranscriptLive): void {
  const partial = live.partialText?.trim();
  if (!partial) return;
  const row = document.createElement('div');
  row.className = 'transcript-view__assistant transcript-view__assistant--partial';
  row.textContent = partial;
  tail.appendChild(row);
}

/** True when any assistant row already carries thinking for the live Thoughts toggle. */
function messagesHaveThinking(messages: unknown[]): boolean {
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as Record<string, unknown>;
    if (msg.role !== 'assistant') continue;
    if (assistantTranscriptThinkingSegments(msg).length > 0) return true;
  }
  return false;
}

export function appendTranscriptLiveTail(
  body: HTMLElement,
  live: SubAgentTranscriptLive | undefined,
  messages: unknown[] = [],
): void {
  body.querySelector('.transcript-view__live-tail')?.remove();
  if (!live?.isLive) return;

  const tail = document.createElement('div');
  tail.className = 'transcript-view__live-tail';

  const phase = live.phase;
  const toolName = live.currentToolName?.trim();

  if (phase === 'thinking') {
    // When thinking events already landed on messages, the assistant row owns
    // the pulsing Thoughts toggle — avoid a second copy in the live tail.
    if (!messagesHaveThinking(messages)) {
      const reasoning = live.partialReasoning?.trim();
      if (reasoning) {
        renderThoughtsToggle(tail, [reasoning], {
          pulse: true,
          label: STREAM_LABEL_THINKING,
        });
      } else {
        tail.appendChild(createTranscriptStreamStatus('thinking'));
      }
    }
  } else if (phase === 'generating') {
    tail.appendChild(createTranscriptStreamStatus('generating'));
    appendGeneratingPartial(tail, live);
  } else if (phase === 'tools' && toolName) {
    tail.appendChild(createTranscriptToolIndicator(toolName));
  } else if (live.isLive) {
    tail.appendChild(createTranscriptStreamStatus('generating'));
    appendGeneratingPartial(tail, live);
  }

  if (tail.childNodes.length > 0) {
    body.appendChild(tail);
  }
}

/** Index of the last assistant row (for live Thinking… pulse on that turn). */
function lastAssistantMessageIndex(messages: unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const raw = messages[i];
    if (!raw || typeof raw !== 'object') continue;
    if ((raw as Record<string, unknown>).role === 'assistant') return i;
  }
  return -1;
}

/** Render API-shaped messages into a scrollable transcript body. */
export function renderTranscriptView(
  body: HTMLElement,
  messages: unknown[],
  live?: SubAgentTranscriptLive,
): void {
  body.replaceChildren();
  const toolResultMap = new Map<
    string,
    {
      content: string;
      attachments?: ToolImageAttachment[];
      codeChange?: CodeChangeStats;
    }
  >();

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as Record<string, unknown>;
    if (msg.role === 'tool' && typeof msg.tool_call_id === 'string') {
      const attachments = Array.isArray(msg.attachments)
        ? (msg.attachments as ToolImageAttachment[])
        : undefined;
      const codeChange = normalizeCodeChangePayload(msg.codeChange);
      toolResultMap.set(msg.tool_call_id, {
        content: String(msg.content ?? ''),
        ...(attachments?.length ? { attachments } : {}),
        ...(codeChange ? { codeChange } : {}),
      });
    }
  }

  const liveThinkingIdx =
    live?.isLive && live.phase === 'thinking' ? lastAssistantMessageIndex(messages) : -1;

  for (let i = 0; i < messages.length; i += 1) {
    const raw = messages[i];
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as Record<string, unknown>;
    const role = msg.role;
    if (role === 'system') {
      const row = document.createElement('div');
      row.className = 'transcript-view__system';
      const full =
        typeof msg.content === 'string' ? msg.content : '[system prompt omitted]';
      row.textContent =
        full.length > 800
          ? `${full.slice(0, 800)}… (${full.length} characters total)`
          : full;
      body.appendChild(row);
      continue;
    }
    if (role === 'user') {
      if (
        typeof msg.content === 'string' &&
        isHiddenTranscriptUserMessage({ role: 'user', content: msg.content })
      ) {
        continue;
      }
      appendUserTranscriptRow(body, msg.content as ApiMessageContent);
      continue;
    }
    if (role === 'assistant') {
      const toolCalls = msg.tool_calls;
      const contentProse = assistantTranscriptContentProse(msg);
      const segments = assistantTranscriptThinkingSegments(msg);
      const durationRaw = msg.thinkingDurationMs;
      const thinkingDurationMs =
        typeof durationRaw === 'number' && Number.isFinite(durationRaw)
          ? durationRaw
          : undefined;

      // Thoughts + prose first, then tool calls — same order as main chat.
      appendAssistantTranscriptRow(body, msg, {
        liveThinking: i === liveThinkingIdx && segments.length > 0,
        thinkingDurationMs,
      });

      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        for (const tc of toolCalls as Array<{
          id: string;
          function: { name: string; arguments: string };
        }>) {
          const argsObj = parseToolArgsForTranscriptDisplay(tc.function.arguments);
          const wrap = renderToolCall(tc.function.name, argsObj);
          body.appendChild(wrap);
          const stored = toolResultMap.get(tc.id);
          if (stored) {
            renderToolResult(
              wrap,
              stored.content,
              stored.attachments,
              argsObj,
              stored.codeChange,
            );
          }
        }
      }
      if (
        !contentProse &&
        segments.length === 0 &&
        (!Array.isArray(toolCalls) || toolCalls.length === 0)
      ) {
        const row = document.createElement('div');
        row.className = 'transcript-view__assistant';
        row.textContent = '(empty assistant message)';
        body.appendChild(row);
      }
      continue;
    }
    if (role === 'tool') {
      continue;
    }
  }

  appendTranscriptLiveTail(body, live, messages);
}
