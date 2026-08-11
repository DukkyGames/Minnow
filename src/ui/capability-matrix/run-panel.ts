/**
 * Capability matrix — run controls (filters, progress, target chips).
 */

import {
  CAPABILITY_MATRIX_PROBE_WAVE_LABELS,
  CAPABILITY_MATRIX_PROBE_WAVES,
  allCapabilityGroupIds,
  type CapabilityMatrixProbeWave,
} from '../../benchmark/capabilities/matrix-run-filters.ts';
import {
  abortCapabilityMatrixRun,
  dismissCapabilityMatrixResumeSession,
  getCapabilityMatrixResumeSummary,
  getCapabilityMatrixRunState,
  isCapabilityMatrixRunActive,
  resumeCapabilityMatrixRunFromSession,
  startCapabilityMatrixRun,
  subscribeCapabilityMatrixRun,
  type MatrixRunUiState,
  type MatrixTargetChip,
} from '../../benchmark/capabilities/matrix-run-controller.ts';
import type { CapabilityMatrixRosterEntry } from '../../benchmark/capabilities/roster-store.ts';
import type { CapabilityMatrixViewModel } from '../../benchmark/capabilities/view-model.ts';
import { CAPABILITY_GROUP_LABELS, CAPABILITY_GROUP_ORDER } from '../../benchmark/capabilities/groups.ts';
import type { CapabilityGroupId } from '../../benchmark/capabilities/types.ts';
import { createSettingsActionsRow } from '../settings-controls';
import { createSettingsToggleRow } from '../settings-switch';

export type CapabilityRunPanelOptions = {
  host: HTMLElement;
  getRoster: () => CapabilityMatrixRosterEntry[];
  getViewModel: () => CapabilityMatrixViewModel;
  onRunSettled: () => void | Promise<void>;
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

function readSelectedGroups(root: HTMLElement): CapabilityGroupId[] {
  const boxes = root.querySelectorAll<HTMLInputElement>(
    'input[data-cap-matrix-group]:checked',
  );
  return [...boxes].map((box) => box.dataset.capMatrixGroup as CapabilityGroupId);
}

function readSelectedWaves(root: HTMLElement): CapabilityMatrixProbeWave[] {
  const boxes = root.querySelectorAll<HTMLInputElement>(
    'input[data-cap-matrix-wave]:checked',
  );
  return [...boxes].map((box) => box.dataset.capMatrixWave as CapabilityMatrixProbeWave);
}

function setAllChecked(
  root: HTMLElement,
  selector: string,
  checked: boolean,
): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(selector)) {
    input.checked = checked;
  }
}

function renderTargetChips(container: HTMLElement, chips: MatrixTargetChip[]): void {
  container.replaceChildren();
  if (!chips.length) return;
  const list = el('ul', 'cap-matrix-run__targets');
  for (const chip of chips) {
    const item = el('li', `cap-matrix-run__target cap-matrix-run__target--${chip.state}`);
    const label = el('span', '', chip.label);
    item.appendChild(label);
    if (chip.state === 'skipped' && chip.detail) {
      item.title = chip.detail;
      item.appendChild(el('span', 'cap-matrix-run__target-detail', 'load failed'));
    }
    list.appendChild(item);
  }
  container.appendChild(list);
}

function paintResumeBanner(
  root: HTMLElement,
  onResume: () => void,
  onDismiss: () => void,
): void {
  let banner = root.querySelector<HTMLElement>('.cap-matrix-run__resume');
  const summary = getCapabilityMatrixResumeSummary();
  if (!summary) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = el('div', 'cap-matrix-run__resume settings-server-banner');
    banner.setAttribute('role', 'status');
    root.prepend(banner);
  }
  banner.replaceChildren();
  const text = el(
    'p',
    'cap-matrix-run__resume-text',
    `Interrupted sweep (${summary.campaignId}): ${summary.remainingTargetCount} model(s), ${summary.completedProbeCount} probe(s) done.`,
  );
  const actions = createSettingsActionsRow(
    [
      {
        label: 'Resume sweep',
        variant: 'primary',
        onClick: onResume,
      },
      {
        label: 'Dismiss',
        variant: 'default',
        onClick: onDismiss,
      },
    ],
    { searchKey: 'advanced.capabilityMatrix.run.action' },
  );
  banner.append(text, actions);
}

function buildRunParams(
  host: HTMLElement,
  getRoster: () => CapabilityMatrixRosterEntry[],
  getViewModel: () => CapabilityMatrixViewModel,
  sideEffectsInput: HTMLInputElement,
  skipScoredInput: HTMLInputElement,
  lifecycleInput: HTMLInputElement,
  onSettled: () => void | Promise<void>,
): Omit<import('../../benchmark/capabilities/matrix-run-controller.ts').StartCapabilityMatrixRunParams, 'resumePayload'> {
  return {
    roster: getRoster(),
    viewModel: getViewModel(),
    allowSideEffects: sideEffectsInput.checked,
    skipScored: skipScoredInput.checked,
    groupIds: readSelectedGroups(host).length
      ? readSelectedGroups(host)
      : allCapabilityGroupIds(),
    probeWaves: readSelectedWaves(host).length
      ? readSelectedWaves(host)
      : [...CAPABILITY_MATRIX_PROBE_WAVES],
    manageModelLifecycle: lifecycleInput.checked,
    onSettled: () => {
      void onSettled();
    },
  };
}

function paintRunState(root: HTMLElement, state: MatrixRunUiState): void {
  const progress = root.querySelector<HTMLElement>('.cap-matrix-run__progress');
  const phase = root.querySelector<HTMLElement>('.cap-matrix-run__phase');
  const fill = root.querySelector<HTMLElement>('.cap-matrix-run__progress-fill');
  const detail = root.querySelector<HTMLElement>('.cap-matrix-run__progress-detail');
  const chipsHost = root.querySelector<HTMLElement>('.cap-matrix-run__targets-host');
  const runBtn = root.querySelector<HTMLButtonElement>('[data-cap-matrix-run]');
  const stopBtn = root.querySelector<HTMLButtonElement>('[data-cap-matrix-stop]');

  if (phase) phase.textContent = state.phaseLabel;
  if (progress) {
    progress.hidden = !state.running && state.progressPct === 0;
    progress.setAttribute('aria-valuenow', String(state.progressPct));
  }
  if (fill) fill.style.width = `${state.progressPct}%`;
  if (detail) detail.textContent = state.progressDetail;
  if (chipsHost) renderTargetChips(chipsHost, state.targets);

  const running = state.running;
  if (runBtn) runBtn.disabled = running;
  if (stopBtn) stopBtn.disabled = !running;

  const toggles = root.querySelectorAll<HTMLInputElement>(
    'input[data-cap-matrix-filter], input[data-cap-matrix-group], input[data-cap-matrix-wave]',
  );
  for (const input of toggles) {
    input.disabled = running;
  }
}

function buildChecklistBlock(
  title: string,
  items: Array<{ id: string; label: string; datasetKey: 'capMatrixGroup' | 'capMatrixWave' }>,
  host: HTMLElement,
): HTMLElement {
  const block = el('div', 'cap-matrix-run__filter-block');
  const head = el('div', 'cap-matrix-run__filter-head');
  head.appendChild(el('span', 'settings-field-stack__label', title));

  const actions = el('div', 'cap-matrix-run__filter-actions');
  const allBtn = el('button', 'settings-inline-link', 'All');
  allBtn.type = 'button';
  const noneBtn = el('button', 'settings-inline-link', 'None');
  noneBtn.type = 'button';
  const selector =
    items[0]?.datasetKey === 'capMatrixGroup'
      ? 'input[data-cap-matrix-group]'
      : 'input[data-cap-matrix-wave]';
  allBtn.addEventListener('click', () => setAllChecked(host, selector, true));
  noneBtn.addEventListener('click', () => setAllChecked(host, selector, false));
  actions.append(allBtn, noneBtn);
  head.appendChild(actions);
  block.appendChild(head);

  const checklist = el('div', 'settings-checklist cap-matrix-run__checklist');
  for (const item of items) {
    const label = el('label', 'settings-checklist__option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    if (item.datasetKey === 'capMatrixGroup') {
      input.dataset.capMatrixGroup = item.id;
    } else {
      input.dataset.capMatrixWave = item.id;
    }
    label.append(
      input,
      el('span', 'settings-checklist__label-text', item.label),
    );
    checklist.appendChild(label);
  }
  block.appendChild(checklist);
  return block;
}

/** Mount run filters, actions, and live progress (subscribes to singleton controller). */
export function mountCapabilityRunPanel(options: CapabilityRunPanelOptions): () => void {
  const { host, getRoster, getViewModel, onRunSettled } = options;
  host.replaceChildren();
  host.className = 'cap-matrix-run settings-group__body';

  const filters = el('div', 'cap-matrix-run__filters');

  filters.appendChild(
    buildChecklistBlock(
      'Capability groups',
      CAPABILITY_GROUP_ORDER.map((groupId) => ({
        id: groupId,
        label: CAPABILITY_GROUP_LABELS[groupId],
        datasetKey: 'capMatrixGroup' as const,
      })),
      host,
    ),
  );

  filters.appendChild(
    buildChecklistBlock(
      'Probe waves',
      CAPABILITY_MATRIX_PROBE_WAVES.map((wave) => ({
        id: wave,
        label: CAPABILITY_MATRIX_PROBE_WAVE_LABELS[wave],
        datasetKey: 'capMatrixWave' as const,
      })),
      host,
    ),
  );

  const { row: sideEffectsRow, input: sideEffectsInput } = createSettingsToggleRow(
    'Allow side-effect tools',
    {
      searchKey: 'advanced.capabilityMatrix.run.sideEffects',
      description:
        'Stub destructive tools by default. Enable only for sandbox smoke tests.',
      checked: false,
    },
  );
  sideEffectsInput.dataset.capMatrixFilter = 'sideEffects';
  filters.appendChild(sideEffectsRow);

  const { row: skipScoredRow, input: skipScoredInput } = createSettingsToggleRow(
    'Skip scored cells',
    {
      searchKey: 'advanced.capabilityMatrix.run.skipScored',
      description: 'Skip auto probes where the grid already shows pass, partial, or fail.',
      checked: true,
    },
  );
  skipScoredInput.dataset.capMatrixFilter = 'skipScored';
  filters.appendChild(skipScoredRow);

  const { row: lifecycleRow, input: lifecycleInput } = createSettingsToggleRow(
    'Manage model lifecycle',
    {
      searchKey: 'advanced.capabilityMatrix.run.lifecycle',
      description: 'Auto load/unload local models between targets (LM Studio smoke runs).',
      checked: false,
    },
  );
  lifecycleInput.dataset.capMatrixFilter = 'lifecycle';
  filters.appendChild(lifecycleRow);

  host.appendChild(filters);

  const progress = el('div', 'cap-matrix-run__progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.hidden = true;
  const track = el('div', 'cap-matrix-run__progress-track');
  const fill = el('div', 'cap-matrix-run__progress-fill');
  track.appendChild(fill);
  progress.append(track);
  const phase = el('p', 'cap-matrix-run__phase settings-field-hint');
  const detail = el('p', 'cap-matrix-run__progress-detail settings-field-hint');
  const chipsHost = el('div', 'cap-matrix-run__targets-host');
  host.append(progress, phase, detail, chipsHost);

  const actions = createSettingsActionsRow(
    [
      {
        label: 'Run matrix',
        variant: 'primary',
        onClick: () => {
          const roster = getRoster().filter((row) => row.enabled !== false);
          if (!roster.length) return;
          const groupIds = readSelectedGroups(host);
          const probeWaves = readSelectedWaves(host);
          void startCapabilityMatrixRun({
            roster: getRoster(),
            viewModel: getViewModel(),
            allowSideEffects: sideEffectsInput.checked,
            skipScored: skipScoredInput.checked,
            groupIds: groupIds.length ? groupIds : allCapabilityGroupIds(),
            probeWaves: probeWaves.length ? probeWaves : [...CAPABILITY_MATRIX_PROBE_WAVES],
            manageModelLifecycle: lifecycleInput.checked,
            onSettled: () => {
              void onRunSettled();
            },
          });
        },
      },
      {
        label: 'Stop',
        variant: 'default',
        onClick: () => {
          abortCapabilityMatrixRun();
          void onRunSettled();
        },
      },
    ],
    { searchKey: 'advanced.capabilityMatrix.run.action' },
  );

  const runBtn = actions.querySelector<HTMLButtonElement>('button');
  if (runBtn) runBtn.dataset.capMatrixRun = '1';
  const stopBtn = actions.querySelectorAll<HTMLButtonElement>('button')[1];
  if (stopBtn) stopBtn.dataset.capMatrixStop = '1';

  host.appendChild(actions);

  const refreshResume = (): void => {
    paintResumeBanner(
      host,
      () => {
        resumeCapabilityMatrixRunFromSession(
          buildRunParams(
            host,
            getRoster,
            getViewModel,
            sideEffectsInput,
            skipScoredInput,
            lifecycleInput,
            onRunSettled,
          ),
        );
      },
      () => {
        dismissCapabilityMatrixResumeSession();
        refreshResume();
      },
    );
  };

  refreshResume();

  const unsubscribe = subscribeCapabilityMatrixRun((state) => {
    paintRunState(host, state);
    if (!state.running) refreshResume();
  });

  paintRunState(host, getCapabilityMatrixRunState());

  return () => {
    unsubscribe();
  };
}

/** Whether the singleton controller still has an active run. */
export function capabilityMatrixRunActive(): boolean {
  return isCapabilityMatrixRunActive();
}
