/**
 * Capability matrix — manual cell editor (POST upsert).
 */

import { upsertManualVerdict } from '../../benchmark/capabilities/manual-verdicts.ts';
import type { CapabilityVerdict } from '../../benchmark/capabilities/types.ts';
import { getCapabilityById } from '../../benchmark/capabilities/catalog.ts';
import type { MergedCapabilityCell } from '../../benchmark/capabilities/merge.ts';
import type { BenchmarkCampaign } from '../../benchmark/campaign-types.ts';
import { createSettingsSelectRow, createSettingsTextareaRow } from '../settings-controls';
import { setStatus } from '../status';
import { openCapabilityCellTranscript } from './cell-transcript.ts';
import {
  capabilityCellHasTranscriptDrillDown,
  findLatestCapabilityProbeResult,
} from '../../benchmark/capabilities/cell-transcript.ts';

export type CapabilityCellEditorDispose = () => void;

export type CapabilityCellEditorOptions = {
  host: HTMLElement;
  targetLabel: string;
  campaigns: BenchmarkCampaign[];
  onSaved: () => void | Promise<void>;
};

const VERDICT_OPTIONS: { value: CapabilityVerdict; label: string }[] = [
  { value: 'pass', label: 'Pass' },
  { value: 'partial', label: 'Partial' },
  { value: 'fail', label: 'Fail' },
  { value: 'n-a', label: 'N/A' },
  { value: 'untested', label: 'Untested (clear manual)' },
];

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

/** Mount inline editor for one matrix cell; returns dispose. */
export function mountCapabilityCellEditor(
  cell: MergedCapabilityCell,
  options: CapabilityCellEditorOptions,
): CapabilityCellEditorDispose {
  const { host, targetLabel, campaigns, onSaved } = options;
  host.replaceChildren();
  host.className = 'cap-matrix-cell-editor';
  host.hidden = false;

  const def = getCapabilityById(cell.capabilityId);
  const title = el(
    'h4',
    'cap-matrix-cell-editor__title',
    def?.header ?? cell.capabilityId,
  );
  host.appendChild(title);

  const meta = el('p', 'cap-matrix-cell-editor__meta');
  meta.textContent = `${targetLabel} · ${def?.scoreMode === 'manual' ? 'Manual row' : 'Auto row (manual override)'}`;
  host.appendChild(meta);

  if (cell.source === 'auto' || cell.autoVerdict) {
    const autoLine = el('p', 'cap-matrix-cell-editor__auto');
    autoLine.textContent = cell.autoVerdict
      ? `Latest auto: ${cell.autoVerdict}${cell.overridesAuto ? ' (overridden by manual)' : ''}`
      : '';
    if (autoLine.textContent) host.appendChild(autoLine);
  }

  let verdict: CapabilityVerdict = cell.manualVerdict ?? cell.verdict ?? 'untested';
  let note = '';

  const { row: verdictRow, select: verdictSelect } = createSettingsSelectRow('Verdict', {
    options: VERDICT_OPTIONS,
    value: verdict,
    searchKey: 'advanced.capabilityMatrix.cell.verdict',
    onChange: (value) => {
      verdict = value as CapabilityVerdict;
    },
  });
  host.appendChild(verdictRow);

  const { row: noteRow, textarea: noteArea } = createSettingsTextareaRow('Note', {
    value: note,
    searchKey: 'advanced.capabilityMatrix.cell.note',
    onChange: (value) => {
      note = value;
    },
  });
  host.appendChild(noteRow);

  const probeLookup = findLatestCapabilityProbeResult(
    campaigns,
    cell.targetKey,
    cell.capabilityId,
  );
  const showTranscript = capabilityCellHasTranscriptDrillDown(cell.verdict, probeLookup);

  const actions = el('div', 'cap-matrix-cell-editor__actions');
  const transcriptBtn = el('button', 'settings-action-btn', 'View probe transcript');
  transcriptBtn.type = 'button';
  transcriptBtn.hidden = !showTranscript;
  transcriptBtn.addEventListener('click', () => {
    openCapabilityCellTranscript(cell, campaigns, targetLabel);
  });

  const saveBtn = el('button', 'settings-action-btn settings-action-btn--primary', 'Save manual verdict');
  saveBtn.type = 'button';
  const clearBtn = el('button', 'settings-action-btn', 'Close');
  clearBtn.type = 'button';

  saveBtn.addEventListener('click', () => {
    void (async () => {
      try {
        setStatus('spin', 'Saving verdict…');
        await upsertManualVerdict({
          targetKey: cell.targetKey,
          capabilityId: cell.capabilityId,
          verdict,
          note: note.trim() || undefined,
          updatedAt: new Date().toISOString(),
        });
        setStatus('ok', 'Manual verdict saved');
        await onSaved();
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : 'Save failed');
      }
    })();
  });

  clearBtn.addEventListener('click', () => {
    host.hidden = true;
    host.replaceChildren();
  });

  actions.append(transcriptBtn, saveBtn, clearBtn);
  host.appendChild(actions);

  verdictSelect.focus();

  return () => {
    host.replaceChildren();
    host.hidden = true;
  };
}
