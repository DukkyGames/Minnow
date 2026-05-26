/**
 * Headless LLM driver for benchmark suites (no chat session pollution).
 */

import {
  buildClientStats,
  reconcileCompletionStats,
  extractStreamDelta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
  tryNonStreamingFallback,
  type StreamMetaAccumulator,
} from '../api/chat';
import { applyBenchmarkSystemPrompt } from './completion-messages.ts';
import {
  BenchmarkStreamReasoningAccumulator,
  BenchmarkStreamTextAccumulator,
  completionTextFromFallback,
  resolveBenchmarkCompletionText,
} from './stream-text.ts';
import {
  createSseEventBuffer,
  feedSseEventBuffer,
  flushSseEventBuffer,
} from '../api/sse-parse';
import { extractReasoningDelta } from '../api/reasoning.ts';
import { postChatCompletions } from '../providers/fetch-chat';
import { getActiveProvider } from '../providers/store';
import type { ApiMessage, ChatCompletionChunk, ToolCall, ToolCallAccumulator } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import type { ExecuteToolContext } from '../tools/client';
import { executeTool } from '../tools/client';
import { assertNotAborted, raceWithAbort } from './abort.ts';
import type { LlmTurnTiming } from './types.ts';

const DEFAULT_MAX_TOOL_ROUNDS = 3;
const DEFAULT_TEMPERATURE = 0.2;

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

/** Retain the last turn that emitted tool calls (final loop turn is often text-only). */
export function preserveLastToolCalls(previous: ToolCall[], turn: ToolCall[]): ToolCall[] {
  return turn.length > 0 ? turn : previous;
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
  const stats = reconcileCompletionStats(clientStats, serverStats, usage);
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
    max_tokens?: number;
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

  const textAcc = new BenchmarkStreamTextAccumulator();
  const reasoningAcc = new BenchmarkStreamReasoningAccumulator();
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sseBuffer = createSseEventBuffer();

  const cancelReader = (): void => {
    void reader.cancel().catch(() => {
      /* stream may already be closed */
    });
  };
  signal.addEventListener('abort', cancelReader, { once: true });

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const beforeText = textAcc.getText().length;
    const beforeReasoning = reasoningAcc.getText().length;
    reasoningAcc.ingestChunk(chunk);
    textAcc.ingestChunk(chunk);
    if (tFirst == null) {
      const firstToken =
        textAcc.getText().length > beforeText ||
        reasoningAcc.getText().length > beforeReasoning ||
        extractStreamDelta(chunk).length > 0 ||
        extractReasoningDelta(chunk).length > 0;
      if (firstToken) tFirst = performance.now();
    }
  }

  try {
    while (true) {
      assertNotAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      feedSseEventBuffer(sseBuffer, decoder.decode(value, { stream: true }), handleChunk);
    }
    flushSseEventBuffer(sseBuffer, handleChunk);
  } finally {
    signal.removeEventListener('abort', cancelReader);
  }

  const tEnd = performance.now();
  const toolCalls = finalizeToolCalls(toolAcc);
  const finishReason =
    streamMeta.finish_reason ||
    (toolCalls.length > 0 ? 'tool_calls' : undefined);

  return {
    fullText: resolveBenchmarkCompletionText(textAcc.getText(), reasoningAcc.getText()),
    toolCalls,
    finishReason,
    streamMeta,
    timing: timingFromStream(t0, tFirst, tEnd, streamMeta),
  };
}

const REASONING_ONLY_RETRY_SYSTEM =
  'Your previous attempt used only the reasoning channel with no main content. ' +
  'Reply again with the final answer in main content only.';

type OneShotStreamBody = {
  model?: string;
  messages: ApiMessage[];
  temperature: number;
  max_tokens?: number;
  stream: true;
  tools?: OpenAIFunctionDefinition[];
  tool_choice?: 'auto';
};

async function tryBenchmarkNonStreamingFallback(
  providerId: string,
  body: OneShotStreamBody,
  signal: AbortSignal,
): Promise<{ text: string; finishReason?: string; toolCalls?: ToolCall[] }> {
  const { stream: _s, ...fallbackBody } = body;
  const fallback = await tryNonStreamingFallback(
    fallbackBody as Parameters<typeof tryNonStreamingFallback>[0],
    signal,
    providerId,
  );
  const fbMessage = fallback.choices?.[0]?.message as
    | { tool_calls?: ToolCall[] }
    | undefined;
  return {
    text: completionTextFromFallback(fallback),
    finishReason: fallback.choices?.[0]?.finish_reason ?? undefined,
    toolCalls: fbMessage?.tool_calls,
  };
}

async function runOneShotInner(input: OneShotInput): Promise<OneShotResult> {
  const messages = applyBenchmarkSystemPrompt([...input.messages]);
  const bodyExtras = input.tools?.length
    ? { tools: input.tools, tool_choice: 'auto' as const }
    : {};

  const streamBodyFor = (msgs: ApiMessage[]): OneShotStreamBody => ({
    model: input.modelId || undefined,
    messages: msgs,
    temperature: input.temperature ?? DEFAULT_TEMPERATURE,
    stream: true,
    ...bodyExtras,
    ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
  });

  let turn = await streamTurn(input.providerId, streamBodyFor(messages), input.signal);
  let text = turn.fullText.trim();
  let finishReason = turn.finishReason;
  let toolCalls = turn.toolCalls;
  let fallbackMessages = messages;

  if (!text) {
    const fb = await tryBenchmarkNonStreamingFallback(
      input.providerId,
      streamBodyFor(messages),
      input.signal,
    );
    text = fb.text.trim();
    finishReason = finishReason || fb.finishReason;
    if (fb.toolCalls?.length) toolCalls = fb.toolCalls;
  }

  const usedReasoningBudget =
    !text && (turn.timing.usage?.completion_tokens ?? 0) > 0;
  if (usedReasoningBudget) {
    fallbackMessages = applyBenchmarkSystemPrompt([...input.messages], {
      extraSystem: REASONING_ONLY_RETRY_SYSTEM,
    });
    turn = await streamTurn(input.providerId, streamBodyFor(fallbackMessages), input.signal);
    text = turn.fullText.trim();
    finishReason = turn.finishReason ?? finishReason;
    toolCalls = turn.toolCalls.length > 0 ? turn.toolCalls : toolCalls;
  }

  if (!text) {
    const fb = await tryBenchmarkNonStreamingFallback(
      input.providerId,
      streamBodyFor(fallbackMessages),
      input.signal,
    );
    text = fb.text.trim();
    finishReason = finishReason || fb.finishReason;
    if (fb.toolCalls?.length) toolCalls = fb.toolCalls;
  }

  return {
    text,
    toolCalls,
    finishReason,
    timing: turn.timing,
    messages: appendAssistantToMessages(messages, text, toolCalls),
  };
}

/** Single-shot completion with timing capture. */
export async function runOneShot(input: OneShotInput): Promise<OneShotResult> {
  return raceWithAbort(input.signal, runOneShotInner(input));
}

/** Append the assistant turn (unit-tested; shared by one-shot completion). */
export function appendAssistantToMessages(
  messages: ApiMessage[],
  text: string,
  toolCalls: ToolCall[],
): ApiMessage[] {
  messages.push({
    role: 'assistant',
    content: text || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  });
  return messages;
}

async function runToolLoopInner(input: ToolLoopInput): Promise<OneShotResult> {
  const messages: ApiMessage[] = applyBenchmarkSystemPrompt([...input.messages]);
  const maxRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const tokenField =
    input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {};
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
        stream: true,
        ...tokenField,
        ...(input.tools?.length ? { tools: input.tools, tool_choice: 'auto' as const } : {}),
      },
      input.signal,
    );

    lastTiming = turn.timing;
    lastText = turn.fullText.trim();
    lastToolCalls = preserveLastToolCalls(lastToolCalls, turn.toolCalls);
    lastFinish = turn.finishReason;

    if (turn.toolCalls.length > 0) {
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
        stream: true as const,
        ...tokenField,
        ...(input.tools?.length ? { tools: input.tools, tool_choice: 'auto' as const } : {}),
      };
      const fallback = await tryNonStreamingFallback(
        fallbackBody as Parameters<typeof tryNonStreamingFallback>[0],
        input.signal,
        input.providerId,
      );
      lastText = completionTextFromFallback(fallback);
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

/** Tool loop (max 3 rounds) isolated from session state. */
export async function runToolLoop(input: ToolLoopInput): Promise<OneShotResult> {
  return raceWithAbort(input.signal, runToolLoopInner(input));
}
