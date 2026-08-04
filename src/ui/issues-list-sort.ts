/**
 * List-view column sorting for the Issues app.
 * Pure helpers so UI and tests share the same compare rules.
 */

import type { IssueCard, IssuePriority, IssueStatus, IssueType } from '../types';
import { issueIdKeyPrefix, issueIdNumericSuffix } from '../issues/project-key';

/** Columns that can be sorted from the list header. */
export type IssuesSortKey =
  | 'id'
  | 'type'
  | 'title'
  | 'status'
  | 'priority'
  | 'labels'
  | 'updated';

export type IssuesSortDirection = 'asc' | 'desc';

export type IssuesListSort = {
  key: IssuesSortKey;
  direction: IssuesSortDirection;
};

/** Default list order matches collectIssues (newest updated first). */
export const DEFAULT_ISSUES_LIST_SORT: IssuesListSort = {
  key: 'updated',
  direction: 'desc',
};

/** Workflow order for status sorting (triage → canceled). */
const STATUS_RANK: Record<IssueStatus, number> = {
  triage: 0,
  backlog: 1,
  todo: 2,
  planned: 3,
  in_progress: 4,
  review: 5,
  done: 6,
  canceled: 7,
};

/** Priority severity rank (higher = more severe; descending → urgent first). */
const PRIORITY_RANK: Record<IssuePriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

const TYPE_RANK: Record<IssueType, number> = {
  bug: 0,
  task: 1,
  idea: 2,
  note: 3,
};

/**
 * First click on a column uses a sensible direction:
 * text/id/status → A→Z / workflow; priority/updated → high/newest first.
 */
export function defaultDirectionForSortKey(key: IssuesSortKey): IssuesSortDirection {
  if (key === 'priority' || key === 'updated') return 'desc';
  return 'asc';
}

/** Toggle direction, or switch column and apply its default first direction. */
export function cycleIssuesListSort(
  current: IssuesListSort,
  nextKey: IssuesSortKey,
): IssuesListSort {
  if (current.key === nextKey) {
    return {
      key: nextKey,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    };
  }
  return { key: nextKey, direction: defaultDirectionForSortKey(nextKey) };
}

/** Parse numeric suffix from KEY-n (fallback 0 when missing). */
function issueIdNumber(id: string): number {
  return issueIdNumericSuffix(id);
}

/** Stable string for labels column (joined, case-insensitive). */
function labelsSortValue(issue: IssueCard): string {
  return issue.labels.join(', ').toLowerCase();
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/** Compare two issues by the active sort key (ascending semantics). */
export function compareIssuesBySortKey(a: IssueCard, b: IssueCard, key: IssuesSortKey): number {
  switch (key) {
    case 'id':
      return (
        compareStrings(issueIdKeyPrefix(a.id), issueIdKeyPrefix(b.id)) ||
        issueIdNumber(a.id) - issueIdNumber(b.id) ||
        compareStrings(a.id, b.id)
      );
    case 'type':
      return TYPE_RANK[a.type] - TYPE_RANK[b.type] || compareStrings(a.type, b.type);
    case 'title':
      return compareStrings(a.title, b.title);
    case 'status':
      return STATUS_RANK[a.status] - STATUS_RANK[b.status] || compareStrings(a.status, b.status);
    case 'priority':
      return (
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        compareStrings(a.priority, b.priority)
      );
    case 'labels':
      return compareStrings(labelsSortValue(a), labelsSortValue(b));
    case 'updated':
      return a.updatedAt - b.updatedAt;
    default:
      return 0;
  }
}

/** Sort a copy of issues; ties break on id ascending for stability. */
export function sortIssuesForList(issues: IssueCard[], sort: IssuesListSort): IssueCard[] {
  const directionFactor = sort.direction === 'asc' ? 1 : -1;
  return [...issues].sort((a, b) => {
    const primary = compareIssuesBySortKey(a, b, sort.key) * directionFactor;
    if (primary !== 0) return primary;
    return (
      compareStrings(issueIdKeyPrefix(a.id), issueIdKeyPrefix(b.id)) ||
      issueIdNumber(a.id) - issueIdNumber(b.id) ||
      compareStrings(a.id, b.id)
    );
  });
}

/** Map sort state to aria-sort for the active column header. */
export function ariaSortValue(
  sort: IssuesListSort,
  columnKey: IssuesSortKey,
): 'ascending' | 'descending' | 'none' {
  if (sort.key !== columnKey) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}
