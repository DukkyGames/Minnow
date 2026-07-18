/**
 * Super Plan controller — sequences the full pipeline with two user checkpoints.
 *
 * Advancement is a single sequential loop per chat: each stage runner resolves
 * only after its work (chat turn, research run, sub-agent review) has fully
 * completed, so the loop finalizes the stage deterministically and moves on.
 * The chat stream-end hook is only a stall-recovery safety net, never the
 * primary advancement path (that dual path previously double-ran stages).
 */

import { isChatStreaming, subscribeChatStreamEnd } from '../streaming-state';
import { isChatTurnInProgress, isChatTurnSetupPending } from '../chat-turn-guard';
import type { Chat, TurnRunRecord } from '../../types';
import { cancelResearch } from '../../research/client';
import {
  cancelSuperPlanState,
  initSuperPlanState,
  markSuperPlanStageStatus,
  resetSuperPlanStage,
  rewindSuperPlanStages,
  setSuperPlanActiveStage,
  setSuperPlanPaused,
} from './state';
import {
  finalizeStreamStage,
  runSuperPlanStage,
  type SuperPlanStageOutcome,
} from './stages';
import { nextRunnableSuperPlanStage, shouldSkipSuperPlanStage } from './pipeline';
import {
  getSuperPlanConfigSync,
  loadSuperPlanConfig,
} from '../../config/super-plan-meta';
import {
  SUPER_PLAN_STAGE_LABELS,
  SUPER_PLAN_STAGE_ORDER,
  type SuperPlanCheckpointAction,
  type SuperPlanStageId,
} from './types';

export type SuperPlanControllerListener = (chat: Chat) => void;

const advancingChats = new Set<string>();
let streamEndUnsubscribe: (() => void) | null = null;
const listeners = new Set<SuperPlanControllerListener>();

function ensureStreamEndHook(): void {
  if (streamEndUnsubscribe) return;
  streamEndUnsubscribe = subscribeChatStreamEnd((chatId) => {
    void onSuperPlanStreamEnd(chatId);
  });
}

export function subscribeSuperPlanController(
  listener: SuperPlanControllerListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(chat: Chat): void {
  for (const fn of listeners) {
    try {
      fn(chat);
    } catch {
      /* UI hook */
    }
  }
}

function isBlockedCheckpoint(stage: SuperPlanStageId): boolean {
  return stage === 'spec_confirm' || stage === 'present';
}

/**
 * True when skipSuperPlanStage (or another external action) finished or advanced
 * past `stageId` while the sequential loop was still tied to that stage.
 */
function wasSuperPlanStageSuperseded(
  chat: Chat,
  stageId: SuperPlanStageId,
): boolean {
  const state = chat.superPlan;
  if (!state) return false;
  if (state.stages[stageId]?.status === 'done') return true;
  const stageIndex = SUPER_PLAN_STAGE_ORDER.indexOf(stageId);
  const activeIndex = SUPER_PLAN_STAGE_ORDER.indexOf(state.activeStage);
  return stageIndex >= 0 && activeIndex > stageIndex;
}

/** Run record created by the stage turn that just finished (not a concurrent follow-up). */
function resolveStageTurnRun(
  chat: Chat,
  runsBefore: number,
): TurnRunRecord | undefined {
  const newRuns = (chat.runs ?? []).slice(runsBefore);
  if (newRuns.length === 0) return undefined;
  if (newRuns.length === 1) return newRuns[0];
  // A queued follow-up can start after the stage turn; it is always newer.
  return newRuns.reduce((earliest, run) =>
    run.createdAt < earliest.createdAt ? run : earliest,
  );
}

/**
 * True when the sequential loop exited with an idle pending/running stage that
 * should auto-resume (backed off on a busy chat, or stream-end fired too early).
 */
function shouldRetrySuperPlanAdvance(chat: Chat): boolean {
  const state = chat.superPlan;
  if (!state || state.cancelled || state.paused) return false;
  if (getSuperPlanCheckpointKind(chat)) return false;
  if (advancingChats.has(chat.id)) return false;
  if (isChatStreaming(chat.id) || isChatTurnSetupPending(chat.id)) return false;
  const record = state.stages[state.activeStage];
  if (!record || record.status === 'error') return false;
  return record.status === 'pending' || record.status === 'running';
}

/** Defer one advance attempt once the chat turn slot is free again. */
function scheduleSuperPlanAdvanceIfStalled(chat: Chat): void {
  if (!shouldRetrySuperPlanAdvance(chat)) return;
  const chatId = chat.id;
  setTimeout(() => {
    void import('../../state/sessions').then(({ findChatById }) => {
      const current = findChatById(chatId);
      if (current && shouldRetrySuperPlanAdvance(current)) {
        void advanceSuperPlan(current);
      }
    });
  }, 0);
}

/** Abort the chat's in-flight turn (lazy import keeps the UI chain out of tests). */
function stopChatTurn(chatId: string): void {
  void import('../stop-generation')
    .then((m) => m.stopGeneration(chatId))
    .catch(() => undefined);
}

/** Cancel the in-flight plan-reviewer sub-agent (lazy import keeps the UI chain out of tests). */
function cancelReviewerSubAgent(runId: string): void {
  void import('../../agents/controller/controller')
    .then((m) => m.cancelSubAgent(runId, 'parent_abort'))
    .catch(() => undefined);
}

/** True while the sequential stage loop is running for this chat. */
export function isSuperPlanAdvancing(chatId: string): boolean {
  return advancingChats.has(chatId);
}

/** Start the Super Plan pipeline for a chat (resumes an interrupted one instead of restarting). */
export async function startSuperPlan(chat: Chat, prompt: string): Promise<void> {
  ensureStreamEndHook();
  await loadSuperPlanConfig();
  const existing = chat.superPlan;
  const finished = existing?.stages.present?.status === 'done';
  if (existing && !existing.cancelled && !finished && existing.prompt === prompt.trim()) {
    await resumeSuperPlanPipeline(chat);
    return;
  }
  initSuperPlanState(chat, prompt);
  await advanceSuperPlan(chat);
}

/**
 * Run stages sequentially from the active stage until the pipeline blocks on
 * the user, pauses, errors, or completes. Re-entrant calls are no-ops.
 */
export async function advanceSuperPlan(chat: Chat): Promise<void> {
  if (!chat.superPlan || chat.superPlan.cancelled || chat.superPlan.paused) return;
  if (advancingChats.has(chat.id)) return;
  if (isChatStreaming(chat.id)) return;

  ensureStreamEndHook();
  advancingChats.add(chat.id);
  let currentStage: SuperPlanStageId | null = null;
  try {
    await loadSuperPlanConfig();
    for (;;) {
      const state = chat.superPlan;
      if (!state || state.cancelled || state.paused) break;
      // A concurrent send claimed the chat: back off and let the stream-end
      // safety net resume the pending stage once the chat is free again.
      if (isChatStreaming(chat.id) || isChatTurnSetupPending(chat.id)) break;
      const stageId = state.activeStage;
      currentStage = stageId;
      const config = getSuperPlanConfigSync();
      const record = state.stages[stageId];

      if (record?.status === 'blocked_user' || record?.status === 'error') break;
      if (record?.status === 'done') {
        const next = nextRunnableSuperPlanStage(stageId, config);
        if (!next) break;
        setSuperPlanActiveStage(chat, next);
        notifyListeners(chat);
        continue;
      }

      if (shouldSkipSuperPlanStage(stageId, config)) {
        markSuperPlanStageStatus(chat, stageId, 'done');
        const next = nextRunnableSuperPlanStage(stageId, config);
        if (!next) break;
        setSuperPlanActiveStage(chat, next);
        notifyListeners(chat);
        continue;
      }

      markSuperPlanStageStatus(chat, stageId, 'running');
      notifyListeners(chat);

      // Skip may land between marking running and starting the runner — do not
      // launch a superseded stage (e.g. grill interview after Skip interview).
      if (wasSuperPlanStageSuperseded(chat, stageId)) {
        continue;
      }

      const runsBefore = chat.runs?.length ?? 0;
      let outcome: SuperPlanStageOutcome = await runSuperPlanStage(chat, stageId, {
        onResearchStarted: () => notifyListeners(chat),
      });

      if (outcome.kind === 'await_stream') {
        // The stage's chat turn has fully completed by the time the runner
        // resolves; finalize deterministically instead of waiting on the
        // stream-end hook (which fires mid-turn and used to double-advance).
        if (chat.superPlan?.cancelled) break;
        if (wasSuperPlanStageSuperseded(chat, stageId)) {
          continue;
        }
        if ((chat.runs?.length ?? 0) <= runsBefore) {
          // runChatTurn no-opped (chat was busy) — leave the stage pending so
          // the safety net or the Resume button reruns it.
          if (wasSuperPlanStageSuperseded(chat, stageId)) {
            continue;
          }
          resetSuperPlanStage(chat, stageId);
          notifyListeners(chat);
          break;
        }
        const stageRun = resolveStageTurnRun(chat, runsBefore);
        if (stageRun?.status === 'stopped') {
          if (wasSuperPlanStageSuperseded(chat, stageId)) {
            continue;
          }
          resetSuperPlanStage(chat, stageId);
          setSuperPlanPaused(chat, true);
          notifyListeners(chat);
          break;
        }
        if (stageRun?.status === 'failed') {
          const detail =
            stageRun.errorMessage?.trim() ||
            'Retry the stage, or open the chat for the failure notice.';
          throw new Error(
            `${SUPER_PLAN_STAGE_LABELS[stageId]} turn failed — ${detail}`,
          );
        }
        try {
          outcome = await finalizeStreamStage(chat, stageId);
        } catch (err) {
          if (stageRun?.endReason === 'max_tool_turns') {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(
              `${message} The turn hit the tool-turn cap before finishing — ` +
                'raise Settings → Tools → max tool turns, then retry.',
            );
          }
          throw err;
        }
      }

      if (outcome.kind === 'paused') {
        resetSuperPlanStage(chat, stageId);
        setSuperPlanPaused(chat, true);
        notifyListeners(chat);
        break;
      }

      if (outcome.kind === 'blocked_user') {
        notifyListeners(chat);
        break;
      }

      if (outcome.kind === 'done' || outcome.kind === 'skipped') {
        // A reviewer run that completes just as the user cancels must not
        // overwrite the 'Cancelled by user' record with a done stage.
        if (chat.superPlan?.cancelled) break;
        if (!isBlockedCheckpoint(stageId) || outcome.kind === 'skipped') {
          markSuperPlanStageStatus(chat, stageId, 'done', {
            ...(outcome.kind === 'done' && outcome.artifactPath
              ? { artifactPath: outcome.artifactPath }
              : {}),
          });
        }
        const next = nextRunnableSuperPlanStage(stageId, getSuperPlanConfigSync());
        if (!next) {
          notifyListeners(chat);
          break;
        }
        setSuperPlanActiveStage(chat, next);
        notifyListeners(chat);
        continue;
      }

      break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (currentStage) {
      markSuperPlanStageStatus(chat, currentStage, 'error', { error: message });
    }
    notifyListeners(chat);
  } finally {
    advancingChats.delete(chat.id);
    notifyListeners(chat);
    scheduleSuperPlanAdvanceIfStalled(chat);
  }
}

/**
 * Stall-recovery safety net: if a chat turn ends and the pipeline has a
 * pending or stale-running stage with no loop in flight, kick the loop.
 */
export async function onSuperPlanStreamEnd(chatId: string): Promise<void> {
  // notifyChatStreamEnded fires *before* setStreaming(false) in the same
  // synchronous block (src/tools/loop.ts), so isChatStreaming(chat.id) below
  // would still read true without yielding first. This previously worked only
  // because `await import(...)` happened to defer past that block — make the
  // ordering explicit instead of relying on that coincidence (same hazard
  // documented in src/state/orchestrate-board-actions.ts).
  await new Promise((resolve) => setTimeout(resolve, 0));
  const { findChatById } = await import('../../state/sessions');
  const chat = findChatById(chatId);
  if (!chat?.superPlan || chat.superPlan.cancelled || chat.superPlan.paused) return;
  if (isChatStreaming(chat.id)) return;
  if (advancingChats.has(chat.id)) {
    // Stream-end fired while the sequential loop still owns this chat — retry once
    // it finishes; the first hook invocation would otherwise no-op permanently.
    scheduleSuperPlanAdvanceIfStalled(chat);
    return;
  }

  const record = chat.superPlan.stages[chat.superPlan.activeStage];
  if (record?.status === 'running') {
    // A running stage with no loop and no stream is stale (e.g. reload mid-stage).
    resetSuperPlanStage(chat, chat.superPlan.activeStage);
  } else if (record?.status !== 'pending') {
    return;
  }
  await advanceSuperPlan(chat);
}

/** Resume after a user checkpoint (spec_confirm or present). */
export async function resumeSuperPlanAfterUser(
  chat: Chat,
  action: SuperPlanCheckpointAction,
): Promise<void> {
  if (!chat.superPlan || chat.superPlan.cancelled) return;
  ensureStreamEndHook();
  if (chat.superPlan.paused) setSuperPlanPaused(chat, false);
  const stageId = chat.superPlan.activeStage;

  if (stageId === 'spec_confirm') {
    if (action === 'revise') {
      resetSuperPlanStage(chat, 'spec_confirm');
      notifyListeners(chat);
      await advanceSuperPlan(chat);
      return;
    }
    markSuperPlanStageStatus(chat, 'spec_confirm', 'done', {
      artifactPath: chat.superPlan.specPath,
    });
    const config = getSuperPlanConfigSync();
    const next = nextRunnableSuperPlanStage('spec_confirm', config);
    if (next) {
      setSuperPlanActiveStage(chat, next);
      notifyListeners(chat);
      await advanceSuperPlan(chat);
    }
    return;
  }

  if (stageId === 'present') {
    if (action === 'revise') {
      resetSuperPlanStage(chat, 'present');
      resetSuperPlanStage(chat, 'finalize');
      setSuperPlanActiveStage(chat, 'finalize');
      notifyListeners(chat);
      await advanceSuperPlan(chat);
      return;
    }
    markSuperPlanStageStatus(chat, 'present', 'done', {
      artifactPath: chat.superPlan.planPath,
    });
    notifyListeners(chat);
  }
}

/** Pause the pipeline: stop the in-flight stage turn; the stage reruns on resume. */
export function pauseSuperPlan(chat: Chat): void {
  if (!chat.superPlan || chat.superPlan.cancelled) return;
  const reviewRunId = chat.superPlan.reviewRunId?.trim();
  setSuperPlanPaused(chat, true);
  if (isChatStreaming(chat.id)) {
    stopChatTurn(chat.id);
  }
  if (reviewRunId) {
    cancelReviewerSubAgent(reviewRunId);
  }
  notifyListeners(chat);
}

/** Resume a paused (or stalled/errored) pipeline at its active stage. */
export async function resumeSuperPlanPipeline(chat: Chat): Promise<void> {
  const state = chat.superPlan;
  if (!state || state.cancelled) return;
  ensureStreamEndHook();
  setSuperPlanPaused(chat, false);
  const record = state.stages[state.activeStage];
  if (record?.status === 'running' || record?.status === 'error') {
    resetSuperPlanStage(chat, state.activeStage);
  }
  notifyListeners(chat);
  await advanceSuperPlan(chat);
}

/** Re-run the active (usually errored) stage from scratch. */
export async function retrySuperPlanStage(chat: Chat): Promise<void> {
  const state = chat.superPlan;
  if (!state || state.cancelled) return;
  resetSuperPlanStage(chat, state.activeStage);
  setSuperPlanPaused(chat, false);
  notifyListeners(chat);
  await advanceSuperPlan(chat);
}

/** Skip the active stage and continue with the next runnable one. */
export async function skipSuperPlanStage(chat: Chat): Promise<void> {
  const state = chat.superPlan;
  if (!state || state.cancelled) return;
  const stageId = state.activeStage;
  if (stageId === 'present') return;
  // Skipping a live stage (e.g. an in-progress interview) must abort its
  // in-flight turn first, or advanceSuperPlan would bail out on the still-
  // streaming chat and the stopped run would be misread as a pause. Include
  // turn setup (before the streaming flag is set) so an early Skip interview
  // does not let the grill turn start asking questions.
  if (isChatTurnInProgress(chat.id)) {
    stopChatTurn(chat.id);
  }
  resetSuperPlanStage(chat, stageId);
  markSuperPlanStageStatus(chat, stageId, 'done');
  const next = nextRunnableSuperPlanStage(stageId, getSuperPlanConfigSync());
  if (!next) {
    notifyListeners(chat);
    return;
  }
  setSuperPlanActiveStage(chat, next);
  setSuperPlanPaused(chat, false);
  notifyListeners(chat);
  await advanceSuperPlan(chat);
}

/** Rework the pipeline from an earlier stage: reset it and everything after, then run. */
export async function rewindSuperPlanToStage(
  chat: Chat,
  stageId: SuperPlanStageId,
): Promise<void> {
  const state = chat.superPlan;
  if (!state || state.cancelled) return;
  const targetIndex = SUPER_PLAN_STAGE_ORDER.indexOf(stageId);
  const activeIndex = SUPER_PLAN_STAGE_ORDER.indexOf(state.activeStage);
  if (targetIndex < 0 || targetIndex > activeIndex) return;
  if (isChatStreaming(chat.id)) {
    stopChatTurn(chat.id);
  }
  rewindSuperPlanStages(chat, stageId);
  notifyListeners(chat);
  await advanceSuperPlan(chat);
}

/** Cancel the Super Plan pipeline (terminal — a new run starts fresh). */
export function cancelSuperPlan(chat: Chat): void {
  const researchId = chat.superPlan?.researchId?.trim();
  const researchRunning =
    chat.superPlan?.activeStage === 'research' &&
    chat.superPlan.stages.research?.status === 'running';
  const reviewRunId = chat.superPlan?.reviewRunId?.trim();
  cancelSuperPlanState(chat);
  if (isChatStreaming(chat.id)) {
    stopChatTurn(chat.id);
  }
  if (researchId && researchRunning) {
    void cancelResearch(researchId).catch(() => undefined);
  }
  if (reviewRunId) {
    cancelReviewerSubAgent(reviewRunId);
  }
  notifyListeners(chat);
}

export function isSuperPlanBlocked(chat: Chat): boolean {
  const state = chat.superPlan;
  if (!state) return false;
  const record = state.stages[state.activeStage];
  return record?.status === 'blocked_user';
}

/**
 * Pipeline is idle without user input: paused, errored, or a stage sits
 * pending/stale-running with no loop or stream in flight (e.g. after reload).
 */
export function isSuperPlanStalled(chat: Chat): boolean {
  const state = chat.superPlan;
  if (!state || state.cancelled) return false;
  if (state.stages.present?.status === 'done') return false;
  if (state.paused) return true;
  if (advancingChats.has(chat.id) || isChatStreaming(chat.id)) return false;
  const record = state.stages[state.activeStage];
  return (
    !record ||
    record.status === 'pending' ||
    record.status === 'running' ||
    record.status === 'error'
  );
}

export function getSuperPlanCheckpointKind(
  chat: Chat,
): 'spec_confirm' | 'present' | null {
  const state = chat.superPlan;
  if (!state) return null;
  const record = state.stages[state.activeStage];
  if (record?.status !== 'blocked_user') return null;
  if (state.activeStage === 'spec_confirm') return 'spec_confirm';
  if (state.activeStage === 'present') return 'present';
  return null;
}

/** Test helper — reset module hooks. */
export function resetSuperPlanControllerForTests(): void {
  advancingChats.clear();
  if (streamEndUnsubscribe) {
    streamEndUnsubscribe();
    streamEndUnsubscribe = null;
  }
  listeners.clear();
}
