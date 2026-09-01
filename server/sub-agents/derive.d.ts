import type { AgentsState, Attempt, RunState } from './types';

export const DEFAULT_GLOBAL_MAX_CONCURRENT: 3;
export const DEFAULT_TYPE_MAX_CONCURRENT: 2;
export const AGENTS_NAMESPACE: 'agents';

export function emptyState(): AgentsState;
export function foldInto(state: AgentsState, events: Iterable<unknown>): AgentsState;
export function derive(events: Iterable<unknown>): AgentsState;
export function serializeState(state: AgentsState): string;
export function stateToJSON(state: AgentsState): Record<string, unknown>;
export function isTerminal(run: RunState): boolean;
export function lastEndedAttempt(run: RunState): Attempt | undefined;
export function attemptCount(state: AgentsState, runId: string): number;
export function pendingDeliveries(state: AgentsState): RunState[];
