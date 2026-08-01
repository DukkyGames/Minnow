/**
 * My Models table column sorting — shared by filterLibrary and tests.
 */

import type { LibraryModel } from './library';

/** Columns that match the installed-models table header (plus publisher for toolbar grouping). */
export type LibraryTableSortKey =
  | 'name'
  | 'maker'
  | 'publisher'
  | 'params'
  | 'quant'
  | 'context'
  | 'size';

export type LibrarySortDirection = 'asc' | 'desc';

export type LibraryListSort = {
  key: LibraryTableSortKey;
  direction: LibrarySortDirection;
};

export const DEFAULT_LIBRARY_LIST_SORT: LibraryListSort = {
  key: 'name',
  direction: 'asc',
};

/** Toolbar preset ids for the sort dropdown (maps to {@link LibraryListSort}). */
export type LibrarySortPreset = 'name' | 'size' | 'params' | 'producer' | 'publisher';

export function sortFromPreset(preset: LibrarySortPreset): LibraryListSort {
  if (preset === 'size') return { key: 'size', direction: 'desc' };
  if (preset === 'params') return { key: 'params', direction: 'desc' };
  if (preset === 'producer') return { key: 'maker', direction: 'asc' };
  if (preset === 'publisher') return { key: 'publisher', direction: 'asc' };
  return { key: 'name', direction: 'asc' };
}

/** True when the active sort matches a toolbar preset (for syncing the select). */
export function presetForSort(sort: LibraryListSort): LibrarySortPreset | null {
  if (sort.key === 'name' && sort.direction === 'asc') return 'name';
  if (sort.key === 'size' && sort.direction === 'desc') return 'size';
  if (sort.key === 'params' && sort.direction === 'desc') return 'params';
  if (sort.key === 'maker' && sort.direction === 'asc') return 'producer';
  if (sort.key === 'publisher' && sort.direction === 'asc') return 'publisher';
  return null;
}

/**
 * First click on a column uses a sensible direction:
 * numeric columns → largest first; text → A→Z.
 */
export function defaultDirectionForSortKey(key: LibraryTableSortKey): LibrarySortDirection {
  if (key === 'size' || key === 'params' || key === 'context') return 'desc';
  return 'asc';
}

/** Toggle direction, or switch column and apply its default first direction. */
export function cycleLibraryListSort(
  current: LibraryListSort,
  nextKey: LibraryTableSortKey,
): LibraryListSort {
  if (current.key === nextKey) {
    return {
      key: nextKey,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    };
  }
  return { key: nextKey, direction: defaultDirectionForSortKey(nextKey) };
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/** Compare two rows by the active sort key (ascending semantics). */
export function compareLibraryBySortKey(
  a: LibraryModel,
  b: LibraryModel,
  key: LibraryTableSortKey,
): number {
  switch (key) {
    case 'name':
      return compareStrings(a.name, b.name) || compareStrings(a.quant, b.quant);
    case 'maker':
      return (
        compareStrings(a.producerName, b.producerName) || compareStrings(a.name, b.name)
      );
    case 'publisher':
      return compareStrings(a.publisher, b.publisher) || compareStrings(a.name, b.name);
    case 'params':
      return (a.paramsB ?? 0) - (b.paramsB ?? 0);
    case 'quant':
      return (
        compareStrings(a.quant || a.format, b.quant || b.format) ||
        compareStrings(a.name, b.name)
      );
    case 'context':
      return (a.contextLength ?? 0) - (b.contextLength ?? 0);
    case 'size':
      return a.sizeBytes - b.sizeBytes;
    default:
      return 0;
  }
}

/** Sort a copy of library rows; ties break on name then quant for stability. */
export function sortLibraryForList(
  models: LibraryModel[],
  sort: LibraryListSort,
): LibraryModel[] {
  const directionFactor = sort.direction === 'asc' ? 1 : -1;
  return [...models].sort((a, b) => {
    const primary = compareLibraryBySortKey(a, b, sort.key) * directionFactor;
    if (primary !== 0) return primary;
    return (
      compareStrings(a.name, b.name) || compareStrings(a.quant, b.quant) || compareStrings(a.id, b.id)
    );
  });
}

/** Map sort state to aria-sort for the active column header. */
export function ariaSortValue(
  sort: LibraryListSort,
  columnKey: LibraryTableSortKey,
): 'ascending' | 'descending' | 'none' {
  if (sort.key !== columnKey) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}
