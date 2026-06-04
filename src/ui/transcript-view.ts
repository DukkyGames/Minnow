/**
 * Shared read-only transcript renderer (messages, tool calls, tool results).
 */

import { apiMessageContentToText } from '../api/message-content.ts';
import type {
  ApiMessageContent,
  CodeChangeStats,
  ContentPart,
  ToolImageAttachment,
} from '../types';
import { renderToolCall, renderToolResult } from './tool-messages';

function normalizeTranscriptCodeChange(raw: unknown): CodeChangeStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const additions = Number(row.additions);
  const deletions = Number(row.deletions);
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) return undefined;
  if (additions === 0 && deletions === 0) return undefined;
  const path = typeof row.path === 'string' && row.path.trim() ? row.path.trim() : undefined;
  return { additions, deletions, ...(path ? { path } : {}) };
}

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

/** Assistant display text from `content` or provider reasoning fields. */
function assistantTranscriptProse(msg: Record<string, unknown>): string {
  const fromContent = apiMessageContentToText(msg.content as ApiMessageContent).trim();
  if (fromContent) return fromContent;
  if (typeof msg.reasoning === 'string' && msg.reasoning.trim()) {
    return msg.reasoning.trim();
  }
  if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
    return msg.reasoning_content.trim();
  }
  return '';
}

/** Render assistant prose (string or multimodal-shaped content). */
function appendAssistantTranscriptRow(body: HTMLElement, msg: Record<string, unknown>): void {
  const prose = assistantTranscriptProse(msg);
  if (!prose) return;
  const row = document.createElement('div');
  row.className = 'transcript-view__assistant';
  row.textContent = prose;
  body.appendChild(row);
}

/** Render API-shaped messages into a scrollable transcript body. */
export function renderTranscriptView(body: HTMLElement, messages: unknown[]): void {
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
      const codeChange = normalizeTranscriptCodeChange(msg.codeChange);
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
}
