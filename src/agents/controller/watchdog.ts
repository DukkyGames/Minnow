/**
 * Controller watchdog — heartbeat supervision, repetition detection, tiered recovery (MIN-140 Phase 2).
 */

import {
  detectRepetition,
  type ToolCallLogEntry,
} from '../self-healing/detector';
import { DEFAULT_SELF_HEALING_CONFIG } from '../self-healing/defaults';
import type { SubAgentRun, RunLifecycle } from '../types';
import { deriveLifecycleFromStatus } from '../types';
import { hasPendingToolApproval } from '../../tools/approval-queue';
import { isUserPromptLocked } from '../../ui/user-prompt-lock';
import { getSubAgentRun, listActiveSubAgentRuns } from './registry';
import { getHeartbeatConfig } from './wrapper';

const WATCHDOG_TICK_MS = 5_000;

/** Monotonic clock for progress/heartbeat age (mockable in tests). */
let monotonicNow = (): number => performance.now();

/** Per-run watchdog bookkeeping (not persisted until Phase 3). */
interface WatchdogRunState {
  tier1Attempted: boolean;
  handlingSuspect: boolean;
  repetitionFlagged: boolean;
}

const runState = new Map<string, WatchdogRunState>();

let tickTimer: ReturnType<typeof setInterval> | null = null;

export interface WatchdogHandlers {
  tier1Restart: (runId: string, reason: string) => Promise<void>;
  tier2Surface: (runId: string, reason: string) => void;
  tier2AutoRecover: (runId: string, reason: string) => void;
  isRunAfkSupervised: (run: SubAgentRun) => boolean;
  finalizeDoneUnacked: (runId: string) => void;
  onLifecycleChange: (run: SubAgentRun) => void;
}

const noopHandlers: WatchdogHandlers = {
  tier1Restart: async () => {},
  tier2Surface: () => {},
  tier2AutoRecover: () => {},
  isRunAfkSupervised: () => false,
  finalizeDoneUnacked: () => {},
  onLifecycleChange: () => {},
};

let handlers: WatchdogHandlers = { ...noopHandlers };

/** Wire controller callbacks (avoids circular imports at module load). */
export function registerWatchdogHandlers(
  partial: Partial<WatchdogHandlers>,
): void {
  handlers = { ...handlers, ...partial };
}

/** Test hook: override monotonic clock. */
export function setWatchdogMonotonicNow(fn: () => number): void {
  monotonicNow = fn;
}

function ensureRunState(runId: string): WatchdogRunState {
  let state = runState.get(runId);
  if (!state) {
    state = {
      tier1Attempted: false,
      handlingSuspect: false,
      repetitionFlagged: false,
    };
    runState.set(runId, state);
  }
  return state;
}

function monotonicDelta(): number {
  return monotonicNow();
}

function getHeartbeatAgeMs(run: SubAgentRun): number | null {
  if (run.lastHeartbeatAt == null) return null;
  return monotonicDelta() - run.lastHeartbeatAt;
}

function getProgressAgeMs(run: SubAgentRun): number | null {
  if (run.lastProgressAt == null) return null;
  return monotonicDelta() - run.lastProgressAt;
}

function isApprovalPausedForRun(run: SubAgentRun): boolean {
  if (!isUserPromptLocked() && !hasPendingToolApproval()) return false;
  return Boolean(run.parentChatId);
}

function isHeartbeatFresh(run: SubAgentRun, deadMs: number): boolean {
  const age = getHeartbeatAgeMs(run);
  if (age === null) return true;
  return age <= deadMs;
}

function isProgressFresh(run: SubAgentRun, stallMs: number): boolean {
  if (isApprovalPausedForRun(run)) return true;
  const age = getProgressAgeMs(run);
  if (age === null) return true;
  return age <= stallMs;
}

/** Non-mutating categories/types eligible for tier-1 auto-retry. */
export function isNonMutatingSubAgentRun(run: SubAgentRun): boolean {
  const cat = run.category;
  const type = run.type;
  if (cat === 'build' || cat === 'fix') return false;
  if (type === 'shell') return false;
  if (cat === 'research' || cat === 'test') return true;
  if (type === 'explore' || type === 'researcher' || type === 'plan-reviewer') return true;
  return false;
}

export function resolveRunLifecycle(run: SubAgentRun): RunLifecycle {
  return run.lifecycle ?? deriveLifecycleFromStatus(run.status);
}

export function setRunLifecycle(run: SubAgentRun, lifecycle: RunLifecycle): void {
  if (run.lifecycle === lifecycle) return;
  run.lifecycle = lifecycle;
  handlers.onLifecycleChange(run);
}

function evaluateRun(run: SubAgentRun): void {
  if (run.status !== 'running') return;

  const config = getHeartbeatConfig();
  const state = ensureRunState(run.runId);
  const lifecycle = resolveRunLifecycle(run);

  if (lifecycle === 'recovering' || state.handlingSuspect) return;

  const heartbeatFresh = isHeartbeatFresh(run, config.heartbeatDeadMs);
  const progressFresh = isProgressFresh(run, config.progressStallMs);

  if (!heartbeatFresh) {
    if (run.committedResultRef?.trim()) {
      setRunLifecycle(run, 'done_unacked');
      handlers.finalizeDoneUnacked(run.runId);
      return;
    }
    void enterSuspect(run, 'heartbeat_dead');
    return;
  }

  if (!progressFresh || state.repetitionFlagged) {
    const reason = state.repetitionFlagged ? 'repetition' : 'progress_stall';
    void enterSuspect(run, reason);
    return;
  }

  if (lifecycle !== 'running' && lifecycle !== 'dispatching') {
    setRunLifecycle(run, 'running');
  }
}

async function enterSuspect(run: SubAgentRun, reason: string): Promise<void> {
  const state = ensureRunState(run.runId);
  if (state.handlingSuspect || run.status !== 'running') return;
  state.handlingSuspect = true;
  state.repetitionFlagged = false;

  try {
    setRunLifecycle(run, 'suspect');

    const canTier1 =
      isNonMutatingSubAgentRun(run) && !state.tier1Attempted;

    if (canTier1) {
      state.tier1Attempted = true;
      setRunLifecycle(run, 'recovering');
      await handlers.tier1Restart(run.runId, reason);
      return;
    }

    if (handlers.isRunAfkSupervised(run)) {
      handlers.tier2AutoRecover(run.runId, reason);
    } else {
      handlers.tier2Surface(run.runId, reason);
    }
  } finally {
    state.handlingSuspect = false;
  }
}

/** Periodic watchdog evaluation for all active runs. */
export function tickWatchdog(): void {
  for (const run of listActiveSubAgentRuns()) {
    if (run.status === 'running') {
      evaluateRun(run);
    }
  }
}

/** Start ~5s watchdog tick (idempotent). */
export function startWatchdog(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    tickWatchdog();
  }, WATCHDOG_TICK_MS);
}

/** Stop watchdog tick (controller reset). */
export function stopWatchdog(): void {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

/**
 * Feed tool-call log for repetition detection; may flag suspect on duplicate tools.
 */
export function observeSubAgentToolCall(
  runId: string,
  _type: string,
  log: ToolCallLogEntry[],
  _parentChatId: string | null,
): void {
  const thresholds = DEFAULT_SELF_HEALING_CONFIG.tier1;
  const hit = detectRepetition(log, {
    duplicateToolCallThreshold: thresholds.duplicateToolCallThreshold,
    sameErrorThreshold: thresholds.sameErrorThreshold,
  });
  if (!hit) return;

  const state = ensureRunState(runId);
  state.repetitionFlagged = true;

  const run = getSubAgentRun(runId);
  if (run?.status === 'running') {
    void enterSuspect(run, hit.reason);
  }
}

/** Clear watchdog bookkeeping (tests + controller reset). */
export function resetWatchdogState(): void {
  runState.clear();
  monotonicNow = () => performance.now();
}

/** Reset handlers to noop defaults (tests + controller reset). */
export function resetWatchdogHandlers(): void {
  handlers = { ...noopHandlers };
}

/** @deprecated Use resetWatchdogState — kept for self-healing shim compatibility. */
export const resetSelfHealingState = resetWatchdogState;
