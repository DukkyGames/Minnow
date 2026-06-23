/**
 * Workspace-relative orchestrate plan paths for Super Plan output.
 */

import {
  isExecutableOrchestratePlan,
  ORCHESTRATE_PLANS_PREFIX,
} from '../chat/orchestrate/plan-path';

/** Derive a kebab-case slug from a title or prompt. */
export function slugifySuperPlanTitle(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'super-plan';
}

/** Extract the first markdown H1 for slugging, or fall back to the user prompt. */
export function inferPlanTitleFromMarkdown(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  const title = match?.[1]?.trim();
  if (title) {
    return title;
  }
  return fallback.trim() || 'Super Plan';
}

/** Build `documentation/plans/superplan-<slug>.md` under the plans root. */
export function buildSuperPlanPath(titleOrPrompt: string): string {
  const slug = slugifySuperPlanTitle(titleOrPrompt);
  const path = `${ORCHESTRATE_PLANS_PREFIX}superplan-${slug}.md`;
  if (!isExecutableOrchestratePlan(path)) {
    return `${ORCHESTRATE_PLANS_PREFIX}superplan-plan.md`;
  }
  return path;
}
