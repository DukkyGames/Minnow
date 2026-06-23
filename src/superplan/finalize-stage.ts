/**
 * Super Plan finalize pipeline — impeccable UI shaping, plan write, finish presentation (Wave 4).
 */

import { spawnSubAgent as defaultSpawnSubAgent } from '../agents/orchestrator';
import type { AggregateResult } from '../agents/types';
import {
  formatImpeccablePreflightLine,
  UI_DESIGNER_PREFLIGHT_INSTRUCTION,
} from '../agents/ui-designer/preflight';
import { isExecutableOrchestratePlan } from '../chat/orchestrate/plan-path';
import { executeTool as defaultExecuteTool } from '../tools/client';
import { mountSuperPlanFinishPopout } from './finish-popout';
import { buildSuperPlanPath, inferPlanTitleFromMarkdown } from './plan-slug';
import type { SuperPlanProgress, SuperPlanRunState } from './types';
import { buildTouchesUi } from './ui-detect';
import type { SuperPlanReviseTarget } from './helpers';

type ExecuteToolFn = typeof defaultExecuteTool;
type SpawnSubAgentFn = typeof defaultSpawnSubAgent;

let finalizeExecuteTool: ExecuteToolFn = defaultExecuteTool;
let finalizeSpawnSubAgent: SpawnSubAgentFn = defaultSpawnSubAgent;

/** Test hook: mock tool/spawn calls during finalize. */
export function setFinalizeStageDepsForTests(overrides: {
  executeTool?: ExecuteToolFn;
  spawnSubAgent?: SpawnSubAgentFn;
}): void {
  if (overrides.executeTool) {
    finalizeExecuteTool = overrides.executeTool;
  }
  if (overrides.spawnSubAgent) {
    finalizeSpawnSubAgent = overrides.spawnSubAgent;
  }
}

/** Restore production finalize dependencies after tests. */
export function resetFinalizeStageDepsForTests(): void {
  finalizeExecuteTool = defaultExecuteTool;
  finalizeSpawnSubAgent = defaultSpawnSubAgent;
}

export interface SuperPlanFinalizeContext {
  chatId: string;
  userPrompt: string;
  state: SuperPlanRunState;
  draftMarkdown: string;
  emit: (event: SuperPlanProgress) => void;
  getResultMount: () => HTMLElement | null;
  onRevise?: (target: SuperPlanReviseTarget, notes?: string) => void;
  onClose?: () => void;
  signal?: AbortSignal;
}

let finishPopoutDestroy: (() => void) | null = null;

/** Clear mounted finish popout (test teardown). */
export function destroySuperPlanFinishPopoutForTests(): void {
  finishPopoutDestroy?.();
  finishPopoutDestroy = null;
}

function isAggregateResult(result: unknown): result is AggregateResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'summary' in result &&
    typeof (result as AggregateResult).summary === 'string'
  );
}

function buildImpeccableTask(spec: string, research: string | undefined, draft: string): string {
  const preflight = formatImpeccablePreflightLine(
    {
      mutation: 'closed',
      imageGate: 'skipped:plan_mode',
      commandReference: 'not_required',
      shape: 'not_required',
    },
    'plan',
  );

  return [
    'You are the UI Designer work agent in **plan mode** (no file edits).',
    'Review the build specification, research, and draft plan below.',
    'Produce concise UI/UX guidance for the orchestrator: layout, components, tokens, accessibility, and polish notes.',
    'Return markdown only — a section body suitable for "## UI design guidance" (do not repeat the heading).',
  '',
    UI_DESIGNER_PREFLIGHT_INSTRUCTION,
    preflight,
    '',
    '### Build specification',
    spec.trim() || '(none)',
    '',
    '### Research notes',
    research?.trim() || '(none)',
    '',
    '### Draft plan',
    draft.trim(),
  ].join('\n');
}

/** Run UI Designer (plan mode) when the build touches UI; returns guidance or empty string. */
export async function runImpeccableStage(ctx: SuperPlanFinalizeContext): Promise<string> {
  const { spec, researchId } = ctx.state;
  const specText = spec ?? '';
  const researchText = ctx.state.researchMarkdown ?? '';
  const draft = ctx.draftMarkdown;

  if (!buildTouchesUi(specText, researchText, draft)) {
    ctx.emit({ stage: 'impeccable', message: 'No UI surfaces detected — skipping UI design pass' });
    return '';
  }

  ctx.emit({ stage: 'impeccable', message: 'Running UI Designer (plan mode)…' });
  if (ctx.signal?.aborted) {
    throw new DOMException('Super Plan cancelled', 'AbortError');
  }

  const task = buildImpeccableTask(specText, researchText, draft);
  const result = await finalizeSpawnSubAgent({
    type: 'ui-designer',
    task,
    wait: true,
    parentChatId: ctx.chatId,
    modeId: 'plan',
  });

  if (!isAggregateResult(result)) {
    ctx.emit({ stage: 'impeccable', message: 'UI Designer did not return guidance' });
    return '';
  }

  if (result.status === 'cancelled' || result.status === 'failed') {
    const err = result.error ?? 'UI Designer pass failed';
    throw new Error(err);
  }

  const guidance = result.summary.trim();
  ctx.state.uiGuidance = guidance;
  ctx.emit({
    stage: 'impeccable',
    message: guidance ? 'UI design guidance added to plan' : 'UI Designer completed (no extra notes)',
  });
  return guidance;
}

/** Persist final plan markdown under documentation/plans and validate path. */
export async function writeFinalPlanFile(
  chatId: string,
  planMarkdown: string,
  titleSeed: string,
): Promise<string> {
  const planPath = buildSuperPlanPath(titleSeed);
  if (!isExecutableOrchestratePlan(planPath)) {
    throw new Error(`Generated plan path is not executable: ${planPath}`);
  }

  const save = await finalizeExecuteTool(
    'save_file',
    { path: planPath, content: planMarkdown },
    { chatId, modeId: 'plan' },
  );
  if (save.content.toLowerCase().includes('error')) {
    throw new Error(save.content.trim() || 'save_file failed');
  }
  return planPath;
}

/** Mount finish popout in the desktop result body. */
export function presentSuperPlanFinish(
  ctx: SuperPlanFinalizeContext,
  planMarkdown: string,
  planPath: string,
  handoffs: {
    onStartOrchestrator: () => void;
    onSendToBuild: () => void;
  },
): void {
  const mount = ctx.getResultMount();
  if (!mount) {
    return;
  }

  finishPopoutDestroy?.();
  const popout = mountSuperPlanFinishPopout(mount, {
    planMarkdown,
    planPath,
    onRevise: (notes) => {
      const target = resolveReviseTarget(notes);
      ctx.onRevise?.(target, notes);
    },
    onStartOrchestrator: handoffs.onStartOrchestrator,
    onSendToBuild: handoffs.onSendToBuild,
    onClose: () => {
      popout.destroy();
      finishPopoutDestroy = null;
      ctx.onClose?.();
    },
  });
  finishPopoutDestroy = () => popout.destroy();
}

/**
 * Impeccable → finalize → write plan → mount finish popout.
 * Call after review2 when draft markdown is ready.
 */
export async function runImpeccableAndFinalize(
  ctx: SuperPlanFinalizeContext,
  handoffs: {
    onStartOrchestrator: (planPath: string) => void;
    onSendToBuild: (planPath: string, planMarkdown: string) => void;
  },
): Promise<{ planPath: string; planMarkdown: string }> {
  const guidance = await runImpeccableStage(ctx);
  const merged = foldUiGuidanceIntoPlan(ctx.draftMarkdown, guidance);
  const titleSeed = inferPlanTitleFromMarkdown(merged, ctx.userPrompt);

  ctx.emit({ stage: 'finalize', message: 'Writing final plan…' });
  const planPath = await writeFinalPlanFile(ctx.chatId, merged, titleSeed);

  if (!isExecutableOrchestratePlan(planPath)) {
    throw new Error(`Plan path failed validation: ${planPath}`);
  }

  ctx.state.finalPlanPath = planPath;
  ctx.state.finalPlanMarkdown = merged;
  ctx.state.stage = 'done';
  ctx.state.status = 'done';

  ctx.emit({ stage: 'finalize', planPath, message: `Saved ${planPath}` });
  ctx.emit({ stage: 'done', planPath, message: 'Super Plan complete' });

  presentSuperPlanFinish(ctx, merged, planPath, {
    onStartOrchestrator: () => handoffs.onStartOrchestrator(planPath),
    onSendToBuild: () => handoffs.onSendToBuild(planPath, merged),
  });

  return { planPath, planMarkdown: merged };
}
