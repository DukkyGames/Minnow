import { composeImpeccableSkillBody } from '../../skills/impeccable-client';
import { planInvolvesUi, type SuperPlanReviewContext } from './review-helpers';

export type SuperPlanImpeccableCommand = 'shape' | 'critique';

export interface SuperPlanImpeccableContext extends SuperPlanReviewContext {
  /** Surface hint for `/impeccable shape|critique <target>` — defaults from plan title or "Super Plan UI". */
  surfaceHint?: string;
}

const DEFAULT_IMPECCABLE_ADDENDUM = `# Super Plan — Impeccable UI stage

This stage runs inside Super Plan when the spec, research, or draft plan involves UI surfaces.
Follow the injected Impeccable harness workflow. Planning only — do not edit application files in Super Plan mode.
Use findings to refine UI-related tasks in the plan markdown (components, routes, tokens, accessibility).`;

function formatPlanContextBlock(context: SuperPlanImpeccableContext): string {
  const parts: string[] = ['## Super Plan context (for Impeccable stage)'];
  if (context.planPath) parts.push(`- Plan path: \`${context.planPath}\``);
  if (context.buildSpecPath) parts.push(`- Build spec: \`${context.buildSpecPath}\``);
  if (context.researchArtifactPath) {
    parts.push(`- Research: \`${context.researchArtifactPath}\``);
  }
  if (context.spec?.trim()) {
    parts.push('', '### Build spec excerpt', context.spec.trim());
  }
  if (context.research?.trim()) {
    parts.push('', '### Research excerpt', context.research.trim());
  }
  if (context.draftPlan?.trim()) {
    parts.push('', '### Draft plan excerpt', context.draftPlan.trim());
  }
  return parts.join('\n');
}

function inferImpeccableTarget(context: SuperPlanImpeccableContext): string {
  if (context.surfaceHint?.trim()) return context.surfaceHint.trim();
  const titleMatch = context.draftPlan?.match(/^#\s+(.+)$/m);
  if (titleMatch?.[1]?.trim()) return titleMatch[1].trim();
  if (context.planPath) {
    const base = context.planPath.split('/').pop()?.replace(/\.md$/i, '');
    if (base) return base.replace(/-/g, ' ');
  }
  return 'Super Plan UI surfaces';
}

export async function composeSuperPlanImpeccableStage(
  command: SuperPlanImpeccableCommand,
  context: SuperPlanImpeccableContext,
  minnowAddendum: string = DEFAULT_IMPECCABLE_ADDENDUM,
): Promise<string | null> {
  if (
    !planInvolvesUi(context.spec, context.research, context.draftPlan, context.surfaceHint)
  ) {
    return null;
  }

  const target = inferImpeccableTarget(context);
  const userText = `/impeccable ${command} ${target}`;
  const addendum = `${minnowAddendum.trim()}\n\n${formatPlanContextBlock(context)}`;
  return composeImpeccableSkillBody(addendum, userText);
}

/** Whether the optional Impeccable stage should run for this Super Plan context. */
export function shouldRunImpeccableStage(context: SuperPlanImpeccableContext): boolean {
  return planInvolvesUi(
    context.spec,
    context.research,
    context.draftPlan,
    context.surfaceHint,
  );
}
