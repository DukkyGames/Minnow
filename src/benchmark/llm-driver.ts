/**
 * Headless LLM driver for benchmark suites (no chat session pollution).
 */

import {
  buildClientStats,
  extractStreamDelta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
  parseSsePayloads,
  tryNonStreamingFallback,
  type StreamMetaAccumulator,
} from '../api/chat';
import { postChatCompletions } from '../providers/fetch-chat';
import { getActiveProvider } from '../providers/store';
import type { ApiMessage, ChatCompletionChunk, ToolCall, ToolCallAccumulator } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import type { ExecuteToolContext } from '../tools/client';
import { executeTool } from '../tools/client';
import { assertNotAborted } from './abort.ts';
import type { LlmTurnTiming } from './types.ts';

const DEFAULT_MAX_TOOL_ROUNDS = 3;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 2048;

export interface OneShotInput {
  providerId: string;
  modelId: string;
  messages: ApiMessage[];
  signal: AbortSignal;
  tools?: OpenAIFunctionDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface OneShotResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  timing: LlmTurnTiming;
  messages: ApiMessage[];
}

export interface ToolLoopInput extends OneShotInput {
  maxToolRounds?: number;
  modeId?: string;
  executeToolFn?: (
    name: string,
    args: Record<string, unknown>,
    context?: ExecuteToolContext,
  ) => ReturnType<typeof executeTool>;
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

function timingFromStream(
  t0: number,
  tFirst: number | null,
  tEnd: number,
  streamMeta: StreamMetaAccumulator,
): LlmTurnTiming {
  const usage = streamMeta.usage ?? {};
  const serverStats = streamMeta.stats ?? {};
  const clientStats = buildClientStats(t0, tFirst, tEnd, usage, streamMeta.finish_reason);
  const stats = { ...clientStats, ...serverStats };
  const ttftMs =
    stats.time_to_first_token != null ? Math.round(stats.time_to_first_token * 1000) : null;
  const tokPerSec = stats.tokens_per_second ?? null;
  return {
    ttftMs,
    totalMs: Math.round(tEnd - t0),
    tokPerSec,
    usage,
    stats,
    finishReason: streamMeta.finish_reason,
  };
}

/** Stream one completion turn without touching chat history. */
async function streamTurn(
  providerId: string,
  body: {
    model?: string;
    messages: ApiMessage[];
    temperature: number;
    max_tokens: number;
    stream: true;
    tools?: OpenAIFunctionDefinition[];
    tool_choice?: 'auto';
    stream_options?: { include_usage: boolean };
  },
  signal: AbortSignal,
): Promise<{
  fullText: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  streamMeta: StreamMetaAccumulator;
  timing: LlmTurnTiming;
}> {
  const provider = await getActiveProvider(providerId);
  const t0 = performance.now();
  let tFirst: number | null = null;

  const res = await postChatCompletions(
    provider,
    { ...body, stream_options: { include_usage: true } },
    signal,
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }
  if (!res.body) {
    throw new Error('No response body');
  }

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const delta = extractStreamDelta(chunk);
    if (delta) {
      if (tFirst == null) tFirst = performance.now();
      fullText += delta;
    }
  }

  while (true) {
    assertNotAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    parseSsePayloads(lines.join('\n'), handleChunk);
  }
  if (buffer.trim()) parseSsePayloads(buffer, handleChunk);

  const tEnd = performance.now();
  const toolCalls = finalizeToolCalls(toolAcc);
  const finishReason =
    streamMeta.finish_reason ||
    (toolCalls.length > 0 ? 'tool_calls' : undefined);

  return {
    fullText,
    toolCalls,
    finishReason,
    streamMeta,
    timing: timingFromStream(t0, tFirst, tEnd, streamMeta),
  };
}

/** Single-shot completion with timing capture. */
export async function runOneShot(input: OneShotInput): Promise<OneShotResult> {
  const turn = await streamTurn(
    input.providerId,
    {
      model: input.modelId || undefined,
      messages: input.messages,
      temperature: input.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
      ...(input.tools?.length ? { tools: input.tools, tool_choice: 'auto' as const } : {}),
    },
    input.signal,
  );

  return {
    text: turn.fullText.trim(),
    toolCalls: turn.toolCalls,
    finishReason: turn.finishReason,
    timing: turn.timing,
    messages: [...input.messages],
  };
}

/** Tool loop (max 3 rounds) isolated from session state. */
export async function runToolLoop(input: ToolLoopInput): Promise<OneShotResult> {
  const messages: ApiMessage[] = [...input.messages];
  const maxRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const runExecute =
    input.executeToolFn ??
    ((name, args, ctx) => executeTool(name, args, { ...ctx, modeId: input.modeId }));

  let lastTiming: LlmTurnTiming = {
    ttftMs: null,
    totalMs: 0,
    tokPerSec: null,
    usage: {},
    stats: {},
  };
  let lastText = '';
  let lastToolCalls: ToolCall[] = [];
  let lastFinish: string | undefined;

  for (let round = 0; round < maxRounds; round++) {
    assertNotAborted(input.signal);
    const turn = await streamTurn(
      input.providerId,
      {
        model: input.modelId || undefined,
        messages,
        temperature: input.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
        ...(input.tools?.length ? { tools: input.tools, tool_choice: 'auto' as const } : {}),
      },
      input.signal,
    );

    lastTiming = turn.timing;
    lastText = turn.fullText.trim();
    lastToolCalls = turn.toolCalls;
    lastFinish = turn.finishReason;

    if (turn.finishReason === 'tool_calls' && turn.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: turn.fullText || null,
        tool_calls: turn.toolCalls,
      });
      for (const tc of turn.toolCalls) {
        assertNotAborted(input.signal);
        const args = parseToolArguments(tc.function.arguments);
        const out = await runExecute(tc.function.name, args, {
          toolCallId: tc.id,
          modeId: input.modeId,
        });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: out.content,
        });
      }
      continue;
    }

    if (!lastText) {
      const { stream: _s, ...fallbackBody } = {
        model: input.modelId || undefined,
        messages,
        temperature: input.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true as const,
        ...(input.tools?.length ? { tools: input.tools, tool_choice: 'auto' as const } : {}),
      };
      const fallback = await tryNonStreamingFallback(
        fallbackBody,
        input.signal,
        input.providerId,
      );
      lastText = extractStreamDelta(fallback) || fallback.choices?.[0]?.message?.content || '';
    }

    messages.push({ role: 'assistant', content: lastText });
    break;
  }

  return {
    text: lastText,
    toolCalls: lastToolCalls,
    finishReason: lastFinish,
    timing: lastTiming,
    messages,
  };
}
