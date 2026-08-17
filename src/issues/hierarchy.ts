/**
 * One-level sub-issue rules and parent rollups.
 *
 * Deeper trees and cycles are rejected at write time so the list never has to
 * invent a nested-nested layout. If the parent is filtered out of the current
 * view, the child still renders as a top-level row (see `nestSubIssues`).
 */

import { isClosedStatus, type IssuesTaxonomy } from './taxonomy';
import type { IssueCard } from '../types';

export type ParentLinkError = {
  ok: false;
  error: string;
};

export type ParentLinkOk = { ok: true };

export type ParentLinkResult = ParentLinkOk | ParentLinkError;

/** Count of direct children whose status is closed vs all children. */
export type SubIssueRollup = {
  done: number;
  total: number;
};

function findById(issues: readonly IssueCard[], id: string): IssueCard | undefined {
  return issues.find((issue) => issue.id === id);
}

/**
 * Whether `childId` may point at `parentId`.
 *
 * Rejects: missing parent, self-parent, a parent that already has a parent
 * (that would be two levels), and a child that already has children (same).
 */
export function validateParentLink(
  childId: string,
  parentId: string | null | undefined,
  issues: readonly IssueCard[],
): ParentLinkResult {
  if (!parentId) return { ok: true };
  if (parentId === childId) {
    return { ok: false, error: 'An issue cannot be its own parent.' };
  }
  const parent = findById(issues, parentId);
  if (!parent) {
    return { ok: false, error: `Unknown parent issue "${parentId}".` };
  }
  if (parent.parentId) {
    return { ok: false, error: 'Sub-issues nest one level only.' };
  }
  const child = findById(issues, childId);
  if (child && issues.some((issue) => issue.parentId === child.id)) {
    return { ok: false, error: 'An issue with sub-issues cannot itself be a sub-issue.' };
  }
  return { ok: true };
}

/** Direct children of `parentId` in store order. */
export function listChildIssues(parentId: string, issues: readonly IssueCard[]): IssueCard[] {
  return issues.filter((issue) => issue.parentId === parentId);
}

/** Closed/total for one parent's direct children. Zero total when it has none. */
export function subIssueRollup(
  parentId: string,
  issues: readonly IssueCard[],
  taxonomy: IssuesTaxonomy,
): SubIssueRollup {
  const children = listChildIssues(parentId, issues);
  let done = 0;
  for (const child of children) {
    if (isClosedStatus(taxonomy, child.status)) done += 1;
  }
  return { done, total: children.length };
}

export type NestedIssueRow = {
  issue: IssueCard;
  /** 0 = top-level in this group; 1 = nested under a visible parent. */
  depth: 0 | 1;
  children: IssueCard[];
  rollup: SubIssueRollup | null;
};

/**
 * Nest children under a parent that is also in `visible`.
 *
 * Children whose parent is missing from `visible` stay top-level so a status
 * (or search) filter cannot hide work that still matches the view.
 */
export function nestSubIssues(
  visible: readonly IssueCard[],
  allIssues: readonly IssueCard[],
  taxonomy: IssuesTaxonomy,
): NestedIssueRow[] {
  const visibleIds = new Set(visible.map((issue) => issue.id));
  const childrenByParent = new Map<string, IssueCard[]>();
  const top: IssueCard[] = [];

  for (const issue of visible) {
    if (issue.parentId && visibleIds.has(issue.parentId)) {
      const bucket = childrenByParent.get(issue.parentId) ?? [];
      bucket.push(issue);
      childrenByParent.set(issue.parentId, bucket);
      continue;
    }
    top.push(issue);
  }

  return top.map((issue) => {
    const children = childrenByParent.get(issue.id) ?? [];
    const rollup = subIssueRollup(issue.id, allIssues, taxonomy);
    return {
      issue,
      depth: 0,
      children,
      rollup: rollup.total > 0 ? rollup : null,
    };
  });
}
