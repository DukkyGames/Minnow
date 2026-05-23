/**
 * Priority rule chain: first matching detector wins (unless flags block evaluation).
 */

import { isOrchestratePlanComplete } from '../../chat/orchestrate/plan-complete.ts';
import type { DetectorContext, DetectorHit } from './detector.ts';
import {
  detectAmbiguousReport,
  detectBudgetExhausted,
  detectInProgressWithoutRun,
  detectMissedOrchestratorHeartbeat,
  detectParentSilenceAfterTool,
  detectSpawnStuck,
  detectSubAgentToolSilence,
  evaluateOrchestrateStall,
} from './detector.ts';
import type { SupervisorConfig } from './defaults.ts';

export type SupervisorActionType =
  | 'none'
  | 'inject_resume'
  | 'restart_run'
  | 'respawn_task'
  | 'mark_blocked'
  | 'cancel_run'
  | 'escalate_user'
  | 'llm_escalate'
  | 'budget_stall';

export interface SupervisorDecision {
  action: SupervisorActionType;
  rule?: DetectorHit['rule'];
  payload?: Record<string, unknown>;
}

const TICK_RULE_ORDER: Array<(ctx: DetectorContext) => DetectorHit | null> = [
  detectBudgetExhausted,
  detectInProgressWithoutRun,
  detectSpawnStuck,
  detectMissedOrchestratorHeartbeat,
  detectParentSilenceAfterTool,
  (ctx) => detectStallR8(ctx),
  detectSubAgentToolSilence,
  detectAmbiguousReport,
];

function detectStallR8(ctx: DetectorContext): DetectorHit | null {
  const stall = evaluateOrchestrateStall(
    ctx.board,
    ctx.chat.id,
    ctx.sup.lastTerminalAt,
    {
      nowMs: () => ctx.nowMs,
      isChatStreaming: ctx.isStreaming,
      listActiveSubAgentRuns: ctx.listRuns,
      getActiveChat: () => ctx.chat,
    },
  );
  if (!stall.stalled) return null;
  return {
    rule: 'R8',
    payload: { blockingTaskId: stall.blockingTaskId, retriesExhausted: stall.retriesExhausted },
  };
}

function gate(rule: DetectorHit['rule'], cfg: SupervisorConfig): boolean {
  if (rule === 'R3') return cfg.repetitionDetection;
  if (rule === 'R4' || rule === 'R6' || rule === 'R7' || rule === 'R8') return cfg.autoResume;
  if (rule === 'R10') return cfg.llmEscalation;
  return true;
}

/**
 * Map the highest-priority detector hit to a concrete supervisor action.
 */
export function pickSupervisorDecision(
  ctx: DetectorContext,
  hit: DetectorHit,
): SupervisorDecision {
  const { rule, payload } = hit;
  if (!gate(rule, ctx.cfg)) {
    return { action: 'none' };
  }

  if (
    isOrchestratePlanComplete(ctx.board) &&
    (rule === 'R4' || rule === 'R6' || rule === 'R7' || rule === 'R8')
  ) {
    return { action: 'none' };
  }

  switch (rule) {
    case 'R9': {
      if (!ctx.cfg.askUserOnBudgetExhausted) {
        return { action: 'budget_stall', rule, payload };
      }
      return { action: 'escalate_user', rule, payload };
    }
    case 'R6':
    case 'R7':
    case 'R4':
    case 'R8':
      return { action: 'inject_resume', rule, payload };
    case 'R5':
      return { action: 'respawn_task', rule, payload };
    case 'R1':
      return { action: 'restart_run', rule, payload };
    case 'R10':
      return { action: 'llm_escalate', rule, payload };
    default:
      return { action: 'none', rule, payload };
  }
}

/**
 * Run the ordered tick detectors; returns the first gated hit or null.
 */
export function scanTickDetectors(ctx: DetectorContext): DetectorHit | null {
  if (ctx.sup.awaitingUserDecision || ctx.sup.recoveryInFlight) return null;
  if (!ctx.cfg.enabled) return null;
  if (isOrchestratePlanComplete(ctx.board) || ctx.sup.planCompletedAt != null) {
    return null;
  }

  for (const fn of TICK_RULE_ORDER) {
    const hit = fn(ctx);
    if (!hit) continue;
    if (!gate(hit.rule, ctx.cfg)) continue;
    return hit;
  }
  return null;
}

export function boardFingerprint(board: import('../../types.ts').OrchestrateBoardState): string {
  return board.tasks.map((t) => `${t.id}:${t.status}:${t.assignedRunId ?? ''}`).join('|');
}
