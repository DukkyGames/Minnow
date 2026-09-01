/**
 * Shared read-only transcript renderer (messages, tool calls, tool results).
 */

import { apiMessageContentToText } from '../api/message-content.ts';
import { isHiddenTranscriptUserMessage } from '../chat/hidden-transcript-user-messages.ts';
import type {
  ApiMessageContent,
  CodeChangeStats,
  ContentPart,
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

/** Reasoning channel text stored on an assistant message. */
function assistantTranscriptReasoning(msg: Record<string, unknown>): string {
  if (typeof msg.reasoning === 'string' && msg.reasoning.trim()) {
    return msg.reasoning.trim();
  }
  if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
    return msg.reasoning_content.trim();
  }
  return '';
}

/** Assistant display text from `content` or provider reasoning fields. */
function assistantTranscriptProse(msg: Record<string, unknown>): string {
  const fromContent = apiMessageContentToText(msg.content as ApiMessageContent).trim();
  if (fromContent) return fromContent;
  return assistantTranscriptReasoning(msg);
}

/** Collapsible reasoning block below assistant prose. */
function appendAssistantReasoningBlock(body: HTMLElement, reasoning: string): void {
  const thoughts = document.createElement('details');
  thoughts.className = 'transcript-view__thinking';
  const summary = document.createElement('summary');
  summary.textContent = STREAM_LABEL_THINKING;
  const pre = document.createElement('pre');
  pre.className = 'transcript-view__thinking-body';
  pre.textContent = reasoning;
  thoughts.appendChild(summary);
  thoughts.appendChild(pre);
  body.appendChild(thoughts);
}

/** Render assistant prose (string or multimodal-shaped content). */
function appendAssistantTranscriptRow(body: HTMLElement, msg: Record<string, unknown>): void {
  const prose = apiMessageContentToText(msg.content as ApiMessageContent).trim();
  const reasoning = assistantTranscriptReasoning(msg);

  if (prose) {
    const row = document.createElement('div');
    row.className = 'transcript-view__assistant';
    row.textContent = prose;
    body.appendChild(row);
    if (reasoning && reasoning !== prose) {
      appendAssistantReasoningBlock(body, reasoning);
    }
    return;
  }

  if (reasoning) {
    const row = document.createElement('div');
    row.className = 'transcript-view__assistant';
    row.textContent = reasoning;
    body.appendChild(row);
  }
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

export function appendTranscriptLiveTail(
  body: HTMLElement,
  live: SubAgentTranscriptLive | undefined,
): void {
  body.querySelector('.transcript-view__live-tail')?.remove();
  if (!live?.isLive) return;

  const tail = document.createElement('div');
  tail.className = 'transcript-view__live-tail';

  const phase = live.phase;
  const toolName = live.currentToolName?.trim();

  if (phase === 'thinking') {
    tail.appendChild(createTranscriptStreamStatus('thinking'));
    const reasoning = live.partialReasoning?.trim();
    if (reasoning) {
      const thoughts = document.createElement('details');
      thoughts.className = 'transcript-view__thinking';
      const summary = document.createElement('summary');
      summary.textContent = STREAM_LABEL_THINKING;
      const pre = document.createElement('pre');
      pre.className = 'transcript-view__thinking-body';
      pre.textContent = reasoning;
      thoughts.appendChild(summary);
      thoughts.appendChild(pre);
      tail.appendChild(thoughts);
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

  for (const raw of messages) {
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
      appendAssistantTranscriptRow(body, msg);
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
      const prose = assistantTranscriptProse(msg);
      if (!prose && (!Array.isArray(toolCalls) || toolCalls.length === 0)) {
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

  appendTranscriptLiveTail(body, live);
}
