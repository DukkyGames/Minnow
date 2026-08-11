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

function renderTargetChips(container: HTMLElement, chips: MatrixTargetChip[]): void {
  container.replaceChildren();
  if (!chips.length) return;
  const list = el('ul', 'cap-matrix-run__chips');
  for (const chip of chips) {
    const item = el('li', `cap-matrix-run__chip cap-matrix-run__chip--${chip.state}`);
    const label = el('span', 'cap-matrix-run__chip-label', chip.label);
    item.appendChild(label);
    if (chip.state === 'skipped' && chip.detail) {
      item.title = chip.detail;
      item.appendChild(el('span', 'cap-matrix-run__chip-detail', 'load failed'));
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
    banner = el('div', 'cap-matrix-run__resume');
    banner.setAttribute('role', 'status');
    root.prepend(banner);
  }
  banner.replaceChildren();
  const text = el(
    'p',
    'cap-matrix-run__resume-text',
    `Interrupted sweep (${summary.campaignId}): ${summary.remainingTargetCount} model(s) and ${summary.completedProbeCount} finished probe(s) can be resumed.`,
  );
  const actions = el('div', 'cap-matrix-run__resume-actions');
  const resumeBtn = el('button', 'settings-action-btn settings-action-btn--primary', 'Resume sweep');
  resumeBtn.type = 'button';
  resumeBtn.addEventListener('click', onResume);
  const dismissBtn = el('button', 'settings-action-btn', 'Dismiss');
  dismissBtn.type = 'button';
  dismissBtn.addEventListener('click', onDismiss);
  actions.append(resumeBtn, dismissBtn);
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
  const chipsHost = root.querySelector<HTMLElement>('.cap-matrix-run__chips-host');
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

/** Mount run filters, actions, and live progress (subscribes to singleton controller). */
export function mountCapabilityRunPanel(options: CapabilityRunPanelOptions): () => void {
  const { host, getRoster, getViewModel, onRunSettled } = options;
  host.replaceChildren();
  host.className = 'cap-matrix-run';

  const filters = el('div', 'cap-matrix-run__filters');

  const groupFieldset = el('fieldset', 'cap-matrix-run__fieldset');
  groupFieldset.appendChild(el('legend', '', 'Capability groups'));
  const groupGrid = el('div', 'cap-matrix-run__checkbox-grid');
  for (const groupId of CAPABILITY_GROUP_ORDER) {
    const label = el('label', 'cap-matrix-run__check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.capMatrixGroup = groupId;
    label.append(input, document.createTextNode(CAPABILITY_GROUP_LABELS[groupId]));
    groupGrid.appendChild(label);
  }
  groupFieldset.appendChild(groupGrid);
  filters.appendChild(groupFieldset);

  const waveFieldset = el('fieldset', 'cap-matrix-run__fieldset');
  waveFieldset.appendChild(el('legend', '', 'Probe waves (tier)'));
  const waveGrid = el('div', 'cap-matrix-run__checkbox-grid');
  for (const wave of CAPABILITY_MATRIX_PROBE_WAVES) {
    const label = el('label', 'cap-matrix-run__check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.capMatrixWave = wave;
    label.append(input, document.createTextNode(CAPABILITY_MATRIX_PROBE_WAVE_LABELS[wave]));
    waveGrid.appendChild(label);
  }
  waveFieldset.appendChild(waveGrid);
  filters.appendChild(waveFieldset);

  const { row: sideEffectsRow, input: sideEffectsInput } = createSettingsToggleRow(
    'Allow side-effect tools',
    {
      searchKey: 'advanced.capabilityMatrix.run.sideEffects',
      description:
        'When off, destructive tools are stubbed (default). Turn on only for smoke tests in a sandbox workspace.',
      checked: false,
    },
  );
  sideEffectsInput.dataset.capMatrixFilter = 'sideEffects';
  filters.appendChild(sideEffectsRow);

  const { row: skipScoredRow, input: skipScoredInput } = createSettingsToggleRow(
    'Skip already-scored cells',
    {
      searchKey: 'advanced.capabilityMatrix.run.skipScored',
      description: 'Do not re-run auto probes where the grid already shows pass, partial, or fail.',
      checked: true,
    },
  );
  skipScoredInput.dataset.capMatrixFilter = 'skipScored';
  filters.appendChild(skipScoredRow);

  const { row: lifecycleRow, input: lifecycleInput } = createSettingsToggleRow(
    'Manage model lifecycle (smoke)',
    {
      searchKey: 'advanced.capabilityMatrix.run.lifecycle',
      description:
        'Auto load/unload local models between targets. Default off; enable for LM Studio / hosting smoke runs.',
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
  const phase = el('p', 'cap-matrix-run__phase');
  const detail = el('p', 'cap-matrix-run__progress-detail');
  const chipsHost = el('div', 'cap-matrix-run__chips-host');
  host.append(progress, phase, detail, chipsHost);

  const actions = createSettingsActionsRow(
    [
      {
        label: 'Run capability matrix',
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
