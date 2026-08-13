/**
 * Headless LLM driver for benchmark suites (no chat session pollution).
 */

import {
  finalizeResponseMeta,
  finalizeToolCalls,
  extractStreamDelta,
  mergeStreamMeta,
  mergeToolCallDelta,
  tryNonStreamingFallback,
  type ChatCompletionBody,
  type StreamMetaAccumulator,
} from '../api/chat';
import { extractReasoningDelta } from '../api/reasoning.ts';
import { extractInlineThinkingFromContent } from '../api/inline-thinking.ts';
import { ThinkingBudgetTracker } from '../agents/thinking-budget.ts';
import {
  buildBenchmarkCompletionBody,
  BENCHMARK_THINKING_BUDGET_TOKENS,
} from './completion-body.ts';
import { applyBenchmarkSystemPrompt } from './completion-messages.ts';
import {
  BenchmarkStreamContentRouter,
  completionTextFromFallback,
  resolveBenchmarkCompletionText,
} from './stream-text.ts';
import {
  createSseEventBuffer,
  feedSseEventBuffer,
  flushSseEventBuffer,
} from '../api/sse-parse';
import { loadToolCallsMeta, getToolCallsMetaSync } from '../config/tool-calls-meta.ts';
import { postChatCompletions } from '../providers/fetch-chat';
import { readProviderCapabilities } from '../providers/capability-probe.ts';
import {
  isResponseFormatRejectionError,
  stripResponseFormatFromBody,
} from '../providers/constrained-tool-calls.ts';
import { mergeContentJsonToolCalls } from '../providers/constrained-tool-content.ts';
import { resolveSendCapabilities } from '../providers/model-capabilities.ts';
import { getActiveProvider } from '../providers/store';
import type { ApiMessage, ChatCompletionChunk, ToolCall, ToolCallAccumulator } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import type { ExecuteToolContext } from '../tools/client';
import { executeTool } from '../tools/client';
import { runHeadlessToolBatch } from '../tools/headless-tool-batch';
import { assertNotAborted, raceWithAbort } from './abort.ts';
import type { CapabilityRoundTelemetry } from './capabilities/types.ts';
import type { LlmTurnTiming } from './types.ts';

const DEFAULT_MAX_TOOL_ROUNDS = 3;

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
  /** Main assistant `content` only (excludes reasoning-channel fallback). */
  contentText: string;
  /** Reasoning / thinking channel text when the provider emits it. */
  reasoningText: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  timing: LlmTurnTiming;
  messages: ApiMessage[];
  /** True when the client-side thinking budget watchdog cut the stream short. */
  thinkingBudgetExceeded?: boolean;
}

export interface ToolLoopInput extends OneShotInput {
  maxToolRounds?: number;
  modeId?: string;
  /** Per completion round (capability matrix tool-chain probes). */
  onRound?: (round: CapabilityRoundTelemetry) => void;
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

function timingFromStream(
  t0: number,
  tFirst: number | null,
  tEnd: number,
  streamMeta: StreamMetaAccumulator,
  streamChunkCount: number,
): LlmTurnTiming {
  const meta = finalizeResponseMeta(streamMeta, t0, tFirst, tEnd);
  const stats = meta.stats;
  const usage = meta.usage;
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
    streamChunkCount,
  };
}

function capabilityRoundFromToolCalls(
  round: number,
  toolCalls: ToolCall[],
): CapabilityRoundTelemetry {
  return {
    round,
    toolCalls: toolCalls.map((tc) => ({
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
  };
}

interface StreamTurnInput {
  providerId: string;
  modelId: string;
  messages: ApiMessage[];
  signal: AbortSignal;
  tools?: OpenAIFunctionDefinition[];
  maxTokens?: number;
  temperature?: number;
}

interface StreamTurnResult {
  fullText: string;
  contentText: string;
  reasoningText: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  streamMeta: StreamMetaAccumulator;
  timing: LlmTurnTiming;
  thinkingBudgetExceeded?: boolean;
}

/** Stream one completion turn without touching chat history. */
async function streamTurn(input: StreamTurnInput): Promise<StreamTurnResult> {
  const provider = await getActiveProvider(input.providerId);
  await loadToolCallsMeta();
  const providerCapabilities = await readProviderCapabilities(provider.id);
  const toolCallsMeta = getToolCallsMetaSync();
  const capabilities = resolveSendCapabilities(
    input.providerId,
    input.modelId,
    provider.apiKind,
  );

  const { body: initialBody, usedConstrained: initialConstrained, nativeBudgetApplied } =
    buildBenchmarkCompletionBody({
    provider,
    modelId: input.modelId,
    messages: input.messages,
    tools: input.tools,
    capabilities,
    providerCapabilities,
    toolCallsMeta,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
  });

  let thinkingBudgetTracker: ThinkingBudgetTracker | null = null;
  if (BENCHMARK_THINKING_BUDGET_TOKENS > 0 && !nativeBudgetApplied) {
    thinkingBudgetTracker = new ThinkingBudgetTracker(BENCHMARK_THINKING_BUDGET_TOKENS);
  }

  let usedConstrained = initialConstrained;
  let body: ChatCompletionBody & { stream: true; stream_options: { include_usage: boolean } } =
    initialBody;

  const runOnce = (): Promise<StreamTurnResult> =>
    streamTurnWithBody(input, provider, body, thinkingBudgetTracker);

  try {
    return await runOnce();
  } catch (err) {
    if (usedConstrained && isResponseFormatRejectionError(err)) {
      usedConstrained = false;
      body = stripResponseFormatFromBody(body) as typeof body;
      return runOnce();
    }
    throw err;
  }
}

async function streamTurnWithBody(
  input: StreamTurnInput,
  provider: Awaited<ReturnType<typeof getActiveProvider>>,
  body: ChatCompletionBody & { stream: true; stream_options: { include_usage: boolean } },
  thinkingBudgetTracker: ThinkingBudgetTracker | null,
): Promise<StreamTurnResult> {
  const t0 = performance.now();
  let tFirst: number | null = null;

  const turnAbort = new AbortController();
  if (input.signal.aborted) {
    turnAbort.abort();
  } else {
    input.signal.addEventListener('abort', () => turnAbort.abort(), { once: true });
  }

  const res = await postChatCompletions(provider, body, turnAbort.signal);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }
  if (!res.body) {
    throw new Error('No response body');
  }

  const contentRouter = new BenchmarkStreamContentRouter(
    input.modelId,
    thinkingBudgetTracker,
  );
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};
  let streamChunkCount = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sseBuffer = createSseEventBuffer();

  const cancelReader = (): void => {
    void reader.cancel().catch(() => {
      /* stream may already be closed */
    });
  };
  turnAbort.signal.addEventListener('abort', cancelReader, { once: true });

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamChunkCount += 1;
    if (tFirst == null && chunk.choices?.length) {
      const hasDelta =
        chunk.choices[0]?.delta?.content ||
        chunk.choices[0]?.delta?.reasoning_content ||
        chunk.choices[0]?.delta?.tool_calls?.length;
      if (hasDelta) tFirst = performance.now();
    }
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const reasoningDelta = extractReasoningDelta(chunk);
    if (reasoningDelta) {
      contentRouter.ingestReasoningDelta(reasoningDelta);
    }
    const contentDelta = extractStreamDelta(chunk);
    if (contentDelta) {
      contentRouter.ingestContentDelta(contentDelta);
    }
  }

  try {
    while (true) {
      assertNotAborted(input.signal);
      if (contentRouter.thinkingBudgetExceeded) break;
      const { done, value } = await reader.read();
      if (done) break;
      feedSseEventBuffer(sseBuffer, decoder.decode(value, { stream: true }), handleChunk);
      if (contentRouter.thinkingBudgetExceeded) {
        turnAbort.abort();
        break;
      }
    }
    flushSseEventBuffer(sseBuffer, handleChunk);
    contentRouter.flush();
  } catch (err) {
    const e = err as { name?: string };
    if (e?.name !== 'AbortError' || !contentRouter.thinkingBudgetExceeded) {
      throw err;
    }
    flushSseEventBuffer(sseBuffer, handleChunk);
    contentRouter.flush();
  } finally {
    turnAbort.signal.removeEventListener('abort', cancelReader);
  }

  const tEnd = performance.now();
  let contentText = contentRouter.getProseText();
  let reasoningText = contentRouter.getReasoningText();

  const split = extractInlineThinkingFromContent(contentText);
  if (split.thinking.length && split.reply.trim()) {
    reasoningText = [reasoningText, ...split.thinking].filter(Boolean).join('\n\n');
    contentText = split.reply;
  }

  const toolCalls = mergeContentJsonToolCalls(contentText, finalizeToolCalls(toolAcc), {
    harmonyParseText: contentRouter.getCommentaryParseText(),
  });
  const finishReason =
    streamMeta.finish_reason || (toolCalls.length > 0 ? 'tool_calls' : undefined);

  return {
    fullText: resolveBenchmarkCompletionText(contentText, reasoningText),
    contentText,
    reasoningText,
    toolCalls,
    finishReason,
    streamMeta,
    timing: timingFromStream(t0, tFirst, tEnd, streamMeta, streamChunkCount),
    thinkingBudgetExceeded: contentRouter.thinkingBudgetExceeded,
  };
}

async function tryBenchmarkNonStreamingFallback(
  providerId: string,
  body: ChatCompletionBody & { stream: true; stream_options?: { include_usage: boolean } },
  signal: AbortSignal,
): Promise<{ text: string; finishReason?: string; toolCalls?: ToolCall[] }> {
  const { stream: _s, stream_options: _so, ...fallbackBody } = body;
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

async function buildStreamBodyForMessages(
  input: OneShotInput,
  messages: ApiMessage[],
): Promise<ChatCompletionBody & { stream: true; stream_options: { include_usage: boolean } }> {
  const provider = await getActiveProvider(input.providerId);
  await loadToolCallsMeta();
  const providerCapabilities = await readProviderCapabilities(provider.id);
  const capabilities = resolveSendCapabilities(
    input.providerId,
    input.modelId,
    provider.apiKind,
  );
  const { body } = buildBenchmarkCompletionBody({
    provider,
    modelId: input.modelId,
    messages,
    tools: input.tools,
    capabilities,
    providerCapabilities,
    toolCallsMeta: getToolCallsMetaSync(),
    maxTokens: input.maxTokens,
    temperature: input.temperature,
  });
  return body;
}

async function runOneShotInner(input: OneShotInput): Promise<OneShotResult> {
  const messages = applyBenchmarkSystemPrompt([...input.messages]);

  let turn = await streamTurn({
    providerId: input.providerId,
    modelId: input.modelId,
    messages,
    signal: input.signal,
    tools: input.tools,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
  });
  let text = turn.fullText.trim();
  let contentText = turn.contentText.trim();
  let reasoningText = turn.reasoningText.trim();
  let finishReason = turn.finishReason;
  let toolCalls = turn.toolCalls;
  let thinkingBudgetExceeded = turn.thinkingBudgetExceeded;

  if (!text) {
    const fallbackBody = await buildStreamBodyForMessages(input, messages);
    const fb = await tryBenchmarkNonStreamingFallback(
      input.providerId,
      fallbackBody,
      input.signal,
    );
    text = fb.text.trim();
    finishReason = finishReason || fb.finishReason;
    if (fb.toolCalls?.length) toolCalls = fb.toolCalls;
  }

  return {
    text,
    contentText,
    reasoningText,
    toolCalls,
    finishReason,
    timing: turn.timing,
    messages: appendAssistantToMessages(messages, text, toolCalls),
    thinkingBudgetExceeded,
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
  let lastContentText = '';
  let lastReasoningText = '';
  let lastToolCalls: ToolCall[] = [];
  let lastFinish: string | undefined;
  let lastThinkingBudgetExceeded: boolean | undefined;

  for (let round = 0; round < maxRounds; round++) {
    assertNotAborted(input.signal);
    const turn = await streamTurn({
      providerId: input.providerId,
      modelId: input.modelId,
      messages,
      signal: input.signal,
      tools: input.tools,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
    });

    lastTiming = turn.timing;
    lastText = turn.fullText.trim();
    lastContentText = turn.contentText.trim();
    lastReasoningText = turn.reasoningText.trim();
    lastToolCalls = preserveLastToolCalls(lastToolCalls, turn.toolCalls);
    lastFinish = turn.finishReason;
    lastThinkingBudgetExceeded = turn.thinkingBudgetExceeded;
    input.onRound?.(capabilityRoundFromToolCalls(round, turn.toolCalls));

    if (turn.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: turn.fullText || null,
        tool_calls: turn.toolCalls,
      });
      const outcomes = await runHeadlessToolBatch({
        toolCalls: turn.toolCalls,
        signal: input.signal,
        execute: (name, args, ctx) =>
          runExecute(name, args as Record<string, unknown>, {
            toolCallId: ctx.toolCallId,
            modeId: input.modeId,
          }),
      });

      for (const outcome of outcomes) {
        const tc = outcome.toolCall;
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: outcome.parseError ?? outcome.result?.content ?? '',
        });
      }
      continue;
    }

    if (!lastText) {
      const fallbackBody = await buildStreamBodyForMessages(input, messages);
      const fb = await tryBenchmarkNonStreamingFallback(
        input.providerId,
        fallbackBody,
        input.signal,
      );
      lastText = fb.text.trim();
    }

    messages.push({ role: 'assistant', content: lastText });
    break;
  }

  return {
    text: lastText,
    contentText: lastContentText || lastText,
    reasoningText: lastReasoningText,
    toolCalls: lastToolCalls,
    finishReason: lastFinish,
    timing: lastTiming,
    messages,
    thinkingBudgetExceeded: lastThinkingBudgetExceeded,
  };
}

/** Tool loop (max 3 rounds) isolated from session state. */
export async function runToolLoop(input: ToolLoopInput): Promise<OneShotResult> {
  return raceWithAbort(input.signal, runToolLoopInner(input));
}
