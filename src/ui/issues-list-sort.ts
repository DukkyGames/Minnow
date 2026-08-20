/**
 * List-view column sorting for the Issues app.
 * Pure helpers so UI and tests share the same compare rules.
 */

import type { IssueCard } from '../types';
import { issueIdKeyPrefix, issueIdNumericSuffix } from '../issues/project-key';
import {
  createDefaultIssuesTaxonomy,
  sortedPriorities,
  sortedStatuses,
  sortedTypes,
  type IssuesTaxonomy,
} from '../issues/taxonomy';

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

/**
 * Rank lookups for the taxonomy columns.
 *
 * These used to be object literals keyed on the seed ids, which meant any
 * status, type, or priority the user added in Settings resolved to `undefined`
 * and every comparison involving it evaluated to `NaN` — a sort that silently
 * scrambled rather than failing. Ranks now come from the catalog's own `order`,
 * which is the field Settings already edits.
 */
export interface IssuesSortRanks {
  status: ReadonlyMap<string, number>;
  priority: ReadonlyMap<string, number>;
  type: ReadonlyMap<string, number>;
}

function rankMap(items: readonly { id: string }[]): Map<string, number> {
  const map = new Map<string, number>();
  items.forEach((item, index) => map.set(item.id, index));
  return map;
}

/** Build rank lookups from the live taxonomy. */
export function buildIssuesSortRanks(taxonomy: IssuesTaxonomy): IssuesSortRanks {
  return {
    status: rankMap(sortedStatuses(taxonomy)),
    // Priority is authored most-severe-first, and `desc` must put urgent on top,
    // so the rank is inverted here rather than at every comparison site.
    priority: rankMap([...sortedPriorities(taxonomy)].reverse()),
    type: rankMap(sortedTypes(taxonomy)),
  };
}

/**
 * Ranks used when no taxonomy is supplied.
 *
 * The seed catalog, not an empty map: callers that predate the taxonomy
 * argument must keep sorting by workflow order rather than falling back to
 * alphabetical. Built once, lazily, so importing this module stays free.
 */
let seedRanks: IssuesSortRanks | null = null;

function defaultRanks(): IssuesSortRanks {
  seedRanks ??= buildIssuesSortRanks(createDefaultIssuesTaxonomy());
  return seedRanks;
}

/**
 * Rank an id, sorting anything the catalog has since dropped to the end
 * rather than into the middle on a `NaN`.
 */
function rankOf(ranks: ReadonlyMap<string, number>, id: string): number {
  return ranks.get(id) ?? Number.MAX_SAFE_INTEGER;
}

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
export function compareIssuesBySortKey(
  a: IssueCard,
  b: IssueCard,
  key: IssuesSortKey,
  ranks: IssuesSortRanks = defaultRanks(),
): number {
  switch (key) {
    case 'id':
      return (
        compareStrings(issueIdKeyPrefix(a.id), issueIdKeyPrefix(b.id)) ||
        issueIdNumber(a.id) - issueIdNumber(b.id) ||
        compareStrings(a.id, b.id)
      );
    case 'type':
      return (
        rankOf(ranks.type, a.type) - rankOf(ranks.type, b.type) ||
        compareStrings(a.type, b.type)
      );
    case 'title':
      return compareStrings(a.title, b.title);
    case 'status':
      return (
        rankOf(ranks.status, a.status) - rankOf(ranks.status, b.status) ||
        compareStrings(a.status, b.status)
      );
    case 'priority':
      return (
        rankOf(ranks.priority, a.priority) - rankOf(ranks.priority, b.priority) ||
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
export function sortIssuesForList(
  issues: IssueCard[],
  sort: IssuesListSort,
  taxonomy?: IssuesTaxonomy,
): IssueCard[] {
  const ranks = taxonomy ? buildIssuesSortRanks(taxonomy) : defaultRanks();
  const directionFactor = sort.direction === 'asc' ? 1 : -1;
  return [...issues].sort((a, b) => {
    const primary = compareIssuesBySortKey(a, b, sort.key, ranks) * directionFactor;
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
