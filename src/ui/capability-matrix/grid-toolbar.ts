/**
 * Capability matrix — grid toolbar (search, group filter, verdict legend).
 */

import { CAPABILITY_GROUP_LABELS, CAPABILITY_GROUP_ORDER } from '../../benchmark/capabilities/groups.ts';
import type { CapabilityGroupId } from '../../benchmark/capabilities/types.ts';
import { capabilityVerdictGlyph } from '../../benchmark/capabilities/view-model.ts';
import type { CapabilityMatrixRowView } from '../../benchmark/capabilities/view-model.ts';

/** Active filters for narrowing visible grid rows. */
export type CapabilityGridFilter = {
  search: string;
  /** When empty, all groups are shown. */
  groupIds: Set<CapabilityGroupId>;
};

export function createDefaultGridFilter(): CapabilityGridFilter {
  return { search: '', groupIds: new Set() };
}

/** Return whether a catalog row should appear under the current filter. */
export function capabilityRowMatchesFilter(
  row: CapabilityMatrixRowView,
  filter: CapabilityGridFilter,
): boolean {
  if (filter.groupIds.size > 0 && !filter.groupIds.has(row.groupId)) {
    return false;
  }
  const query = filter.search.trim().toLowerCase();
  if (!query) return true;
  return (
    row.header.toLowerCase().includes(query) ||
    row.capabilityId.toLowerCase().includes(query)
  );
}

export type CapabilityGridToolbarOptions = {
  host: HTMLElement;
  onFilterChange: (filter: CapabilityGridFilter) => void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Mount search, group checklist, and inline verdict legend above the grid. */
export function mountCapabilityGridToolbar(
  options: CapabilityGridToolbarOptions,
): () => void {
  const { host, onFilterChange } = options;
  host.replaceChildren();
  host.className = 'cap-matrix-grid-toolbar settings-group__body';

  const filter: CapabilityGridFilter = createDefaultGridFilter();

  const notify = (): void => {
    onFilterChange({ ...filter, groupIds: new Set(filter.groupIds) });
  };

  const searchRow = el('div', 'settings-row settings-row--control-only');
  const searchControl = el('div', 'settings-row__control');
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'settings-input';
  searchInput.placeholder = 'Filter capabilities by name or id…';
  searchInput.autocomplete = 'off';
  searchInput.setAttribute('aria-label', 'Filter capabilities');
  searchControl.appendChild(searchInput);
  searchRow.appendChild(searchControl);

  const groupBlock = el('div', 'cap-matrix-grid-toolbar__groups-block');
  const groupHead = el('div', 'cap-matrix-run__filter-head');
  groupHead.appendChild(el('span', 'settings-field-stack__label', 'Show groups'));
  const groupActions = el('div', 'cap-matrix-run__filter-actions');
  const showAllBtn = el('button', 'settings-inline-link', 'All');
  showAllBtn.type = 'button';
  const clearGroupsBtn = el('button', 'settings-inline-link', 'None');
  clearGroupsBtn.type = 'button';
  groupActions.append(showAllBtn, clearGroupsBtn);
  groupHead.appendChild(groupActions);
  groupBlock.appendChild(groupHead);

  const checklist = el('div', 'settings-checklist cap-matrix-grid-toolbar__checklist');
  for (const groupId of CAPABILITY_GROUP_ORDER) {
    const chipLabel = el('label', 'settings-checklist__option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.capGridGroup = groupId;
    chipLabel.append(input, el('span', 'settings-checklist__label-text', CAPABILITY_GROUP_LABELS[groupId]));
    input.addEventListener('change', () => {
      if (input.checked) {
        filter.groupIds.add(groupId);
      } else {
        filter.groupIds.delete(groupId);
      }
      notify();
    });
    checklist.appendChild(chipLabel);
  }
  groupBlock.appendChild(checklist);

  showAllBtn.addEventListener('click', () => {
    for (const input of checklist.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = true;
      filter.groupIds.add(input.dataset.capGridGroup as CapabilityGroupId);
    }
    notify();
  });
  clearGroupsBtn.addEventListener('click', () => {
    for (const input of checklist.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = false;
    }
    filter.groupIds.clear();
    notify();
  });

  const legend = el('div', 'cap-matrix-grid-toolbar__legend');
  legend.setAttribute('aria-label', 'Verdict legend');
  const legendItems: Array<{ glyph: string; label: string; verdict: string }> = [
    { glyph: capabilityVerdictGlyph('pass'), label: 'Pass', verdict: 'pass' },
    { glyph: capabilityVerdictGlyph('partial'), label: 'Partial', verdict: 'partial' },
    { glyph: capabilityVerdictGlyph('fail'), label: 'Fail', verdict: 'fail' },
    { glyph: capabilityVerdictGlyph('n-a'), label: 'N/A', verdict: 'n-a' },
    { glyph: capabilityVerdictGlyph('untested'), label: 'Untested', verdict: 'untested' },
  ];
  for (const item of legendItems) {
    const span = el('span', `cap-matrix-grid-toolbar__legend-item cap-matrix-grid-toolbar__legend-item--${item.verdict}`);
    span.append(el('span', 'cap-matrix-grid-toolbar__legend-glyph', item.glyph), document.createTextNode(item.label));
    legend.appendChild(span);
  }

  searchInput.addEventListener('input', () => {
    filter.search = searchInput.value;
    notify();
  });

  host.append(searchRow, groupBlock, legend);

  return () => {
    searchInput.removeEventListener('input', notify);
  };
}
