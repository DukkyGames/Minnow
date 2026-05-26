/**
 * Benchmark completion prompts — steer models to answer in `content`, not reasoning.
 */

import { apiMessageContentToText } from '../api/message-content.ts';
import type { ApiMessage } from '../types.ts';

/** Minimum `max_tokens` for benchmark runs (reasoning models need room after thinking). */
export const MIN_BENCHMARK_MAX_TOKENS = 256;

const BENCHMARK_DIRECT_REPLY_SYSTEM =
  'Put your complete final answer in the main assistant message content only. ' +
  'Do not use a separate reasoning, thinking, or chain-of-thought channel.';

/** Floor requested max tokens so reasoning models can emit visible output. */
export function resolveBenchmarkMaxTokens(requested?: number, fallback = 2048): number {
  const n = requested ?? fallback;
  return Math.max(n, MIN_BENCHMARK_MAX_TOKENS);
}

export interface ApplyBenchmarkSystemPromptOptions {
  /** Extra system line (e.g. one-shot retry after reasoning-only stream). */
  extraSystem?: string;
}

/**
 * Prepend/merge benchmark system instructions so scoring sees `content`, not thoughts.
 */
export function applyBenchmarkSystemPrompt(
  messages: ApiMessage[],
  options: ApplyBenchmarkSystemPromptOptions = {},
): ApiMessage[] {
  const lines = [BENCHMARK_DIRECT_REPLY_SYSTEM];
  if (options.extraSystem?.trim()) {
    lines.push(options.extraSystem.trim());
  }
  const prefix = lines.join('\n\n');

  const out = messages.map((m) => ({ ...m }));
  const systemIdx = out.findIndex((m) => m.role === 'system');
  if (systemIdx >= 0) {
    const existing = apiMessageContentToText(out[systemIdx]!.content);
    out[systemIdx] = {
      role: 'system',
      content: existing ? `${prefix}\n\n${existing}` : prefix,
    };
    return out;
  }

  out.unshift({ role: 'system', content: prefix });
  return out;
}
