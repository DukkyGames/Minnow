import { normalizeOrchestratePlanPath } from '../plans/plan-path';
import { findGroupById } from '../../state/chat-groups';
import { findChatById, scheduleSaveSessions, touchChat } from '../../state/sessions';
import type { Chat } from '../../types';
import { executeTool } from '../../tools/client';
import { planInvolvesUi } from './review-helpers';
import { syncSuperPlanChatTitle } from './plan-library';
import {
  createInterimPlanSlug,
  ensureUniquePlanSlug,
  extractPlanMarkdownTitle,
  slugFromPlanTitle,
} from './plan-slug';
import {
  superPlanPlanPath,
  superPlanResearchPath,
  superPlanSpecPath,
} from './state-paths';
import {
  SUPER_PLAN_STAGE_ORDER,
  type SuperPlanStageId,
  type SuperPlanStageRecord,
  type SuperPlanStageStatus,
  type SuperPlanState,
} from './types';

export {
  superPlanPlanPath,
  superPlanResearchPath,
  superPlanSpecPath,
} from './state-paths';

// ── Create ───────────────────────────────────────────────────────────────────

/** @deprecated Prompt-derived slugs; tests only — use {@link createInterimPlanSlug}. */
export function slugFromSuperPlanPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'super-plan';
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
  const slug = createInterimPlanSlug();
  return {
    slug,
    // Identity for Activity persist — must not change when the slug is renamed.
    runStartedAt: Date.now(),
    prompt: prompt.trim(),
    activeStage: 'grill',
    stages: createInitialSuperPlanStages(),
    specPath: superPlanSpecPath(slug),
    researchPath: superPlanResearchPath(slug),
    planPath: superPlanPlanPath(slug),
    uiInvolved: detectUiInvolvement(prompt),
  };
}

/** Stable key for one pipeline instance (slug changes after spec confirm). */
export function superPlanRunKey(state: SuperPlanState): string {
  if (typeof state.runStartedAt === 'number' && Number.isFinite(state.runStartedAt)) {
    return `t:${state.runStartedAt}`;
  }
  // Legacy rows persisted before runStartedAt: slug+prompt is unique enough
  // until the spec-confirm rename, which those rows already survived.
  return `s:${state.slug}\0${state.prompt}`;
}

export function detectUiInvolvement(text: string): boolean {
  return planInvolvesUi(text);
}

// ── Access ───────────────────────────────────────────────────────────────────

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
  // Stamp an interim "Plan <slug>" name so the Code sidebar can list this run
  // before the build spec exists.
  syncSuperPlanChatTitle(chat);
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

async function readWorkspaceFile(path: string): Promise<string> {
  try {
    const result = await executeTool('read_file', { path });
    return result.content?.trim() ?? '';
  } catch {
    return '';
  }
}

async function workspaceFileExists(path: string): Promise<boolean> {
  try {
    const result = await executeTool('get_file_metadata', { path });
    const content = typeof result.content === 'string' ? result.content : '';
    return !content.trim().startsWith('Error:');
  } catch {
    return false;
  }
}

async function probePlanFileExists(planPath: string): Promise<boolean> {
  return workspaceFileExists(planPath);
}

// ── Reconcile ────────────────────────────────────────────────────────────────

/**
 * After the build spec is confirmed, rename artifacts from the interim slug to a title-based slug.
 */
export async function reconcileSuperPlanSlugFromSpec(chat: Chat): Promise<void> {
  const state = chat.superPlan;
  if (!state?.specPath?.trim()) return;

  const specContent = await readWorkspaceFile(state.specPath);
  const title = extractPlanMarkdownTitle(specContent, '');
  if (!title) return;

  const oldSlug = state.slug;
  const oldPlan = state.planPath ?? superPlanPlanPath(oldSlug);
  const oldSpec = state.specPath;
  const oldResearch = state.researchPath ?? superPlanResearchPath(oldSlug);

  const nextSlug = await ensureUniquePlanSlug(title, [oldPlan, oldSpec, oldResearch], probePlanFileExists);
  const newPlan = superPlanPlanPath(nextSlug);
  const newSpec = superPlanSpecPath(nextSlug);
  const newResearch = superPlanResearchPath(nextSlug);

  if (nextSlug !== oldSlug) {
    const moves: Array<{ from: string; to: string }> = [
      { from: oldSpec, to: newSpec },
      { from: oldResearch, to: newResearch },
      { from: oldPlan, to: newPlan },
    ];
    for (const { from, to } of moves) {
      if (from === to) continue;
      if (!(await workspaceFileExists(from))) continue;
      await executeTool('move_file', { source: from, destination: to });
    }
  }

  patchSuperPlanState(chat, {
    slug: nextSlug,
    displayTitle: title,
    specPath: newSpec,
    researchPath: newResearch,
    planPath: newPlan,
  });
  // runStartedAt is unchanged — Activity persist still belongs to this run.
  syncSuperPlanChatTitle(chat);

  const normalizedOldPlan = normalizeOrchestratePlanPath(oldPlan);
  const fromChat = normalizeOrchestratePlanPath(chat.orchestratePlanPath ?? '');
  if (normalizedOldPlan && fromChat === normalizedOldPlan) {
    chat.orchestratePlanPath = newPlan;
    touchChat(chat);
  }
  const groupId = chat.groupId?.trim();
  if (groupId && normalizedOldPlan) {
    const group = findGroupById(groupId);
    const fromGroup = group
      ? normalizeOrchestratePlanPath(group.orchestratePlanPath ?? '')
      : undefined;
    if (group && fromGroup === normalizedOldPlan) {
      group.orchestratePlanPath = newPlan;
      scheduleSaveSessions({ groupId: group.id });
    }
  }

  const specRecord = chat.superPlan?.stages.spec_confirm;
  if (specRecord?.artifactPath && specRecord.artifactPath === oldSpec) {
    patchSuperPlanStage(chat, 'spec_confirm', { artifactPath: newSpec });
  }
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
  const state = ensureSuperPlanState(chat);
  chat.superPlan = {
    ...state,
    stages: { ...state.stages, [stageId]: createPendingStageRecord() },
  };
  touchChat(chat);
  scheduleSaveSessions();
}

// ── Pause ────────────────────────────────────────────────────────────────────

export function setSuperPlanPaused(chat: Chat, paused: boolean): SuperPlanState {
  return patchSuperPlanState(chat, { paused });
}

export function isSuperPlanPipelineOwningChatTurns(chat: Chat): boolean {
  const sp = chat.superPlan;
  if (!sp || sp.cancelled || sp.paused) return false;
  if (sp.stages.present?.status === 'done') return false;
  return true;
}

export function cancelSuperPlanState(chat: Chat): void {
  patchSuperPlanState(chat, { cancelled: true, paused: false });
  const state = ensureSuperPlanState(chat);
  const active = state.stages[state.activeStage];
  if (active && active.status !== 'done') {
    markSuperPlanStageStatus(chat, state.activeStage, 'error', {
      error: 'Cancelled by user',
    });
  }
}

/** Reset `stageId` and every later stage to pending (rework support). */
export function rewindSuperPlanStages(chat: Chat, stageId: SuperPlanStageId): SuperPlanState {
  const state = ensureSuperPlanState(chat);
  const startIndex = SUPER_PLAN_STAGE_ORDER.indexOf(stageId);
  if (startIndex < 0) return state;
  const stages = { ...state.stages };
  for (let i = startIndex; i < SUPER_PLAN_STAGE_ORDER.length; i += 1) {
    stages[SUPER_PLAN_STAGE_ORDER[i]!] = createPendingStageRecord();
  }
  const reviewIndex = SUPER_PLAN_STAGE_ORDER.indexOf('review1');
  const review2Index = SUPER_PLAN_STAGE_ORDER.indexOf('review2');
  chat.superPlan = {
    ...state,
    activeStage: stageId,
    stages,
    paused: false,
    ...(startIndex <= reviewIndex ? { review1Critique: undefined } : {}),
    ...(startIndex <= review2Index ? { review2Critique: undefined } : {}),
    ...(startIndex <= SUPER_PLAN_STAGE_ORDER.indexOf('research')
      ? { researchId: undefined }
      : {}),
  };
  touchChat(chat);
  scheduleSaveSessions();
  return chat.superPlan;
}

export { slugFromPlanTitle };
