/**
 * Benchmark completion body builder — mirrors main-chat request shaping with fixed constants.
 */

import { applySamplerToBody, type SamplerPreset } from '../agents/sampler-types.ts';
import { mergeThinkingIntoCompletionBody } from '../agents/merge-thinking-body.ts';
import { DEFAULT_LLAMA_THINKING_BUDGET_TOKENS } from '../agents/thinking-types.ts';
import type { ChatCompletionBody } from '../api/chat.ts';
import { DEFAULT_SAMPLER_GLOBAL } from '../config/sampler-meta.ts';
import {
  getToolCallsMetaSync,
  isConstrainedDecodingEnabledForProvider,
  type ToolCallsMeta,
} from '../config/tool-calls-meta.ts';
import type { ProviderCapabilities } from '../providers/capability-probe.ts';
import { applyConstrainedToolCallsToBody } from '../providers/constrained-tool-calls.ts';
import type { ProviderPublic } from '../providers/types.ts';
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from '../providers/types.ts';
import type { OpenAIFunctionDefinition } from '../tools/definitions.ts';
import type { ApiMessage, ModelCapabilities, ReasoningEffortOption } from '../types.ts';

/** Fixed sampler recipe seeded from {@link DEFAULT_SAMPLER_GLOBAL} (not live chat settings). */
export const BENCHMARK_SAMPLER: SamplerPreset = {
  temperature: DEFAULT_SAMPLER_GLOBAL.temperature ?? 1.0,
  topP: DEFAULT_SAMPLER_GLOBAL.topP ?? 0.95,
  topK: DEFAULT_SAMPLER_GLOBAL.topK ?? 20,
};

/** Matches main-chat default max tokens (was 131_072 in the old probe driver). */
export const BENCHMARK_MAX_TOKENS = DEFAULT_SAMPLER_GLOBAL.maxTokens ?? 32768;

/** Pinned thinking effort for every capability-matrix target. */
export const BENCHMARK_THINKING_EFFORT: ReasoningEffortOption = 'medium';

/** Explicit per-request thinking budget (llama.cpp and client-side watchdog). */
export const BENCHMARK_THINKING_BUDGET_TOKENS = DEFAULT_LLAMA_THINKING_BUDGET_TOKENS;

export interface BuildBenchmarkCompletionBodyInput {
  provider: Pick<ProviderPublic, 'id' | 'apiKind' | 'autoApi' | 'modelApiOverrides' | 'constrainedToolCalls'>;
  modelId: string;
  messages: ApiMessage[];
  tools?: OpenAIFunctionDefinition[];
  capabilities?: ModelCapabilities | null;
  providerCapabilities?: ProviderCapabilities | null;
  toolCallsMeta?: ToolCallsMeta;
  /** Caller override (speed suite, etc.) — wins over {@link BENCHMARK_MAX_TOKENS}. */
  maxTokens?: number;
  /** Caller override — wins over {@link BENCHMARK_SAMPLER}.temperature. */
  temperature?: number;
}

export interface BuildBenchmarkCompletionBodyResult {
  body: ChatCompletionBody & { stream: true; stream_options: { include_usage: boolean } };
  usedConstrained: boolean;
  nativeBudgetApplied: boolean;
}

/**
 * Pure builder: apply sampler, thinking, and constrained tool decoding like main chat.
 */
export function buildBenchmarkCompletionBody(
  input: BuildBenchmarkCompletionBodyInput,
): BuildBenchmarkCompletionBodyResult {
  const maxTokens = input.maxTokens ?? BENCHMARK_MAX_TOKENS;
  const samplerPreset: SamplerPreset =
    input.temperature !== undefined
      ? { ...BENCHMARK_SAMPLER, temperature: input.temperature }
      : BENCHMARK_SAMPLER;

  const body = applySamplerToBody(
    {
      model: input.modelId || undefined,
      messages: input.messages,
      stream: true as const,
      stream_options: { include_usage: true },
    },
    samplerPreset,
    maxTokens,
  ) as ChatCompletionBody & { stream: true; stream_options: { include_usage: boolean } };

  const llamaSupportsThinkingBudget =
    input.provider.id === LLAMA_CPP_LOCAL_PROVIDER_ID &&
    input.providerCapabilities?.supportsThinkingBudget === true;

  const { nativeBudgetApplied } = mergeThinkingIntoCompletionBody(
    body as unknown as Record<string, unknown>,
    'on',
    input.provider,
    input.capabilities ?? undefined,
    BENCHMARK_THINKING_EFFORT,
    undefined,
    BENCHMARK_THINKING_BUDGET_TOKENS,
    { llamaSupportsThinkingBudget },
  );

  const tools = input.tools ?? [];
  let usedConstrained = false;
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
    const toolCallsMeta = input.toolCallsMeta ?? getToolCallsMetaSync();
    const constrainedUserEnabled = isConstrainedDecodingEnabledForProvider(
      input.provider,
      toolCallsMeta,
    );
    const constrainedApplied = applyConstrainedToolCallsToBody(body, {
      providerId: input.provider.id,
      modelId: input.modelId,
      userEnabled: constrainedUserEnabled,
      capabilities: input.providerCapabilities ?? null,
      enabledTools: tools,
    });
    Object.assign(body, constrainedApplied.body);
    usedConstrained = constrainedApplied.usedConstrained;
  }

  return { body, usedConstrained, nativeBudgetApplied };
}
