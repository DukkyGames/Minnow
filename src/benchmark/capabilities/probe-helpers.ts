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

/** True when any of `names` was called. */
export function hasAnyTool(calls: CapabilityToolCall[], names: string[]): boolean {
  return names.some((name) => toolNameMatch(calls, name));
}

/** Count how many of `names` were called at least once. */
export function countTools(calls: CapabilityToolCall[], names: string[]): number {
  return names.filter((name) => toolNameMatch(calls, name)).length;
}

/** Distinct called tool names that were never offered to the model. */
export function hallucinatedToolNames(out: CapabilityProbeRunOutput): string[] {
  const offered = new Set(out.offeredToolNames);
  const invented = new Set<string>();
  for (const call of out.toolCalls) {
    const name = call.function.name;
    if (name && !offered.has(name)) invented.add(name);
  }
  for (const round of out.rounds) {
    for (const call of round.toolCalls) {
      const name = call.function.name;
      if (name && !offered.has(name)) invented.add(name);
    }
  }
  return [...invented];
}

/** Concatenated arguments JSON for every call to `name` (empty when never called). */
export function argsTextFor(out: CapabilityProbeRunOutput, name: string): string {
  const calls = [...out.toolCalls, ...out.rounds.flatMap((r) => r.toolCalls)];
  return calls
    .filter((c) => c.function.name === name)
    .map((c) => c.function.arguments)
    .join(' ');
}

/**
 * True when some call to `name` passed one of `uids` as its element uid.
 *
 * Substring matching on the raw arguments JSON (as `argsTextFor` does) is unsafe for
 * numeric ids — "7" matches a coordinate or a length just as happily.
 */
export function usedStubUid(
  out: CapabilityProbeRunOutput,
  name: string,
  uids: readonly number[],
): boolean {
  return out.toolCalls
    .filter((c) => c.function.name === name)
    .some((c) => {
      const raw = parseToolArgs(c)?.uid;
      const uid = typeof raw === 'string' ? Number(raw) : raw;
      return typeof uid === 'number' && uids.includes(uid);
    });
}

/** Round index (0-based) of the first call to `name`; -1 when never called. */
export function firstRoundWithTool(out: CapabilityProbeRunOutput, name: string): number {
  return out.rounds.findIndex((r) => r.toolCalls.some((c) => c.function.name === name));
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
