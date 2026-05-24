/**
 * Isolated sub-agent completion + tool loop (no parent chat history).
 */

import {
  extractMessageText,
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
import { averageStatsSegments, sumUsageSegments } from '../chat/orchestrate/stats-math';
import type { ApiMessage, ChatCompletionChunk, Stats, ToolCallAccumulator, Usage } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import { looksLikeProseStructuredQuestion } from '../tools/prose-question-detect';
import {
  MAX_PROSE_QUESTION_RETRIES,
  PROSE_QUESTION_RETRY_INSTRUCTION,
} from '../tools/turn-continuation';
import type { SubAgentRunner, SubAgentRunnerOutput } from './types';

/** Legacy export: prefer per-type `maxToolTurns` from sub-agents config. */
export const MAX_SUB_AGENT_TOOL_TURNS = 12;

/** Throttle live transcript pushes so the drawer can keep up while streaming. */
const LIVE_TRANSCRIPT_EMIT_MS = 80;

/** Deep-clone messages for orchestrator state + UI subscribers. */
export function cloneSubAgentMessages(messages: ApiMessage[]): ApiMessage[] {
  return JSON.parse(JSON.stringify(messages)) as ApiMessage[];
}

interface SubAgentCompletionBody {
  model?: string;
  messages: ApiMessage[];
  temperature: number;
  max_tokens: number;
  stream?: boolean;
  tools?: OpenAIFunctionDefinition[];
  tool_choice?: 'auto';
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

/** Headless SSE turn (no DOM). */
async function streamSubAgentTurn(
  providerId: string,
  body: SubAgentCompletionBody,
  signal: AbortSignal,
  onDelta?: (delta: string) => void,
): Promise<{
  fullText: string;
  finishReason: string | undefined;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
  streamMeta: StreamMetaAccumulator;
}> {
  const provider = await getActiveProvider(providerId);
  const res = await postChatCompletions(provider, body, signal);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const delta = extractStreamDelta(chunk);
    if (delta) {
      fullText += delta;
      onDelta?.(delta);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    parseSsePayloads(lines.join('\n'), handleChunk);
  }

  if (buffer.trim()) parseSsePayloads(buffer, handleChunk);

  const finishReason =
    streamMeta.finish_reason ||
    (Object.keys(toolAcc).length > 0 ? 'tool_calls' : undefined);

  return {
    fullText,
    finishReason,
    toolCalls: finalizeToolCalls(toolAcc),
    streamMeta,
  };
}

/** Default runner: LM Studio stream + nested tools. */
export const defaultSubAgentRunner: SubAgentRunner = {
  async run(input): Promise<SubAgentRunnerOutput> {
    const messages: ApiMessage[] = [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.task },
    ];

    let toolTurns = 0;
    let proseQuestionRetries = 0;
    const hasAskQuestionTool = input.tools.some((t) => t.function.name === 'ask_question');
    const temperature = 0.4;
    const maxTokens = 2048;
    const maxToolTurns = Math.max(1, Math.floor(input.maxToolTurns) || MAX_SUB_AGENT_TOOL_TURNS);
    let lastProgressEmit = 0;
    const usageSegments: Usage[] = [];
    const statsSegments: Array<{ stats: Stats; usage: Usage }> = [];

    const emitProgress = (partialAssistant?: string, force = false): void => {
      if (!input.onMessagesChange) return;
      const now = Date.now();
      if (!force && now - lastProgressEmit < LIVE_TRANSCRIPT_EMIT_MS) return;
      lastProgressEmit = now;
      const snapshot = cloneSubAgentMessages(messages);
      if (partialAssistant) {
        snapshot.push({ role: 'assistant', content: partialAssistant });
      }
      input.onMessagesChange(snapshot);
    };

    emitProgress(undefined, true);

    for (let turn = 0; turn < maxToolTurns; turn++) {
      const body: SubAgentCompletionBody = {
        model: input.modelId || undefined,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      };

      if (input.tools.length > 0) {
        body.tools = input.tools;
        body.tool_choice = 'auto';
      }

      let streamingAssistant = '';
      const turnResult = await streamSubAgentTurn(
        input.providerId,
        body,
        input.signal,
        (delta) => {
          streamingAssistant += delta;
          emitProgress(streamingAssistant);
        },
      );

      const turnUsage = turnResult.streamMeta.usage ?? {};
      const turnStats = turnResult.streamMeta.stats ?? {};
      if (Object.keys(turnUsage).length > 0) {
        usageSegments.push(turnUsage);
      }
      if (Object.keys(turnStats).length > 0 || Object.keys(turnUsage).length > 0) {
        statsSegments.push({ stats: turnStats, usage: turnUsage });
      }

      if (
        turnResult.finishReason === 'tool_calls' &&
        turnResult.toolCalls.length > 0
      ) {
        toolTurns += 1;
        messages.push({
          role: 'assistant',
          content: turnResult.fullText || null,
          tool_calls: turnResult.toolCalls,
        });
        emitProgress(undefined, true);

        for (const tc of turnResult.toolCalls) {
          const args = parseToolArguments(tc.function.arguments);
          const toolOut = await input.executeTool(tc.function.name, args, {
            ...input.toolExecuteContext,
            toolCallId: tc.id,
          });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolOut.content,
            ...(toolOut.attachments?.length
              ? { attachments: toolOut.attachments }
              : {}),
          });
          emitProgress(undefined, true);
        }
        continue;
      }

      let summary = turnResult.fullText.trim();
      if (!summary) {
        const { stream: _stream, ...fallbackBody } = body;
        const fallback = await tryNonStreamingFallback(
          fallbackBody,
          input.signal,
          input.providerId,
        );
        summary = extractMessageText(fallback.choices?.[0]?.message).trim();
      }

      if (!summary) {
        summary = 'Sub-agent completed with no text output.';
      }

      if (
        hasAskQuestionTool &&
        looksLikeProseStructuredQuestion(summary) &&
        proseQuestionRetries < MAX_PROSE_QUESTION_RETRIES
      ) {
        proseQuestionRetries += 1;
        messages.push({ role: 'user', content: PROSE_QUESTION_RETRY_INSTRUCTION });
        emitProgress(undefined, true);
        continue;
      }

      messages.push({ role: 'assistant', content: summary });
      emitProgress(undefined, true);
      return {
        summary,
        toolTurns,
        messages,
        usage: usageSegments.length ? sumUsageSegments(usageSegments) : undefined,
        stats: statsSegments.length ? averageStatsSegments(statsSegments) : undefined,
      };
    }

    emitProgress(undefined, true);
    return {
      summary: `Sub-agent reached maximum tool turns (${maxToolTurns}).`,
      toolTurns,
      messages,
      toolTurnLimitExhausted: true,
      usage: usageSegments.length ? sumUsageSegments(usageSegments) : undefined,
      stats: statsSegments.length ? averageStatsSegments(statsSegments) : undefined,
    };
  },
};

let runnerFactory: () => SubAgentRunner = () => defaultSubAgentRunner;

/** Inject mock runner for deterministic tests. */
export function setSubAgentRunnerFactory(factory: () => SubAgentRunner): void {
  runnerFactory = factory;
}

export function resetSubAgentRunnerFactory(): void {
  runnerFactory = () => defaultSubAgentRunner;
}

/** Resolve active runner implementation. */
export function getSubAgentRunner(): SubAgentRunner {
  return runnerFactory();
}
