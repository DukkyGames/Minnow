/**
 * Shared helpers for sub-agent orchestrator tests.
 */

import type { SubAgentRunner } from '../../src/agents/types.ts';

export const FIXED_RUN_ID = '11111111-1111-1111-1111-111111111111';
export const FIXED_SUMMARY = 'FIXED_SUMMARY';

let runIdCounter = 0;

export function nextFixedRunId(): string {
  runIdCounter += 1;
  return `11111111-1111-1111-1111-${String(runIdCounter).padStart(12, '0')}`;
}

export function resetRunIdCounter(): void {
  runIdCounter = 0;
}

/** Deterministic mock runner for unit tests. */
export function createMockSubAgentRunner(
  options?: { summary?: string; delayMs?: number },
): SubAgentRunner {
  const summary = options?.summary ?? FIXED_SUMMARY;
  const delayMs = options?.delayMs ?? 0;

  return {
    async run() {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return {
        summary,
        toolTurns: 0,
        messages: [
          { role: 'system', content: 'mock' },
          { role: 'user', content: 'task' },
          { role: 'assistant', content: summary },
        ],
      };
    },
  };
}
