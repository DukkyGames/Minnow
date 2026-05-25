/**
 * Shared helpers for sub-agent orchestrator tests.
 */

import { cloneSubAgentMessages } from '../../src/agents/sub-agent-runner.ts';
import type { SubAgentRunner } from '../../src/agents/types.ts';
import type { ApiMessage } from '../../src/types.ts';

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
    async run(input) {
      const messages: ApiMessage[] = [
        { role: 'system', content: 'mock' },
        { role: 'user', content: input.task },
      ];
      input.onMessagesChange?.(cloneSubAgentMessages(messages));
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      messages.push({ role: 'assistant', content: summary });
      input.onMessagesChange?.(cloneSubAgentMessages(messages));
      const structuredOutcome = {
        summary,
        findings: [] as { title: string; detail: string }[],
        artifacts: [] as { kind: 'note'; label: string; ref: string }[],
      };
      return {
        summary,
        structuredOutcome,
        toolTurns: 0,
        messages,
      };
    },
  };
}
