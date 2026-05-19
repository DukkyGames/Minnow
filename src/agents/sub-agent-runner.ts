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
import type { ApiMessage, ChatCompletionChunk, ToolCallAccumulator } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import type { SubAgentRunner, SubAgentRunnerOutput } from './types';

/** Max tool rounds inside one sub-agent run. */
export const MAX_SUB_AGENT_TOOL_TURNS = 6;

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
): Promise<{
  fullText: string;
  finishReason: string | undefined;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
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
    if (delta) fullText += delta;
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
    const temperature = 0.4;
    const maxTokens = 2048;

    for (let turn = 0; turn < MAX_SUB_AGENT_TOOL_TURNS; turn++) {
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

      const turnResult = await streamSubAgentTurn(
        input.providerId,
        body,
        input.signal,
      );

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

        for (const tc of turnResult.toolCalls) {
          const args = parseToolArguments(tc.function.arguments);
          const result = await input.executeTool(tc.function.name, args);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
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

      messages.push({ role: 'assistant', content: summary });
      return { summary, toolTurns, messages };
    }

    return {
      summary: 'Sub-agent reached maximum tool turns.',
      toolTurns,
      messages,
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
