/**
 * Super Plan — shared types for multi-stage plan generation (intake → spec → research → drafts → finalize).
 */

/** Lifecycle stage for a Super Plan run. */
export type SuperPlanStage =
  | 'intake'
  | 'spec'
  | 'research'
  | 'draft1'
  | 'review1'
  | 'draft2'
  | 'review2'
  | 'impeccable'
  | 'finalize'
  | 'done'
  | 'error';

/** Run lifecycle status (includes user gates). */
export type SuperPlanStatus = 'running' | 'awaiting_user' | 'done' | 'error' | 'cancelled';

/** Progress events emitted by the Super Plan controller (Wave 3+). */
export type SuperPlanProgress =
  | { stage: 'intake'; message?: string; percent?: number }
  | {
      stage: 'spec';
      message?: string;
      preview?: string;
      percent?: number;
      /** When true, UI shows Confirm / Revise before continuing. */
      awaitingUser?: boolean;
    }
  | {
      stage: 'research';
      message?: string;
      round?: number;
      researchId?: string;
      percent?: number;
    }
  | {
      stage: 'draft1';
      message?: string;
      preview?: string;
      planPath?: string;
      percent?: number;
    }
  | { stage: 'review1'; message?: string; round?: number; percent?: number }
  | {
      stage: 'draft2';
      message?: string;
      preview?: string;
      planPath?: string;
      percent?: number;
    }
  | { stage: 'review2'; message?: string; round?: number; percent?: number }
  | { stage: 'impeccable'; message?: string; percent?: number }
  | {
      stage: 'finalize';
      message?: string;
      planPath?: string;
      percent?: number;
    }
  | { stage: 'done'; message?: string; planPath?: string }
  | { stage: 'error'; message: string };

/** One intake question shown before the pipeline starts. */
export interface SuperPlanQuestion {
  id: string;
  prompt: string;
  kind: 'single' | 'multi' | 'text';
  options?: string[];
}

/** Structured answers keyed by question id. */
export type SuperPlanQuestionnaireAnswers = Record<string, string | string[]>;

/** Persisted Super Plan run state on the active chat. */
export interface SuperPlanRunState {
  stage: SuperPlanStage;
  userPrompt: string;
  questionnaire?: SuperPlanQuestion[];
  answers?: SuperPlanQuestionnaireAnswers;
  spec?: string;
  researchId?: string;
  /** Inline research brief when not loaded from disk (Wave 4+). */
  researchMarkdown?: string;
  draftPaths?: string[];
  /** Latest draft body before impeccable/finalize (Wave 4+). */
  draftMarkdown?: string;
  reviewNotes?: string[];
  /** UI Designer guidance folded into the final plan (Wave 4). */
  uiGuidance?: string;
  finalPlanPath?: string;
  /** Written plan body for hand-off seeding (Wave 4). */
  finalPlanMarkdown?: string;
  status: SuperPlanStatus;
  startedAt: string;
  error?: string;
}
