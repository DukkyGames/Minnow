/**
 * Super Plan pipeline stage types — persisted on {@link Chat.superPlan}.
 */

/** Ordered pipeline stages owned by the Super Plan controller. */
export const SUPER_PLAN_STAGE_ORDER = [
  'grill',
  'spec_confirm',
  'research',
  'draft1',
  'review1',
  'draft2',
  'review2',
  'impeccable',
  'finalize',
  'present',
] as const;

export type SuperPlanStageId = (typeof SUPER_PLAN_STAGE_ORDER)[number];

export type SuperPlanStageStatus =
  | 'pending'
  | 'running'
  | 'blocked_user'
  | 'done'
  | 'error';

/** Per-stage record with status, timestamps, and optional artifact pointer. */
export interface SuperPlanStageRecord {
  status: SuperPlanStageStatus;
  startedAt?: number;
  finishedAt?: number;
  /** Workspace-relative path written during this stage. */
  artifactPath?: string;
  error?: string;
}

/** User actions at the two pipeline checkpoints. */
export type SuperPlanCheckpointAction = 'confirm' | 'revise';

/** Persisted Super Plan controller state on a chat. */
export interface SuperPlanState {
  /** Kebab-case basename shared by spec, research, and plan artifacts. */
  slug: string;
  /** Original user prompt that started the pipeline. */
  prompt: string;
  /** Stage currently executing or awaiting user input. */
  activeStage: SuperPlanStageId;
  stages: Record<SuperPlanStageId, SuperPlanStageRecord>;
  /** Whether the plan involves UI surfaces (gates impeccable stage). */
  uiInvolved?: boolean;
  /** Set when the user or controller cancels the pipeline. */
  cancelled?: boolean;
  /** Final plan path under documentation/plans/<slug>.md */
  planPath?: string;
  /** Build spec path under documentation/plans/references/<slug>-spec.md */
  specPath?: string;
  /** Research report path under documentation/plans/references/<slug>-research.md */
  researchPath?: string;
  /** Active Deep Research run id while the research stage is in flight. */
  researchId?: string;
  /** Pass 1 plan-reviewer structured critique (for pass 2 and draft2). */
  review1Critique?: string;
  /** Pass 2 plan-reviewer structured critique (optional audit trail). */
  review2Critique?: string;
}

export function isSuperPlanStageId(value: string): value is SuperPlanStageId {
  return (SUPER_PLAN_STAGE_ORDER as readonly string[]).includes(value);
}

export function nextSuperPlanStage(
  stage: SuperPlanStageId,
): SuperPlanStageId | null {
  const index = SUPER_PLAN_STAGE_ORDER.indexOf(stage);
  if (index < 0 || index >= SUPER_PLAN_STAGE_ORDER.length - 1) return null;
  return SUPER_PLAN_STAGE_ORDER[index + 1]!;
}
