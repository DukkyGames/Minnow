/**
 * Some OpenAI-compatible providers return constrained tool calls as JSON in
 * assistant message text instead of streaming `delta.tool_calls`. Merge that
 * shape into normal `ToolCall[]` so the tool loop can execute tools.
 */

import type { ToolCall } from '../types';
import { tryParseHarmonyToolCallsFromText } from './harmony-tool-calls';

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

/** True when serialized tool arguments carry no usable fields (e.g. `{}` or blank). */
export function isEmptyToolArgumentsJson(argumentsRaw: string): boolean {
  const trimmed = argumentsRaw.trim();
  if (!trimmed) return true;
  if (trimmed === '{}') return true;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return true;
    }
    return Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}

/** Score parsed tool arguments so partial SSE payloads lose to fuller content JSON. */
export function toolArgumentsRichnessScore(argumentsRaw: string): number {
  const trimmed = argumentsRaw.trim();
  if (!trimmed || trimmed === '{}') return 0;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return trimmed.length;
    }
    const record = parsed as Record<string, unknown>;
    let score = Object.keys(record).length * 100;
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        score += value.length * 10;
      } else if (typeof value === 'string') {
        if (value.startsWith('[') || value.startsWith('{')) {
          score += Math.min(value.length, 500);
        } else {
          score += Math.min(value.length, 50);
        }
      }
    }
    return score + Math.min(trimmed.length, 1000);
  } catch {
    return trimmed.length;
  }
}

function pickRicherToolArguments(streamedRaw: string, contentRaw: string): string {
  const streamEmpty = isEmptyToolArgumentsJson(streamedRaw);
  const contentEmpty = isEmptyToolArgumentsJson(contentRaw);
  if (streamEmpty && !contentEmpty) return contentRaw;
  if (contentEmpty && !streamEmpty) return streamedRaw;
  if (streamEmpty && contentEmpty) return streamedRaw;

  const streamScore = toolArgumentsRichnessScore(streamedRaw);
  const contentScore = toolArgumentsRichnessScore(contentRaw);
  if (contentScore > streamScore) return contentRaw;
  if (streamScore > contentScore) return streamedRaw;
  return streamedRaw;
}

function mergeStreamedWithContentToolCalls(
  streamed: ToolCall[],
  fromContent: ToolCall[],
): ToolCall[] {
  if (fromContent.length === 0) {
    return streamed;
  }

  return streamed.map((tc, index) => {
    const byName = fromContent.find((c) => c.function.name === tc.function.name);
    const contentMatch = byName ?? fromContent[index];
    if (!contentMatch) {
      return tc;
    }
    const argumentsJson = pickRicherToolArguments(
      tc.function.arguments,
      contentMatch.function.arguments,
    );
    if (argumentsJson === tc.function.arguments) {
      return tc;
    }
    return {
      ...tc,
      function: {
        ...tc.function,
        arguments: argumentsJson,
      },
    };
  });
}

/**
 * Prefer streamed `tool_calls`; when empty, recover tool calls embedded in assistant text.
 * When both exist (common with constrained decoding), keep streamed ids but prefer
 * non-empty `arguments` from assistant JSON when SSE only delivered `{}`.
 * Harmony / gpt-oss commentary-channel payloads are parsed when SSE `tool_calls` are empty.
 */
export function mergeContentJsonToolCalls(
  fullText: string,
  streamed: ToolCall[],
  options?: { harmonyParseText?: string },
): ToolCall[] {
  const harmonyHaystack = [options?.harmonyParseText, fullText]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n');
  const fromHarmony = tryParseHarmonyToolCallsFromText(harmonyHaystack);
  const fromContent = tryParseToolCallsFromAssistantContent(fullText);

  if (streamed.length === 0) {
    if (fromHarmony.length > 0) {
      return fromHarmony;
    }
    return fromContent;
  }

  const contentFallback = fromHarmony.length > 0 ? fromHarmony : fromContent;
  return mergeStreamedWithContentToolCalls(streamed, contentFallback);
}
