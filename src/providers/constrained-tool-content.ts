/**
 * Some OpenAI-compatible providers return constrained tool calls as JSON in
 * assistant message text instead of streaming `delta.tool_calls`. Merge that
 * shape into normal `ToolCall[]` so the tool loop can execute tools.
 */

import type { ToolCall } from '../types';

/** Generate stable synthetic ids for tool rows parsed from message content. */
function syntheticToolCallId(index: number): string {
  return `call_content_${index}`;
}

/**
 * Parse `{"tool_calls":[{ "name", "arguments" }|{ "function": { name, arguments }}]}` from
 * assistant `content` when SSE `tool_calls` deltas were empty.
 */
export function tryParseToolCallsFromAssistantContent(text: string): ToolCall[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('"tool_calls"')) {
    return [];
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const rawCalls = (parsed as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) {
    return [];
  }

  const out: ToolCall[] = [];
  for (let i = 0; i < rawCalls.length; i++) {
    const row = rawCalls[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    const rec = row as Record<string, unknown>;
    const fn = rec.function;
    let name = typeof rec.name === 'string' ? rec.name.trim() : '';
    let args: unknown = rec.arguments;
    if (fn && typeof fn === 'object' && !Array.isArray(fn)) {
      const f = fn as Record<string, unknown>;
      if (!name && typeof f.name === 'string') {
        name = f.name.trim();
      }
      if (args === undefined && 'arguments' in f) {
        args = f.arguments;
      }
    }
    if (!name) {
      continue;
    }
    const argStr =
      typeof args === 'string'
        ? args
        : args === undefined
          ? '{}'
          : JSON.stringify(args);
    out.push({
      id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : syntheticToolCallId(i),
      type: 'function',
      function: { name, arguments: argStr },
    });
  }

  return out;
}

/**
 * Prefer streamed `tool_calls`; when empty, recover tool calls embedded in assistant text.
 */
export function mergeContentJsonToolCalls(fullText: string, streamed: ToolCall[]): ToolCall[] {
  if (streamed.length > 0) {
    return streamed;
  }
  return tryParseToolCallsFromAssistantContent(fullText);
}
