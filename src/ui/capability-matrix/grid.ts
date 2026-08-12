/**
 * Capability matrix — scrollable verdict grid with glyphs and conflict hatch.
 */

import type { BenchmarkCampaign } from '../../benchmark/campaign-types.ts';
import {
  capabilityCellHasTranscriptDrillDown,
  resolveCapabilityProbeLookup,
  type CapabilityProbeLookup,
} from '../../benchmark/capabilities/cell-transcript.ts';
import type { CapabilityMatrixViewModel } from '../../benchmark/capabilities/view-model.ts';
import {
  capabilityVerdictGlyph,
  type CapabilityMatrixRowView,
} from '../../benchmark/capabilities/view-model.ts';
import { CAPABILITY_GROUP_LABELS } from '../../benchmark/capabilities/groups.ts';
import { attachCapabilityGridKeyboardNav } from './grid-keyboard.ts';
import {
  capabilityRowMatchesFilter,
  createDefaultGridFilter,
  type CapabilityGridFilter,
} from './grid-toolbar.ts';

function formatColumnScore(score: number | null): string {
  if (score == null) return '—';
  return `${Math.round(score * 100)}%`;
}

function scoreTier(score: number | null): 'none' | 'high' | 'mid' | 'low' {
  if (score == null) return 'none';
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'mid';
  return 'low';
}

export type CapabilityGridSelection = {
  targetKey: string;
  capabilityId: string;
};

export type CapabilityGridOptions = {
  host: HTMLElement;
  model: CapabilityMatrixViewModel;
  campaigns: BenchmarkCampaign[];
  filter?: CapabilityGridFilter;
  getInFlightProbeLookup?: (
    targetKey: string,
    capabilityId: string,
  ) => CapabilityProbeLookup | null;
  onSelectCell: (selection: CapabilityGridSelection) => void;
  onOpenTranscript?: (selection: CapabilityGridSelection) => void;
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

function cellTitle(row: CapabilityMatrixRowView, targetKey: string, index: number): string {
  const cell = row.cells[index];
  if (!cell) return '';
  const parts = [
    row.header,
    cell.verdict,
    cell.source !== 'none' ? `source: ${cell.source}` : '',
    cell.overridesAuto ? 'manual overrides auto' : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function renderCellButton(
  row: CapabilityMatrixRowView,
  targetKey: string,
  index: number,
  rowIndex: number,
  colIndex: number,
  campaigns: BenchmarkCampaign[],
  getInFlightProbeLookup: CapabilityGridOptions['getInFlightProbeLookup'],
  onSelectCell: (selection: CapabilityGridSelection) => void,
  onOpenTranscript: ((selection: CapabilityGridSelection) => void) | undefined,
): HTMLButtonElement {
  const cell = row.cells[index];
  const btn = el('button', 'cap-matrix-grid__cell');
  btn.type = 'button';
  const verdict = cell?.verdict ?? 'untested';
  btn.dataset.verdict = verdict;
  btn.dataset.source = cell?.source ?? 'none';
  btn.dataset.capRow = String(rowIndex);
  btn.dataset.capCol = String(colIndex);
  if (cell?.overridesAuto) btn.classList.add('cap-matrix-grid__cell--conflict');
  if (row.scoreMode === 'manual') btn.classList.add('cap-matrix-grid__cell--manual-row');
  btn.textContent = capabilityVerdictGlyph(verdict);
  const lookup = resolveCapabilityProbeLookup(
    campaigns,
    targetKey,
    row.capabilityId,
    getInFlightProbeLookup?.(targetKey, row.capabilityId) ?? null,
  );
  const canTranscript = capabilityCellHasTranscriptDrillDown(lookup);
  if (canTranscript) btn.dataset.capTranscript = '1';
  let title = cellTitle(row, targetKey, index);
  if (canTranscript) title += ' · Alt+Enter: probe transcript';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', () => {
    onSelectCell({ targetKey, capabilityId: row.capabilityId });
  });
  if (onOpenTranscript && canTranscript) {
    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.altKey) {
        ev.preventDefault();
        onOpenTranscript({ targetKey, capabilityId: row.capabilityId });
      }
    });
  }
  return btn;
}

/** Model columns at or below this count expand to fill the grid pane. */
const SPARSE_COLUMN_THRESHOLD = 8;

/** Render sticky-header grid for the current view-model. */
export function renderCapabilityMatrixGrid(options: CapabilityGridOptions): () => void {
  const { host, model, campaigns, onSelectCell, onOpenTranscript, getInFlightProbeLookup } =
    options;
  const filter = options.filter ?? createDefaultGridFilter();
  host.replaceChildren();
  host.className = 'cap-matrix-grid-wrap';

  if (!model.targetKeys.length) {
    host.appendChild(
      el('p', 'cap-matrix-grid__empty', 'Add models to the roster to populate the grid.'),
    );
    return () => {};
  }

  const visibleRows = model.rows.filter((row) => capabilityRowMatchesFilter(row, filter));
  if (!visibleRows.length) {
    host.appendChild(
      el(
        'p',
        'cap-matrix-grid__filter-empty',
        'No capabilities match the current filter. Clear search or enable more groups.',
      ),
    );
    return () => {};
  }

  const scroll = el('div', 'cap-matrix-grid__scroll');
  const table = el('div', 'cap-matrix-grid');
  table.setAttribute('role', 'grid');
  table.setAttribute('aria-label', 'Capability matrix');
  const colCount = model.targetKeys.length;
  table.style.setProperty('--cap-matrix-cols', String(colCount));
  if (colCount <= SPARSE_COLUMN_THRESHOLD) {
    table.classList.add('cap-matrix-grid--sparse');
  } else {
    table.classList.add('cap-matrix-grid--dense');
  }

  const headerRow = el('div', 'cap-matrix-grid__row cap-matrix-grid__row--header');
  const corner = el('div', 'cap-matrix-grid__corner', 'Capability');
  headerRow.appendChild(corner);

  for (const targetKey of model.targetKeys) {
    const col = el('div', 'cap-matrix-grid__col-head');
    const label = el('span', 'cap-matrix-grid__col-label', model.targetLabels[targetKey] ?? targetKey);
    label.title = model.targetLabels[targetKey] ?? targetKey;
    const scoreValue = model.columnScores[targetKey] ?? null;
    const score = el('span', 'cap-matrix-grid__col-score', formatColumnScore(scoreValue));
    const tier = scoreTier(scoreValue);
    if (tier !== 'none') score.dataset.tier = tier;
    col.append(label, score);
    headerRow.appendChild(col);
  }
  table.appendChild(headerRow);

  let lastGroup: string | null = null;
  let rowIndex = 0;
  for (const row of visibleRows) {
    if (row.groupId !== lastGroup) {
      lastGroup = row.groupId;
      const band = el('div', 'cap-matrix-grid__band');
      band.textContent = CAPABILITY_GROUP_LABELS[row.groupId] ?? row.groupId;
      table.appendChild(band);
    }

    const dataRow = el('div', 'cap-matrix-grid__row');
    const labelCell = el('div', 'cap-matrix-grid__row-label');
    const mode = el('span', `cap-matrix-grid__mode cap-matrix-grid__mode--${row.scoreMode}`);
    mode.textContent = row.scoreMode === 'manual' ? 'M' : 'A';
    mode.title = row.scoreMode === 'manual' ? 'Manual row' : 'Auto probe row';
    labelCell.append(mode, el('span', 'cap-matrix-grid__row-name', row.header));
    dataRow.appendChild(labelCell);

    model.targetKeys.forEach((targetKey, colIndex) => {
      dataRow.appendChild(
        renderCellButton(
          row,
          targetKey,
          colIndex,
          rowIndex,
          colIndex,
          campaigns,
          getInFlightProbeLookup,
          onSelectCell,
          onOpenTranscript,
        ),
      );
    });
    table.appendChild(dataRow);
    rowIndex += 1;
  }

  scroll.appendChild(table);
  if (colCount <= SPARSE_COLUMN_THRESHOLD) {
    scroll.classList.add('cap-matrix-grid__scroll--sparse');
  } else {
    scroll.classList.add('cap-matrix-grid__scroll--dense');
  }
  host.appendChild(scroll);

  return attachCapabilityGridKeyboardNav(table);
}
