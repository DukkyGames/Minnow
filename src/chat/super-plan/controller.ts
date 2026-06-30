/**
 * Super Plan controller — sequences the full pipeline with two user checkpoints.
 */

import { isChatStreaming, subscribeChatStreamEnd } from '../streaming-state';
import type { Chat } from '../../types';
import {
  cancelSuperPlanState,
  ensureSuperPlanState,
  initSuperPlanState,
  markSuperPlanStageStatus,
  resetSuperPlanStage,
  setSuperPlanActiveStage,
} from './state';
import {
  finalizeStreamStage,
  runSuperPlanStage,
  type SuperPlanStageOutcome,
} from './stages';
import { nextRunnableSuperPlanStage } from './pipeline';
import {
  getSuperPlanConfigSync,
  loadSuperPlanConfig,
} from '../../config/super-plan-meta';
import {
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

async function handleStageOutcome(
  chat: Chat,
  stageId: SuperPlanStageId,
  outcome: SuperPlanStageOutcome,
): Promise<void> {
  if (outcome.kind === 'await_stream') {
    markSuperPlanStageStatus(chat, stageId, 'running');
    notifyListeners(chat);
    return;
  }

  if (outcome.kind === 'blocked_user') {
    notifyListeners(chat);
    return;
  }

  if (outcome.kind === 'skipped' || outcome.kind === 'done') {
    if (outcome.kind === 'done' && !isBlockedCheckpoint(stageId)) {
      markSuperPlanStageStatus(chat, stageId, 'done', {
        artifactPath: outcome.artifactPath,
      });
    }
    const config = getSuperPlanConfigSync();
    const next = nextRunnableSuperPlanStage(stageId, config);
    if (!next) {
      notifyListeners(chat);
      return;
    }
    setSuperPlanActiveStage(chat, next);
    await advanceSuperPlan(chat);
    return;
  }

  notifyListeners(chat);
}

/** Start the Super Plan pipeline for a chat. */
export async function startSuperPlan(chat: Chat, prompt: string): Promise<void> {
  ensureStreamEndHook();
  await loadSuperPlanConfig();
  initSuperPlanState(chat, prompt);
  await advanceSuperPlan(chat);
}

/** Advance to the next runnable stage (no-op when blocked or streaming). */
export async function advanceSuperPlan(chat: Chat): Promise<void> {
  if (!chat.superPlan || chat.superPlan.cancelled) return;
  if (advancingChats.has(chat.id)) return;
  if (isChatStreaming(chat.id)) return;

  const state = ensureSuperPlanState(chat);
  const stageId = state.activeStage;
  const record = state.stages[stageId];
  if (record?.status === 'blocked_user') {
    notifyListeners(chat);
    return;
  }
  if (record?.status === 'running') return;

  advancingChats.add(chat.id);
  try {
    markSuperPlanStageStatus(chat, stageId, 'running');
    const outcome = await runSuperPlanStage(chat, stageId);
    await handleStageOutcome(chat, stageId, outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markSuperPlanStageStatus(chat, stageId, 'error', { error: message });
    notifyListeners(chat);
  } finally {
    advancingChats.delete(chat.id);
  }
}

/** Called when a chat turn finishes — finalize stream stages and advance. */
export async function onSuperPlanStreamEnd(chatId: string): Promise<void> {
  const { findChatById } = await import('../../state/sessions');
  const chat = findChatById(chatId);
  if (!chat?.superPlan || chat.superPlan.cancelled) return;

  const stageId = chat.superPlan.activeStage;
  const record = chat.superPlan.stages[stageId];
  if (record?.status !== 'running') return;

  try {
    const outcome = await finalizeStreamStage(chat, stageId);
    await handleStageOutcome(chat, stageId, outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markSuperPlanStageStatus(chat, stageId, 'error', { error: message });
    notifyListeners(chat);
  }
}

/** Resume after a user checkpoint (spec_confirm or present). */
export async function resumeSuperPlanAfterUser(
  chat: Chat,
  action: SuperPlanCheckpointAction,
): Promise<void> {
  if (!chat.superPlan || chat.superPlan.cancelled) return;
  const stageId = chat.superPlan.activeStage;

  if (stageId === 'spec_confirm') {
    if (action === 'revise') {
      resetSuperPlanStage(chat, 'spec_confirm');
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
      await advanceSuperPlan(chat);
    }
    return;
  }

  if (stageId === 'present') {
    if (action === 'revise') {
      resetSuperPlanStage(chat, 'present');
      resetSuperPlanStage(chat, 'finalize');
      setSuperPlanActiveStage(chat, 'finalize');
      await advanceSuperPlan(chat);
      return;
    }
    markSuperPlanStageStatus(chat, 'present', 'done', {
      artifactPath: chat.superPlan.planPath,
    });
    notifyListeners(chat);
  }
}

/** Cancel the Super Plan pipeline. */
export function cancelSuperPlan(chat: Chat): void {
  cancelSuperPlanState(chat);
  notifyListeners(chat);
}

export function isSuperPlanBlocked(chat: Chat): boolean {
  const state = chat.superPlan;
  if (!state) return false;
  const record = state.stages[state.activeStage];
  return record?.status === 'blocked_user';
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
