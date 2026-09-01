import type { AgentsState, Caps, Desired, NextAction } from './types';

export function defaultCaps(): Caps;

export function nextAction(state: AgentsState, runId: string): NextAction;

export function pendingAbandonments(
  state: AgentsState,
): Array<{ runId: string; reason: string; evidence: Record<string, unknown> }>;

export function typeCap(caps: Caps | null | undefined, agentType: string): number;

/**
 * Which attempts should be running. Caps are arguments; the core never reads
 * `sub-agents.json`. Caps gate starting, not continuing.
 */
export function plan(state: AgentsState, caps?: Caps): Desired[];
