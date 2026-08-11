/**
 * Settings → Advanced → Capability matrix (workbench inside settings panels).
 */

import '../styles/settings-general.css';
import '../styles/settings-capability-matrix.css';
import { detectConfigServer } from '../config/storage-mode';
import { loadCampaign } from '../benchmark/campaign-persistence.ts';
import {
  clearManualVerdicts,
  loadManualVerdicts,
} from '../benchmark/capabilities/manual-verdicts.ts';
import {
  loadCapabilityMatrixRoster,
  saveCapabilityMatrixRoster,
  type CapabilityMatrixRosterEntry,
} from '../benchmark/capabilities/roster-store.ts';
import { buildCapabilityMatrixViewModel } from '../benchmark/capabilities/view-model.ts';
import { disposeCapabilityMatrixRunView } from '../benchmark/capabilities/matrix-run-controller.ts';
import type { BenchmarkCampaign } from '../benchmark/campaign-types.ts';
import {
  beginAsyncSectionRender,
  isAsyncSectionRenderStale,
} from './settings-section-render-guard';
import {
  appendSettingsDangerZone,
  appendSettingsOfflineHint,
  createSettingsActionsRow,
} from './settings-controls';
import { appConfirm } from './app-dialog';
import { downloadCapabilityMatrixXlsx } from './capability-matrix/export-xlsx.ts';
import { importCapabilityMatrixXlsxFile } from './capability-matrix/import-xlsx.ts';
import { mountCapabilityCellEditor } from './capability-matrix/cell-editor.ts';
import { openCapabilityCellTranscript } from './capability-matrix/cell-transcript.ts';
import { renderCapabilityMatrixGrid } from './capability-matrix/grid.ts';
import {
  createDefaultGridFilter,
  mountCapabilityGridToolbar,
  type CapabilityGridFilter,
} from './capability-matrix/grid-toolbar.ts';
import {
  loadCapabilityMatrixCampaignSummaries,
  renderCapabilityMatrixHistory,
} from './capability-matrix/history-panel.ts';
import { renderCapabilityRosterPanel } from './capability-matrix/roster-panel.ts';
import { mountCapabilityRunPanel } from './capability-matrix/run-panel.ts';
import { setStatus } from './status';
import { closeBenchmarkTranscriptDrawer } from './benchmark-transcript-drawer.ts';

const disposers: Array<() => void> = [];
let disposeCellEditor: (() => void) | null = null;
let disposeRunPanel: (() => void) | null = null;
let disposeGridNav: (() => void) | null = null;
let disposeGridToolbar: (() => void) | null = null;
let gridFilter: CapabilityGridFilter = createDefaultGridFilter();

/** Tear down listeners and child editors before re-render or navigation. */
export function disposeCapabilityMatrix(): void {
  disposeCellEditor?.();
  disposeCellEditor = null;
  disposeRunPanel?.();
  disposeRunPanel = null;
  disposeGridNav?.();
  disposeGridNav = null;
  disposeGridToolbar?.();
  disposeGridToolbar = null;
  closeBenchmarkTranscriptDrawer();
  disposeCapabilityMatrixRunView();
  while (disposers.length) {
    disposers.pop()?.();
  }
}

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

function clearMount(id: string): HTMLElement | null {
  const mount = document.getElementById(id);
  if (!mount) return null;
  mount.replaceChildren();
  return mount;
}

async function loadCampaignBodies(
  ids: string[],
): Promise<BenchmarkCampaign[]> {
  const campaigns: BenchmarkCampaign[] = [];
  for (const id of ids) {
    const row = await loadCampaign(id);
    if (row) campaigns.push(row);
  }
  return campaigns;
}

/** Load data, merge grid, and mount the workbench layout. */
export async function renderCapabilityMatrixSettingsSection(): Promise<void> {
  disposeCapabilityMatrix();
  gridFilter = createDefaultGridFilter();
  const generation = beginAsyncSectionRender('capability-matrix');

  const mount = clearMount('settingsCapabilityMatrixBody');
  if (!mount) return;

  const shell = el('div', 'settings-general settings-general--wide cap-matrix-shell');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.textContent =
    'Compare model capability across your roster. Run auto probes, edit manual cells, and export results.';
  shell.appendChild(lead);

  const headerActions = createSettingsActionsRow(
    [
      {
        label: 'Export .xlsx',
        variant: 'default',
        onClick: () => {
          try {
            downloadCapabilityMatrixXlsx(viewModel, roster, latestManualStore);
            setStatus('ok', 'Workbook downloaded');
          } catch (err) {
            setStatus('err', err instanceof Error ? err.message : 'Export failed');
          }
        },
      },
    ],
    { searchKey: 'advanced.capabilityMatrix.export' },
  );
  const exportBtn = headerActions.querySelector('button');
  if (exportBtn) {
    exportBtn.dataset.settingsSearchKey = 'advanced.capabilityMatrix.export';
  }

  const importLabel = el('label', 'settings-action-btn settings-action-btn--secondary');
  importLabel.textContent = 'Import .xlsx';
  importLabel.dataset.settingsSearchKey = 'advanced.capabilityMatrix.import';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  importInput.hidden = true;
  importLabel.appendChild(importInput);
  headerActions.appendChild(importLabel);

  const xlsxNote = el('p', 'settings-field-hint cap-matrix-xlsx-note');
  xlsxNote.textContent =
    'Export uses SheetJS in the browser. Only cell values and catalog headers are included.';

  const headerRow = el('div', 'cap-matrix-header-row');
  headerRow.append(headerActions, xlsxNote);
  shell.appendChild(headerRow);

  const serverUp = (await detectConfigServer()) === 'server';
  if (isAsyncSectionRenderStale('capability-matrix', generation)) return;

  if (!serverUp) {
    appendSettingsOfflineHint(
      shell,
      'Roster and verdicts sync when Minnow is running locally (npm start).',
    );
  }

  const content = el('div', 'settings-general__content cap-matrix-workbench');
  shell.appendChild(content);

  const body = el('div', 'cap-matrix-workbench__body');

  const rail = el('aside', 'cap-matrix-rail settings-group settings-group--emphasis');
  rail.dataset.settingsSearchKey = 'advanced.capabilityMatrix.roster';

  const rosterSection = el('section', 'cap-matrix-rail__section');
  const rosterTitle = el('h3', 'settings-group__title', 'Models');
  rosterSection.appendChild(rosterTitle);
  rosterSection.appendChild(
    el('p', 'settings-group__lead', 'Grouped by Cloud, LM Studio, or Minnow Hosting.'),
  );
  const rosterHost = el('div', 'cap-matrix-roster-host');
  rosterSection.appendChild(rosterHost);

  const runSection = el('section', 'cap-matrix-rail__section');
  runSection.dataset.settingsSearchKey = 'advanced.capabilityMatrix.run';
  runSection.appendChild(el('h3', 'settings-group__title', 'Run probes'));
  runSection.appendChild(
    el(
      'p',
      'settings-group__lead',
      'Pick capability groups and probe waves, then run auto probes across the roster.',
    ),
  );
  const runHost = el('div', 'cap-matrix-run-host');
  runSection.appendChild(runHost);

  const historyHost = el('div', 'cap-matrix-history-host');
  const railFooter = el('div', 'cap-matrix-rail__footer');
  railFooter.appendChild(historyHost);

  rail.append(rosterSection, runSection, railFooter);

  const main = el('main', 'cap-matrix-main settings-group settings-group--emphasis');
  main.dataset.settingsSearchKey = 'advanced.capabilityMatrix.grid';
  const gridToolbarHost = el('div', 'cap-matrix-grid-toolbar-host');
  const gridHost = el('div', 'cap-matrix-grid-host');
  const editorHost = el('div', 'cap-matrix-cell-editor-host');
  editorHost.hidden = true;
  main.append(gridToolbarHost, gridHost, editorHost);

  body.append(rail, main);
  content.appendChild(body);

  const [rosterData, manualStore, summaries] = await Promise.all([
    loadCapabilityMatrixRoster(),
    loadManualVerdicts(),
    loadCapabilityMatrixCampaignSummaries(),
  ]);
  if (isAsyncSectionRenderStale('capability-matrix', generation)) return;

  let roster: CapabilityMatrixRosterEntry[] = rosterData.targets ?? [];

  const campaignIds = summaries.map((s) => s.id);
  const campaigns = await loadCampaignBodies(campaignIds);
  if (isAsyncSectionRenderStale('capability-matrix', generation)) return;

  let viewModel = buildCapabilityMatrixViewModel({
    roster,
    manualStore,
    campaigns,
  });
  let latestManualStore = manualStore;
  let campaignBodies = campaigns;

  function paintGrid(): void {
    disposeGridNav?.();
    disposeGridNav = renderCapabilityMatrixGrid({
      host: gridHost,
      model: viewModel,
      campaigns: campaignBodies,
      filter: gridFilter,
      onSelectCell: (selection) => {
        disposeCellEditor?.();
        const cell = viewModel.cellByKey.get(
          `${selection.targetKey}::${selection.capabilityId}`,
        );
        if (!cell) return;
        disposeCellEditor = mountCapabilityCellEditor(cell, {
          host: editorHost,
          targetLabel: viewModel.targetLabels[selection.targetKey] ?? selection.targetKey,
          campaigns: campaignBodies,
          onSaved: refreshView,
        });
      },
      onOpenTranscript: (selection) => {
        const cell = viewModel.cellByKey.get(
          `${selection.targetKey}::${selection.capabilityId}`,
        );
        if (!cell) return;
        openCapabilityCellTranscript(
          cell,
          campaignBodies,
          viewModel.targetLabels[selection.targetKey] ?? selection.targetKey,
        );
      },
    });
  }

  async function persistRoster(next: CapabilityMatrixRosterEntry[]): Promise<void> {
    roster = next;
    try {
      setStatus('spin', 'Saving roster…');
      await saveCapabilityMatrixRoster(roster);
      setStatus('ok', 'Roster saved');
    } catch (err) {
      setStatus('err', err instanceof Error ? err.message : 'Roster save failed');
    }
    await refreshView();
  }

  async function refreshView(): Promise<void> {
    if (isAsyncSectionRenderStale('capability-matrix', generation)) return;
    const [manual, history] = await Promise.all([
      loadManualVerdicts(),
      loadCapabilityMatrixCampaignSummaries(),
    ]);
    const bodies = await loadCampaignBodies(history.map((h) => h.id));
    if (isAsyncSectionRenderStale('capability-matrix', generation)) return;

    campaignBodies = bodies;
    viewModel = buildCapabilityMatrixViewModel({
      roster,
      manualStore: manual,
      campaigns: bodies,
    });
    latestManualStore = manual;

    renderCapabilityRosterPanel({
      host: rosterHost,
      roster,
      onRosterChange: persistRoster,
    });
    paintGrid();
    renderCapabilityMatrixHistory(historyHost, history);
  }

  disposeGridToolbar = mountCapabilityGridToolbar({
    host: gridToolbarHost,
    onFilterChange: (next) => {
      gridFilter = next;
      paintGrid();
    },
  });

  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    void (async () => {
      try {
        setStatus('spin', 'Importing workbook…');
        const result = await importCapabilityMatrixXlsxFile(file, roster);
        const warn =
          result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : '';
        setStatus(
          'ok',
          `Imported ${result.importedCount} manual cell${result.importedCount === 1 ? '' : 's'}${warn}`,
        );
        if (result.warnings.length > 0) {
          console.warn('[capability-matrix] import warnings', result.warnings);
        }
        await refreshView();
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : 'Import failed');
      }
    })();
  });

  const clearManualBtn = el(
    'button',
    'settings-action-btn settings-action-btn--danger',
    'Clear manual verdicts',
  );
  clearManualBtn.type = 'button';
  clearManualBtn.dataset.settingsSearchKey = 'advanced.capabilityMatrix.danger';
  clearManualBtn.addEventListener('click', () => {
    void (async () => {
      if (
        !(await appConfirm(
          'Clear all manual capability verdicts? Auto probe results in run history are kept.',
          { confirmLabel: 'Clear manual verdicts' },
        ))
      ) {
        return;
      }
      try {
        setStatus('spin', 'Clearing manual verdicts…');
        await clearManualVerdicts();
        setStatus('ok', 'Manual verdicts cleared');
        await refreshView();
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : 'Clear failed');
      }
    })();
  });

  appendSettingsDangerZone(shell, 'Danger zone', clearManualBtn, {
    searchKey: 'advanced.capabilityMatrix.danger',
  });

  await refreshView();

  disposeRunPanel = mountCapabilityRunPanel({
    host: runHost,
    getRoster: () => roster,
    getViewModel: () => viewModel,
    onRunSettled: refreshView,
  });
}
