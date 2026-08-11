/**
 * Shared helpers for capability probe verdict predicates.
 */

import { toolNameMatch } from '../scoring.ts';
import type {
  CapabilityProbeRunOutput,
  CapabilityProbeVerdict,
  CapabilityToolCall,
} from './types.ts';

export function pass(reason: string): CapabilityProbeVerdict {
  return { verdict: 'pass', reason };
}

export function partial(reason: string): CapabilityProbeVerdict {
  return { verdict: 'partial', reason };
}

export function fail(reason: string): CapabilityProbeVerdict {
  return { verdict: 'fail', reason };
}

export function parseToolArgs(call: CapabilityToolCall): Record<string, unknown> | null {
  try {
    return JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function hasTool(calls: CapabilityToolCall[], name: string): boolean {
  return toolNameMatch(calls, name);
}

export function maxRoundBatchSize(out: CapabilityProbeRunOutput): number {
  let max = 0;
  for (const round of out.rounds) {
    max = Math.max(max, round.toolCalls.length);
  }
  return max;
}

export function totalToolRounds(out: CapabilityProbeRunOutput): number {
  return out.rounds.filter((r) => r.toolCalls.length > 0).length;
}

export function streamVerdict(out: CapabilityProbeRunOutput): CapabilityProbeVerdict {
  const chunks = out.streamChunkCount ?? 0;
  if (chunks >= 2) return pass('Multiple stream chunks observed');
  if (chunks === 1) return partial('Single delivery chunk (may not be true streaming)');
  return fail('No stream chunks recorded');
}
