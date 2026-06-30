/**
 * Super Plan state persistence helpers — read/write {@link Chat.superPlan}.
 */

import { ORCHESTRATE_PLANS_PREFIX } from '../orchestrate/plan-path';
import { findChatById, scheduleSaveSessions, touchChat } from '../../state/sessions';
import type { Chat } from '../../types';
import { planInvolvesUi } from './review-helpers';
import {
  SUPER_PLAN_STAGE_ORDER,
  type SuperPlanStageId,
  type SuperPlanStageRecord,
  type SuperPlanStageStatus,
  type SuperPlanState,
} from './types';

const REFERENCES_PREFIX = `${ORCHESTRATE_PLANS_PREFIX}references/`;

export function slugFromSuperPlanPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'super-plan';
}

export function superPlanSpecPath(slug: string): string {
  return `${REFERENCES_PREFIX}${slug}-spec.md`;
}

export function superPlanResearchPath(slug: string): string {
  return `${REFERENCES_PREFIX}${slug}-research.md`;
}

export function superPlanPlanPath(slug: string): string {
  return `${ORCHESTRATE_PLANS_PREFIX}${slug}.md`;
}

function createPendingStageRecord(): SuperPlanStageRecord {
  return { status: 'pending' };
}

export function createInitialSuperPlanStages(): Record<
  SuperPlanStageId,
  SuperPlanStageRecord
> {
  const stages = {} as Record<SuperPlanStageId, SuperPlanStageRecord>;
  for (const id of SUPER_PLAN_STAGE_ORDER) {
    stages[id] = createPendingStageRecord();
  }
  return stages;
}

export function createSuperPlanState(prompt: string): SuperPlanState {
  const slug = slugFromSuperPlanPrompt(prompt);
  return {
    slug,
    prompt: prompt.trim(),
    activeStage: 'grill',
    stages: createInitialSuperPlanStages(),
    specPath: superPlanSpecPath(slug),
    researchPath: superPlanResearchPath(slug),
    planPath: superPlanPlanPath(slug),
    uiInvolved: detectUiInvolvement(prompt),
  };
}

export function detectUiInvolvement(text: string): boolean {
  return planInvolvesUi(text);
}

export function getSuperPlanState(chat: Chat): SuperPlanState | undefined {
  return chat.superPlan;
}

export function ensureSuperPlanState(chat: Chat): SuperPlanState {
  if (!chat.superPlan) {
    throw new Error('Super Plan state is not initialized on this chat');
  }
  return chat.superPlan;
}

export function initSuperPlanState(chat: Chat, prompt: string): SuperPlanState {
  const state = createSuperPlanState(prompt);
  chat.superPlan = state;
  touchChat(chat);
  scheduleSaveSessions();
  return state;
}

export function getSuperPlanChat(chatId: string): Chat | undefined {
  const chat = findChatById(chatId);
  if (!chat?.superPlan) return undefined;
  return chat;
}

export function patchSuperPlanState(
  chat: Chat,
  patch: Partial<SuperPlanState>,
): SuperPlanState {
  const current = ensureSuperPlanState(chat);
  chat.superPlan = { ...current, ...patch };
  touchChat(chat);
  scheduleSaveSessions();
  return chat.superPlan;
}

export function setSuperPlanActiveStage(
  chat: Chat,
  stage: SuperPlanStageId,
): SuperPlanState {
  return patchSuperPlanState(chat, { activeStage: stage });
}

export function patchSuperPlanStage(
  chat: Chat,
  stageId: SuperPlanStageId,
  patch: Partial<SuperPlanStageRecord>,
): SuperPlanStageRecord {
  const state = ensureSuperPlanState(chat);
  const prev = state.stages[stageId] ?? createPendingStageRecord();
  const next: SuperPlanStageRecord = { ...prev, ...patch };
  chat.superPlan = {
    ...state,
    stages: { ...state.stages, [stageId]: next },
  };
  touchChat(chat);
  scheduleSaveSessions();
  return next;
}

export function markSuperPlanStageStatus(
  chat: Chat,
  stageId: SuperPlanStageId,
  status: SuperPlanStageStatus,
  extra: Partial<SuperPlanStageRecord> = {},
): SuperPlanStageRecord {
  const now = Date.now();
  const prev = ensureSuperPlanState(chat).stages[stageId];
  const patch: Partial<SuperPlanStageRecord> = { status, ...extra };
  if (status === 'running' && !prev?.startedAt) {
    patch.startedAt = now;
  }
  if (status === 'done' || status === 'error' || status === 'blocked_user') {
    patch.finishedAt = now;
  }
  return patchSuperPlanStage(chat, stageId, patch);
}

export function resetSuperPlanStage(chat: Chat, stageId: SuperPlanStageId): void {
  patchSuperPlanStage(chat, stageId, createPendingStageRecord());
}

export function cancelSuperPlanState(chat: Chat): void {
  patchSuperPlanState(chat, { cancelled: true });
  const state = ensureSuperPlanState(chat);
  const active = state.stages[state.activeStage];
  if (active && active.status !== 'done') {
    markSuperPlanStageStatus(chat, state.activeStage, 'error', {
      error: 'Cancelled by user',
    });
  }
}
