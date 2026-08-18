/**
 * Detect workspace plan markdown paths when filing issue links.
 *
 * Executable plans live under documentation/plans/ (see orchestrate plan-path).
 * When a user drags or captures one onto an issue, it belongs on planPath, not
 * in the code-links list beside source files.
 */

import { normalizeOrchestratePlanPath } from '../chat/orchestrate/plan-path';
import type { IssueCard, IssueCodeRef } from '../types';

/** Normalize a workspace-relative path to a canonical issue plan path, if any. */
export function normalizeIssuePlanPath(path: string): string | undefined {
  return normalizeOrchestratePlanPath(path);
}

/** Resolved plan path from explicit planPath or a linked plan markdown file. */
export function inferIssuePlanPath(
  issue: Pick<IssueCard, 'planPath' | 'codeRefs'>,
): string | undefined {
  const explicit = issue.planPath?.trim();
  if (explicit) {
    return normalizeIssuePlanPath(explicit) ?? explicit.replace(/\\/g, '/');
  }
  for (const ref of issue.codeRefs ?? []) {
    const plan = normalizeIssuePlanPath(ref.path);
    if (plan) return plan;
  }
  return undefined;
}

/** True when a code ref points at the issue's plan markdown (whole file). */
export function isIssuePlanCodeRef(ref: IssueCodeRef, planPath?: string): boolean {
  const normalized = normalizeIssuePlanPath(ref.path);
  if (!normalized) return false;
  if (!planPath) return true;
  const target = normalizeIssuePlanPath(planPath) ?? planPath.replace(/\\/g, '/');
  return normalized === target;
}

/** Drop plan markdown paths from a code-ref list (they render in the Plan section). */
export function codeRefsExcludingPlan(
  refs: IssueCodeRef[],
  planPath?: string,
): IssueCodeRef[] {
  return refs.filter((ref) => !isIssuePlanCodeRef(ref, planPath));
}
