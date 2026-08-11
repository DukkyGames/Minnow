/**
 * Capability matrix — scrollable verdict grid with glyphs and conflict hatch.
 */

import type { BenchmarkCampaign } from '../../benchmark/campaign-types.ts';
import {
  capabilityCellHasTranscriptDrillDown,
  findLatestCapabilityProbeResult,
} from '../../benchmark/capabilities/cell-transcript.ts';
import type { CapabilityMatrixViewModel } from '../../benchmark/capabilities/view-model.ts';
import {
  capabilityVerdictGlyph,
  type CapabilityMatrixRowView,
} from '../../benchmark/capabilities/view-model.ts';
import { CAPABILITY_GROUP_LABELS } from '../../benchmark/capabilities/groups.ts';
import { attachCapabilityGridKeyboardNav } from './grid-keyboard.ts';

function formatColumnScore(score: number | null): string {
  if (score == null) return '—';
  return `${Math.round(score * 100)}%`;
}

export type CapabilityGridSelection = {
  targetKey: string;
  capabilityId: string;
};

export type CapabilityGridOptions = {
  host: HTMLElement;
  model: CapabilityMatrixViewModel;
  campaigns: BenchmarkCampaign[];
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
  const lookup = findLatestCapabilityProbeResult(campaigns, targetKey, row.capabilityId);
  const canTranscript = capabilityCellHasTranscriptDrillDown(verdict, lookup);
  if (canTranscript) btn.dataset.capTranscript = '1';
  let title = cellTitle(row, targetKey, index);
  if (canTranscript) title += ' · Enter: probe transcript';
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

/** Render sticky-header grid for the current view-model. */
export function renderCapabilityMatrixGrid(options: CapabilityGridOptions): () => void {
  const { host, model, campaigns, onSelectCell, onOpenTranscript } = options;
  host.replaceChildren();
  host.className = 'cap-matrix-grid-wrap';

  if (!model.targetKeys.length) {
    host.appendChild(
      el('p', 'cap-matrix-grid__empty', 'Add models to the roster to populate the grid.'),
    );
    return () => {};
  }

  const scroll = el('div', 'cap-matrix-grid__scroll');
  const table = el('div', 'cap-matrix-grid');
  table.setAttribute('role', 'grid');
  table.setAttribute('aria-label', 'Capability matrix');
  table.style.setProperty('--cap-matrix-cols', String(model.targetKeys.length));

  const headerRow = el('div', 'cap-matrix-grid__row cap-matrix-grid__row--header');
  const corner = el('div', 'cap-matrix-grid__corner', 'Capability');
  headerRow.appendChild(corner);

  for (const targetKey of model.targetKeys) {
    const col = el('div', 'cap-matrix-grid__col-head');
    const label = el('span', 'cap-matrix-grid__col-label', model.targetLabels[targetKey] ?? targetKey);
    const score = el(
      'span',
      'cap-matrix-grid__col-score',
      formatColumnScore(model.columnScores[targetKey] ?? null),
    );
    col.append(label, score);
    headerRow.appendChild(col);
  }
  table.appendChild(headerRow);

  let lastGroup: string | null = null;
  let rowIndex = 0;
  for (const row of model.rows) {
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
    labelCell.append(mode, el('span', '', row.header));
    dataRow.appendChild(labelCell);

    model.targetKeys.forEach((targetKey, index) => {
      dataRow.appendChild(
        renderCellButton(
          row,
          targetKey,
          index,
          rowIndex,
          index,
          campaigns,
          onSelectCell,
          onOpenTranscript,
        ),
      );
    });
    table.appendChild(dataRow);
    rowIndex += 1;
  }

  scroll.appendChild(table);
  host.appendChild(scroll);

  return attachCapabilityGridKeyboardNav(table);
}
