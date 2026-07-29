import '../styles/settings-board-scenario.css';
import {
  fetchBoardScenarioCatalog,
  fetchBoardScenarioResults,
  fetchBoardScenarioRunStatus,
  fetchBoardTestingStatus,
  prepareBoardScenarioRun,
  replayBoardScenarioRun,
  startBoardScenarioRun,
  startFakeModel,
  stopBoardScenarioRun,
  submitBoardScenarioIteration,
  type BoardScenarioCatalogEntry,
  type BoardScenarioResults,
  type BoardScenarioRun,
  type BoardScenarioRunClassification,
} from '../api/board-testing';
import {
  getBoardScenario,
  listBoardScenarioMetadata,
} from '../dev/orchestrate-scenarios/catalog';
import {
  parseBoardScenario,
  type BoardScenario,
} from '../dev/orchestrate-scenarios/schema';
import { appendSettingsGroup } from './settings-layout';
import {
  createSettingsActionsRow,
  createSettingsInputRow,
  createSettingsSelectRow,
  createSettingsTextareaRow,
} from './settings-controls';
import { createSettingsToggleRow } from './settings-switch';
import { BoardScenarioPoller } from './board-scenario-poller';
import {
  createProductBoardScenarioDriver,
  type BoardScenarioClientDriver,
} from './board-scenario-driver';

const CUSTOM_SCENARIO_VALUE = '__custom__';
const TERMINAL_STATUSES = new Set(['completed', 'stopped']);
const DEFAULT_CUSTOM_SCENARIO: BoardScenario = {
  id: 'custom.quick',
  family: 'custom',
  description: 'Custom quick AFK scenario.',
  preset: 'quick',
  executionMode: 'afk',
  seed: 'custom.quick.v1',
  expected: { boardOutcome: 'passed' },
  faults: [],
  tags: ['custom'],
};

export type BoardScenarioRunnerOptions = {
  serverUp: boolean;
  announce?: (kind: 'spin' | 'ok' | 'err', message: string) => void;
  pollIntervalMs?: number;
  driver?: BoardScenarioClientDriver;
};

type PollSnapshot = {
  run: BoardScenarioRun;
  requestCount: number;
};

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isTerminal(run: BoardScenarioRun): boolean {
  return TERMINAL_STATUSES.has(run.status);
}

function deriveIterationSeed(baseSeed: number, iteration: number): number {
  return (baseSeed + Math.imul(iteration, 0x9e3779b9)) >>> 0;
}

function classificationLabel(
  classification: BoardScenarioRunClassification | null,
): string {
  switch (classification) {
    case 'pass':
      return 'Pass';
    case 'expected_blocked':
      return 'Expected blocked';
    case 'unexpected_blocked':
      return 'Unexpected blocked';
    case 'product_failure':
      return 'Product failure';
    case 'timeout':
      return 'Timeout';
    case 'harness_error':
      return 'Harness error';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Pending';
  }
}

function classificationDetail(run: BoardScenarioRun): string {
  if (run.classification === 'harness_error') {
    return 'The live board driver is unavailable or the harness failed. No board success was established.';
  }
  if (run.classification === 'pass') {
    return 'The configured driver classified every completed iteration as passing.';
  }
  if (run.classification === 'expected_blocked') {
    return 'The board reached the blocked outcome expected by this scenario.';
  }
  if (run.classification === 'stopped') {
    return 'Execution stopped before all configured iterations completed.';
  }
  if (run.classification) {
    return 'See iteration results and artifacts for the recorded failure.';
  }
  if (run.status === 'prepared') {
    return 'Prepared only. Select Run to execute with the configured driver.';
  }
  return 'Waiting for an iteration result.';
}

function elapsedMs(run: BoardScenarioRun): number {
  if (!run.startedAt) return 0;
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0
    ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
    : `${seconds}s`;
}

function fileHref(run: BoardScenarioRun, artifact: BoardScenarioRun['artifacts'][number]): string {
  if (artifact.href?.startsWith('file://')) return artifact.href;
  if (artifact.path.startsWith('file://')) return artifact.path;
  let path = artifact.path;
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) {
    const directory = run.artifactDirectory;
    if (!directory || (!directory.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(directory))) {
      return '';
    }
    path = `${directory.replace(/[\\/]$/, '')}/${path}`;
  }
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return `file:///${encodeURI(path.replaceAll('\\', '/'))}`;
  }
  return `file://${encodeURI(path)}`;
}

function localCatalog(): BoardScenarioCatalogEntry[] {
  return listBoardScenarioMetadata();
}

function mergeCatalog(remote: BoardScenarioCatalogEntry[]): BoardScenarioCatalogEntry[] {
  const merged = new Map(localCatalog().map((entry) => [entry.id, entry]));
  for (const entry of remote) {
    if (entry?.id) merged.set(entry.id, entry);
  }
  return [...merged.values()];
}

function scenarioForEntry(entry: BoardScenarioCatalogEntry | undefined): Record<string, unknown> | null {
  if (!entry) return null;
  if (entry.scenario) return entry.scenario;
  return (getBoardScenario(entry.id) as unknown as Record<string, unknown> | undefined) ?? null;
}

/** Render the automated AFK scenario harness below the existing manual workflow. */
export function renderBoardScenarioRunner(
  mount: HTMLElement,
  options: BoardScenarioRunnerOptions,
): () => void {
  let catalog = localCatalog();
  let selectedScenarioId = catalog[0]?.id ?? CUSTOM_SCENARIO_VALUE;
  let currentRun: BoardScenarioRun | null = null;
  let preparedScenario: BoardScenario | null = null;
  let results: BoardScenarioResults | null = null;
  let requestCount = 0;
  let disposed = false;
  let livePhase = '';
  let driveController: AbortController | null = null;
  const driver = options.driver ?? createProductBoardScenarioDriver();

  const group = appendSettingsGroup(
    mount,
    'AFK scenario runner',
    'Run deterministic catalog or custom scenarios through a real AFK board, then validate and preserve the resulting logs and request traces.',
    'advanced.boardTesting.scenarios',
    { emphasis: true },
  );
  group.classList.add('board-scenario-runner');

  const { row: scenarioRow, select: scenarioSelect } = createSettingsSelectRow('Scenario', {
    searchKey: 'advanced.boardTesting.scenarios.catalog',
    description: 'Built-in reliability catalog, or a complete custom scenario document.',
    onChange: (value) => {
      selectedScenarioId = value;
      syncScenario();
    },
  });
  scenarioSelect.id = 'boardScenarioCatalog';
  group.appendChild(scenarioRow);

  const scenarioDescription = node('p', 'board-scenario-runner__scenario-description');
  scenarioDescription.id = 'boardScenarioDescription';
  scenarioDescription.setAttribute('aria-live', 'polite');
  group.appendChild(scenarioDescription);

  const { row: customRow, textarea: customTextarea } = createSettingsTextareaRow(
    'Custom scenario JSON',
    {
      value: JSON.stringify(DEFAULT_CUSTOM_SCENARIO, null, 2),
      rows: 12,
      searchKey: 'advanced.boardTesting.scenarios.custom',
      description: 'Complete scenario schema. JSON is validated by the server during Prepare.',
      spellcheck: false,
      onChange: () => {},
    },
  );
  customTextarea.id = 'boardScenarioCustomJson';
  group.appendChild(customRow);

  const controls = node('div', 'board-scenario-runner__controls');
  group.appendChild(controls);

  const { row: iterationsRow, input: iterationsInput } = createSettingsInputRow('Iterations', {
    type: 'number',
    value: '1',
    min: '1',
    max: '10000',
    step: '1',
    searchKey: 'advanced.boardTesting.scenarios.iterations',
    description: 'Independent deterministic attempts.',
    onChange: () => {},
  });
  iterationsInput.id = 'boardScenarioIterations';
  controls.appendChild(iterationsRow);

  const { row: seedRow, input: seedInput } = createSettingsInputRow('Deterministic seed', {
    type: 'number',
    value: '513',
    min: '0',
    max: String(Number.MAX_SAFE_INTEGER),
    step: '1',
    searchKey: 'advanced.boardTesting.scenarios.seed',
    description: 'Reused to derive each iteration seed.',
    onChange: () => {},
  });
  seedInput.id = 'boardScenarioSeed';
  controls.appendChild(seedRow);

  const { row: timeoutRow, input: timeoutInput } = createSettingsInputRow('Timeout (ms)', {
    type: 'number',
    value: '120000',
    min: '50',
    max: '3600000',
    step: '50',
    searchKey: 'advanced.boardTesting.scenarios.timeout',
    description: 'Maximum time per iteration.',
    onChange: () => {},
  });
  timeoutInput.id = 'boardScenarioTimeout';
  controls.appendChild(timeoutRow);

  let failFast = false;
  const { row: failFastRow } = createSettingsToggleRow('Fail fast', {
    checked: failFast,
    description: 'Stop after the first non-passing classification.',
    searchKey: 'advanced.boardTesting.scenarios.failFast',
    onChange: (checked) => {
      failFast = checked;
    },
  });
  controls.appendChild(failFastRow);

  const live = node('section', 'board-scenario-live');
  live.setAttribute('aria-label', 'Scenario run status');
  const liveHeading = node('h4', 'board-scenario-live__title', 'No run prepared');
  const liveDetail = node('p', 'board-scenario-live__detail', 'Choose a scenario and select Prepare.');
  liveDetail.setAttribute('role', 'status');
  liveDetail.setAttribute('aria-live', 'polite');
  liveDetail.setAttribute('aria-atomic', 'true');
  const meters = node('dl', 'board-scenario-live__meters');
  live.append(liveHeading, liveDetail, meters);
  group.appendChild(live);

  const resultsHost = node('section', 'board-scenario-results');
  resultsHost.setAttribute('aria-label', 'Scenario results');
  group.appendChild(resultsHost);

  const poller = new BoardScenarioPoller<PollSnapshot>({
    intervalMs: options.pollIntervalMs,
    fetchSnapshot: async (signal) => {
      if (!currentRun) throw new Error('No scenario run selected');
      const [run, testingStatus] = await Promise.all([
        fetchBoardScenarioRunStatus(currentRun.id, signal),
        fetchBoardTestingStatus(signal),
      ]);
      return { run, requestCount: run.requestCount ?? testingStatus.fakeModel.requestCount };
    },
    onSnapshot: (snapshot) => {
      currentRun = snapshot.run;
      requestCount = snapshot.requestCount;
      if (isTerminal(snapshot.run)) livePhase = '';
      renderLive();
      syncActions();
      if (isTerminal(snapshot.run)) {
        if (driveController) {
          driveController.abort();
          driveController = null;
          if (snapshot.run.status === 'stopped' || snapshot.run.classification === 'timeout') {
            void driver.stop();
          }
        }
        void loadResults(snapshot.run.id);
      }
    },
    onError: (error) => {
      liveDetail.textContent = `Polling paused: ${errorMessage(error, 'Status unavailable')}`;
      options.announce?.('err', errorMessage(error, 'Scenario status unavailable'));
    },
    isTerminal: (snapshot) => isTerminal(snapshot.run),
  });

  let prepareButton: HTMLButtonElement;
  let runButton: HTMLButtonElement;
  let stopButton: HTMLButtonElement;
  let replayButton: HTMLButtonElement;

  const actions = createSettingsActionsRow(
    [
      {
        id: 'boardScenarioPrepare',
        label: 'Prepare',
        variant: 'primary',
        onClick: () => void prepareRun(),
      },
      {
        id: 'boardScenarioRun',
        label: 'Run',
        onClick: () => void startRun(),
      },
      {
        id: 'boardScenarioStop',
        label: 'Stop',
        variant: 'danger',
        onClick: () => void stopRun(),
      },
      {
        id: 'boardScenarioReplay',
        label: 'Replay',
        onClick: () => void replayRun(),
      },
    ],
    {
      className: 'board-scenario-runner__actions',
      searchKey: 'advanced.boardTesting.scenarios.actions',
    },
  );
  prepareButton = actions.querySelector('#boardScenarioPrepare') as HTMLButtonElement;
  runButton = actions.querySelector('#boardScenarioRun') as HTMLButtonElement;
  stopButton = actions.querySelector('#boardScenarioStop') as HTMLButtonElement;
  replayButton = actions.querySelector('#boardScenarioReplay') as HTMLButtonElement;
  group.appendChild(actions);

  function populateScenarioSelect(): void {
    const previous = selectedScenarioId;
    scenarioSelect.replaceChildren();
    for (const entry of catalog) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = `${entry.id} · ${entry.description}`;
      scenarioSelect.appendChild(option);
    }
    const customOption = document.createElement('option');
    customOption.value = CUSTOM_SCENARIO_VALUE;
    customOption.textContent = 'Custom scenario JSON…';
    scenarioSelect.appendChild(customOption);
    selectedScenarioId = catalog.some((entry) => entry.id === previous)
      ? previous
      : previous === CUSTOM_SCENARIO_VALUE
        ? previous
        : (catalog[0]?.id ?? CUSTOM_SCENARIO_VALUE);
    scenarioSelect.value = selectedScenarioId;
    syncScenario();
  }

  function syncScenario(): void {
    const custom = selectedScenarioId === CUSTOM_SCENARIO_VALUE;
    customRow.hidden = !custom;
    const entry = catalog.find((candidate) => candidate.id === selectedScenarioId);
    scenarioDescription.textContent = custom
      ? 'Custom JSON will be sent exactly as entered.'
      : entry
        ? `${entry.family} · ${entry.preset} · ${entry.executionMode} · expected ${entry.expectedOutcome} · ${entry.faultCount} fault${entry.faultCount === 1 ? '' : 's'}`
        : 'Scenario metadata unavailable.';
  }

  function readInteger(
    input: HTMLInputElement,
    label: string,
    minimum: number,
    maximum: number,
  ): number {
    const value = Number(input.value);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  }

  function selectedScenario(): BoardScenario {
    if (selectedScenarioId === CUSTOM_SCENARIO_VALUE) {
      const parsed = JSON.parse(customTextarea.value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Custom scenario JSON must be an object');
      }
      return parseBoardScenario(parsed);
    }
    const scenario = scenarioForEntry(
      catalog.find((entry) => entry.id === selectedScenarioId),
    );
    if (!scenario) {
      throw new Error('The selected catalog entry does not include a scenario definition');
    }
    return parseBoardScenario(scenario);
  }

  async function prepareRun(): Promise<void> {
    if (!options.serverUp) {
      options.announce?.('err', 'Tool server offline');
      return;
    }
    try {
      poller.stop();
      options.announce?.('spin', 'Preparing scenario run…');
      const scenario = selectedScenario();
      const run = await prepareBoardScenarioRun({
        scenario: scenario as unknown as Record<string, unknown>,
        iterations: readInteger(iterationsInput, 'Iterations', 1, 10_000),
        timeoutMs: readInteger(timeoutInput, 'Timeout', 50, 3_600_000),
        seed: readInteger(seedInput, 'Seed', 0, Number.MAX_SAFE_INTEGER),
        failFast,
        execution: 'external',
      });
      if (disposed) return;
      currentRun = run;
      preparedScenario = scenario;
      results = null;
      requestCount = 0;
      livePhase = '';
      renderLive();
      renderResults();
      syncActions();
      options.announce?.('ok', 'Scenario run prepared');
    } catch (error) {
      options.announce?.('err', errorMessage(error, 'Prepare failed'));
      liveDetail.textContent = errorMessage(error, 'Prepare failed');
    }
  }

  async function startRun(): Promise<void> {
    if (!currentRun || currentRun.status !== 'prepared' || !preparedScenario) return;
    const controller = new AbortController();
    driveController?.abort();
    driveController = controller;
    try {
      options.announce?.('spin', 'Starting fake model…');
      livePhase = 'starting fake model';
      renderLive();
      await startFakeModel(undefined, controller.signal);
      livePhase = 'starting external run';
      currentRun = await startBoardScenarioRun(currentRun.id, controller.signal);
      if (disposed) return;
      renderLive();
      syncActions();
      poller.start();
      options.announce?.('ok', 'Scenario run started');
      void driveExternalRun(currentRun.id, preparedScenario, controller);
    } catch (error) {
      if (controller.signal.aborted) return;
      driveController = null;
      options.announce?.('err', errorMessage(error, 'Run failed to start'));
    }
  }

  async function driveExternalRun(
    runId: string,
    scenario: BoardScenario,
    controller: AbortController,
  ): Promise<void> {
    try {
      while (!controller.signal.aborted && currentRun?.id === runId && currentRun.status === 'running') {
        const iteration = currentRun.summary.completed;
        const seed = deriveIterationSeed(currentRun.config.seed, iteration);
        const result = await driver.runIteration({
          scenario,
          iteration,
          seed,
          timeoutMs: currentRun.config.timeoutMs,
          signal: controller.signal,
          onPhase: (phase) => {
            if (controller.signal.aborted || currentRun?.id !== runId) return;
            livePhase = phase;
            renderLive();
          },
        });
        if (controller.signal.aborted || currentRun?.id !== runId) return;
        currentRun = await submitBoardScenarioIteration(
          runId,
          { iteration, seed, ...result },
          controller.signal,
        );
        requestCount = currentRun.requestCount ?? requestCount;
        if (isTerminal(currentRun)) livePhase = '';
        renderLive();
        renderResults();
        syncActions();
        if (isTerminal(currentRun)) {
          poller.stop();
          await loadResults(runId);
          return;
        }
      }
    } catch (error) {
      if (controller.signal.aborted || currentRun?.id !== runId) return;
      const iteration = currentRun?.summary.completed ?? 0;
      const seed = deriveIterationSeed(currentRun?.config.seed ?? 0, iteration);
      try {
        currentRun = await submitBoardScenarioIteration(runId, {
          iteration,
          seed,
          classification: 'harness_error',
          error: errorMessage(error, 'Renderer iteration failed'),
        });
        renderLive();
        syncActions();
        if (isTerminal(currentRun)) {
          poller.stop();
          await loadResults(runId);
        }
      } catch {
        try {
          currentRun = await fetchBoardScenarioRunStatus(runId);
          renderLive();
          syncActions();
          if (isTerminal(currentRun)) await loadResults(runId);
        } catch {
          // The original renderer failure is the actionable error.
        }
      }
      options.announce?.('err', errorMessage(error, 'Renderer iteration failed'));
    } finally {
      if (driveController === controller) driveController = null;
    }
  }

  async function stopRun(): Promise<void> {
    if (!currentRun) return;
    poller.stop();
    const controller = driveController;
    driveController = null;
    controller?.abort();
    try {
      options.announce?.('spin', 'Stopping scenario run…');
      try {
        await driver.stop();
      } finally {
        currentRun = await stopBoardScenarioRun(currentRun.id);
      }
      if (disposed) return;
      livePhase = '';
      renderLive();
      syncActions();
      if (isTerminal(currentRun)) await loadResults(currentRun.id);
      else poller.start();
      options.announce?.('ok', 'Scenario stop requested');
    } catch (error) {
      options.announce?.('err', errorMessage(error, 'Stop failed'));
    }
  }

  async function replayRun(): Promise<void> {
    if (!currentRun || !isTerminal(currentRun)) return;
    poller.stop();
    try {
      options.announce?.('spin', 'Preparing deterministic replay…');
      currentRun = await replayBoardScenarioRun(currentRun.id);
      if (disposed) return;
      results = null;
      requestCount = 0;
      livePhase = '';
      renderLive();
      renderResults();
      syncActions();
      options.announce?.('ok', 'Replay prepared; select Run to execute');
    } catch (error) {
      options.announce?.('err', errorMessage(error, 'Replay failed'));
    }
  }

  async function loadResults(runId: string): Promise<void> {
    try {
      const nextResults = await fetchBoardScenarioResults(runId);
      if (disposed || currentRun?.id !== runId) return;
      results = nextResults;
      renderResults();
    } catch (error) {
      if (!disposed) {
        options.announce?.('err', errorMessage(error, 'Results unavailable'));
      }
    }
  }

  function renderLive(): void {
    meters.replaceChildren();
    if (!currentRun) {
      liveHeading.textContent = 'No run prepared';
      liveHeading.className = 'board-scenario-live__title';
      liveDetail.textContent = 'Choose a scenario and select Prepare.';
      return;
    }
    liveHeading.textContent = classificationLabel(currentRun.classification);
    liveHeading.className = `board-scenario-live__title is-${currentRun.classification ?? currentRun.status}`;
    liveDetail.textContent = classificationDetail(currentRun);
    const completed = currentRun.summary.completed;
    const total = currentRun.config.iterations;
    const phase = livePhase || currentRun.phase?.trim() || currentRun.status;
    const entries = [
      ['Phase', phase],
      ['Elapsed', formatElapsed(elapsedMs(currentRun))],
      ['Progress', `${completed} / ${total}`],
      ['Requests', String(requestCount)],
    ];
    for (const [term, value] of entries) {
      const dt = node('dt', 'board-scenario-live__term', term);
      const dd = node('dd', 'board-scenario-live__value', value);
      meters.append(dt, dd);
    }
    const progress = document.createElement('progress');
    progress.className = 'board-scenario-live__progress';
    progress.max = total;
    progress.value = Math.min(completed, total);
    progress.setAttribute('aria-label', `${completed} of ${total} iterations completed`);
    meters.appendChild(progress);
  }

  function renderResults(): void {
    resultsHost.replaceChildren();
    if (!currentRun) return;

    const title = node('h4', 'board-scenario-results__title', 'Artifacts and results');
    resultsHost.appendChild(title);
    const artifacts = node('ul', 'board-scenario-artifacts');
    artifacts.setAttribute('aria-label', 'Run artifact files');
    for (const artifact of currentRun.artifacts ?? []) {
      const item = node('li', 'board-scenario-artifacts__item');
      const href = fileHref(currentRun, artifact);
      if (href) {
        const link = node('a', 'settings-inline-link', artifact.name);
        link.href = href;
        link.title = `Open ${artifact.path}`;
        item.appendChild(link);
      } else {
        item.appendChild(node('span', undefined, artifact.name));
      }
      item.appendChild(node('code', undefined, artifact.path));
      artifacts.appendChild(item);
    }
    if (!currentRun.artifacts?.length) {
      artifacts.appendChild(node('li', 'board-scenario-artifacts__item', 'No artifacts listed.'));
    }
    resultsHost.appendChild(artifacts);

    if (!results?.iterations.length) {
      resultsHost.appendChild(
        node('p', 'board-scenario-results__empty', 'No iteration results recorded yet.'),
      );
      return;
    }
    const list = node('ol', 'board-scenario-iterations');
    for (const iteration of results.iterations) {
      const item = node('li', `board-scenario-iterations__item is-${iteration.classification}`);
      const summary = node(
        'span',
        'board-scenario-iterations__summary',
        `Iteration ${iteration.iteration + 1} · ${classificationLabel(iteration.classification)} · seed ${iteration.seed ?? '—'} · ${formatElapsed(iteration.durationMs ?? 0)}`,
      );
      item.appendChild(summary);
      if (iteration.error) {
        item.appendChild(node('span', 'board-scenario-iterations__error', iteration.error));
      }
      list.appendChild(item);
    }
    resultsHost.appendChild(list);
  }

  function syncActions(): void {
    const status = currentRun?.status;
    prepareButton.disabled = !options.serverUp || status === 'running' || status === 'stopping';
    runButton.disabled = !options.serverUp || status !== 'prepared';
    stopButton.disabled =
      !options.serverUp || (status !== 'prepared' && status !== 'running' && status !== 'stopping');
    replayButton.disabled = !options.serverUp || !currentRun || !isTerminal(currentRun);
  }

  populateScenarioSelect();
  renderLive();
  renderResults();
  syncActions();

  if (options.serverUp) {
    void fetchBoardScenarioCatalog()
      .then((remote) => {
        if (disposed) return;
        catalog = mergeCatalog(remote);
        populateScenarioSelect();
      })
      .catch(() => {
        // The catalog endpoint is optional during phased rollout; bundled metadata remains usable.
      });
  }

  return () => {
    disposed = true;
    poller.stop();
    driveController?.abort();
    driveController = null;
    const runningRunId =
      currentRun?.status === 'running' || currentRun?.status === 'stopping'
        ? currentRun.id
        : null;
    void Promise.resolve(driver.stop()).finally(() => {
      if (runningRunId) void stopBoardScenarioRun(runningRunId);
    });
  };
}
