/**
 * Shared read-only transcript renderer (messages, tool calls, tool results).
 */

import type { ToolImageAttachment } from '../types';
import { renderToolCall, renderToolResult } from './tool-messages';

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

/** Render API-shaped messages into a scrollable transcript body. */
export function renderTranscriptView(body: HTMLElement, messages: unknown[]): void {
  body.replaceChildren();
  const toolResultMap = new Map<
    string,
    { content: string; attachments?: ToolImageAttachment[] }
  >();

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as Record<string, unknown>;
    if (msg.role === 'tool' && typeof msg.tool_call_id === 'string') {
      const attachments = Array.isArray(msg.attachments)
        ? (msg.attachments as ToolImageAttachment[])
        : undefined;
      toolResultMap.set(msg.tool_call_id, {
        content: String(msg.content ?? ''),
        ...(attachments?.length ? { attachments } : {}),
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
      const row = document.createElement('div');
      row.className = 'transcript-view__user';
      row.textContent =
        typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
      body.appendChild(row);
      continue;
    }
    if (role === 'assistant') {
      const toolCalls = msg.tool_calls;
      const prose =
        msg.content != null && typeof msg.content === 'string'
          ? msg.content.trim()
          : '';
      if (prose) {
        const row = document.createElement('div');
        row.className = 'transcript-view__assistant';
        row.textContent = prose;
        body.appendChild(row);
      }
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
            renderToolResult(wrap, stored.content, stored.attachments, argsObj);
          }
        }
      }
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
