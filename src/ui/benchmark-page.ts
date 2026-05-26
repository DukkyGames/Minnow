/**
 * Benchmark full-page UI (#/benchmark) — active-model integration battery.
 */

import '../styles/benchmark-page.css';
import '../styles/sub-agent-drawer.css';

import { runBenchmark, resolveBenchmarkSuites } from '../benchmark/runner.ts';
import {
  formatTestCardDescription,
  resolveTestDescription,
  SUITE_INTROS,
} from '../benchmark/test-catalog.ts';
import { listRuns, loadRun, type BenchmarkRunSummary } from '../benchmark/persistence.ts';
import type {
  BenchmarkPreset,
  BenchmarkRun,
  BenchmarkProgressEvent,
  SuiteId,
  TestResult,
} from '../benchmark/types.ts';
import { getActiveModelIdFromDom } from '../benchmark/resolve-binding.ts';
import {
  closeBenchmarkTranscriptDrawer,
  openBenchmarkTranscriptDrawer,
} from './benchmark-transcript-drawer.ts';
import { SUITE_LABELS } from './benchmark-transcript-labels.ts';
import { setStatus } from './status';

/** How a benchmark run was started from the run bar. */
export type BenchmarkStartMode = 'quick' | 'full' | 'selected';

/** Display order for suite toggle buttons in the run bar. */
const SUITE_TOGGLE_ORDER: SuiteId[] = [
  'capability',
  'speed',
  'tools',
  'skills',
  'modes',
  'coding',
];

let abortController: AbortController | null = null;
/** Bumped on Stop or new Run so in-flight `startRun` finally blocks do not fight UI reset. */
let benchmarkRunGeneration = 0;
let lastRun: BenchmarkRun | null = null;
let compareRun: BenchmarkRun | null = null;
let historySummaries: BenchmarkRunSummary[] = [];

/** Tracks in-flight UI while a run is active. */
let liveRunActive = false;
let liveSuiteIds: SuiteId[] = [];
let liveTestsDone = 0;
let liveSuiteIndex = 0;
let liveTestsInSuite = 0;
/** Test card currently showing the running spinner (at most one). */
let liveCurrentTestId: string | null = null;
/** Metadata for the in-flight probe (used when marking Stopped on cancel). */
let liveCurrentTestMeta: { testId: string; suite: SuiteId; label: string } | null = null;

function getBenchmarkRoot(): HTMLElement | null {
  return document.getElementById('benchmarkView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function formatScore(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatMetric(n: number, suffix = ''): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 100) return `${Math.round(n)}${suffix}`;
  return `${n.toFixed(1)}${suffix}`;
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusText(result: TestResult, regression: boolean): string {
  if (result.skipped) return result.skipReason ?? 'Skipped';
  if (regression) return 'Regression';
  if (result.passed) return 'Pass';
  return 'Fail';
}

function iconSvg(kind: 'pass' | 'fail' | 'skip' | 'running' | 'pending'): string {
  if (kind === 'pass') {
    return `<svg class="benchmark-test-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (kind === 'fail') {
    return `<svg class="benchmark-test-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }
  if (kind === 'skip') {
    return `<svg class="benchmark-test-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }
  if (kind === 'running') {
    return `<svg class="benchmark-test-icon benchmark-test-icon--spin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="14 42" stroke-linecap="round"/></svg>`;
  }
  return `<span class="benchmark-test-icon benchmark-test-icon--dot" aria-hidden="true"></span>`;
}

function cardState(result: TestResult, regression: boolean): string {
  if (result.skipped) return 'is-skip';
  if (regression) return 'is-regression';
  if (result.passed) return 'is-pass';
  return 'is-fail';
}

function cardIconKind(result: TestResult, regression: boolean): 'pass' | 'fail' | 'skip' {
  if (result.skipped) return 'skip';
  if (regression || !result.passed) return 'fail';
  return 'pass';
}

function testCardDomId(testId: string, suffix: string): string {
  const slug = testId.replace(/[^a-zA-Z0-9-]/g, '-');
  return `benchmark-${suffix}-${slug}`;
}

function renderStoppedTestCard(testId: string, suite: SuiteId, label: string): string {
  const titleId = testCardDomId(testId, 'title');
  const descId = testCardDomId(testId, 'desc');
  const catalogDesc = resolveTestDescription(testId, suite, label);
  const descriptionHtml = catalogDesc
    ? `<p class="benchmark-test-card-desc" id="${escapeHtml(descId)}">${escapeHtml(formatTestCardDescription(catalogDesc))}</p>`
    : '';
  const describedBy = catalogDesc ? ` aria-describedby="${escapeHtml(descId)}"` : '';
  const labelledBy = ` aria-labelledby="${escapeHtml(titleId)}"`;

  return `<article class="benchmark-test-card is-stopped is-fail" data-test-id="${escapeHtml(testId)}" aria-label="${escapeHtml(label)}, stopped"${labelledBy}${describedBy}>
    <div class="benchmark-test-card-status" aria-hidden="true">${iconSvg('fail')}</div>
    <div class="benchmark-test-card-body">
      <h3 class="benchmark-test-card-title" id="${escapeHtml(titleId)}">${escapeHtml(label)}</h3>
      ${descriptionHtml}
      <p class="benchmark-test-card-meta">Stopped</p>
    </div>
  </article>`;
}

function renderRunningTestCard(testId: string, suite: SuiteId, label: string): string {
  const titleId = testCardDomId(testId, 'title');
  const descId = testCardDomId(testId, 'desc');
  const catalogDesc = resolveTestDescription(testId, suite, label);
  const descriptionHtml = catalogDesc
    ? `<p class="benchmark-test-card-desc" id="${escapeHtml(descId)}">${escapeHtml(formatTestCardDescription(catalogDesc))}</p>`
    : '';
  const describedBy = catalogDesc ? ` aria-describedby="${escapeHtml(descId)}"` : '';
  const labelledBy = ` aria-labelledby="${escapeHtml(titleId)}"`;

  return `<article class="benchmark-test-card is-running is-current" data-test-id="${escapeHtml(testId)}" aria-busy="true" aria-label="${escapeHtml(label)}, running"${labelledBy}${describedBy}>
    <div class="benchmark-test-card-status" aria-hidden="true">${iconSvg('running')}</div>
    <div class="benchmark-test-card-body">
      <h3 class="benchmark-test-card-title" id="${escapeHtml(titleId)}">${escapeHtml(label)}</h3>
      ${descriptionHtml}
      <p class="benchmark-test-card-meta">Running…</p>
    </div>
  </article>`;
}

function renderTestCard(result: TestResult, regression: boolean, animate = false): string {
  const state = cardState(result, regression);
  const icon = cardIconKind(result, regression);
  const judged = result.judged ? ' · judged' : '';
  const details = result.details?.trim();
  const meta = `${formatDurationMs(result.durationMs)} · ${statusText(result, regression)}${judged}`;

  const titleId = testCardDomId(result.testId, 'title');
  const descId = testCardDomId(result.testId, 'desc');
  const catalogDesc = resolveTestDescription(result.testId, result.suite, result.label);
  const descriptionHtml = catalogDesc
    ? `<p class="benchmark-test-card-desc" id="${escapeHtml(descId)}">${escapeHtml(formatTestCardDescription(catalogDesc))}</p>`
    : '';

  const ariaLabel = `View transcript: ${result.label}, ${statusText(result, regression)}`;
  const describedBy = catalogDesc ? ` aria-describedby="${escapeHtml(descId)}"` : '';
  const labelledBy = ` aria-labelledby="${escapeHtml(titleId)}"`;

  return `<article class="benchmark-test-card ${state}${animate ? ' is-entering' : ''}" data-test-id="${escapeHtml(result.testId)}" role="button" tabindex="0" aria-label="${escapeHtml(ariaLabel)}"${labelledBy}${describedBy}>
    <div class="benchmark-test-card-status" aria-hidden="true">${iconSvg(icon)}</div>
    <div class="benchmark-test-card-body">
      <h3 class="benchmark-test-card-title" id="${escapeHtml(titleId)}">${escapeHtml(result.label)}</h3>
      ${descriptionHtml}
      <p class="benchmark-test-card-meta">${escapeHtml(meta)}</p>
      ${details ? `<p class="benchmark-test-card-details">${escapeHtml(details.slice(0, 120))}</p>` : ''}
    </div>
  </article>`;
}

/** Resolve a test result from a run by card `data-test-id`. */
export function resolveTestResultForCard(
  run: BenchmarkRun | null,
  testId: string,
): TestResult | null {
  if (!run) return null;
  for (const suite of run.suites) {
    const found = suite.tests.find((t) => t.testId === testId);
    if (found) return found;
  }
  return null;
}

function regressionForTest(test: TestResult, compareMap: Map<string, TestResult>): boolean {
  const prev = compareMap.get(test.testId);
  return Boolean(prev?.passed && !test.skipped && !test.passed);
}

function openTranscriptForCard(card: HTMLElement): void {
  if (!lastRun || liveRunActive) return;
  const testId = card.dataset.testId;
  if (!testId) return;
  const test = resolveTestResultForCard(lastRun, testId);
  if (!test) return;
  const compareMap = compareMapFromRun(compareRun);
  openBenchmarkTranscriptDrawer(
    test,
    {
      preset: lastRun.preset,
      modelId: lastRun.model.id,
      startedAt: lastRun.startedAt,
    },
    { regression: regressionForTest(test, compareMap) },
  );
}

function onBenchmarkTestCardClick(ev: MouseEvent): void {
  const card = (ev.target as HTMLElement).closest<HTMLElement>('.benchmark-test-card');
  if (!card || liveRunActive) return;
  openTranscriptForCard(card);
}

function onBenchmarkTestCardKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const card = (ev.target as HTMLElement).closest<HTMLElement>('.benchmark-test-card');
  if (!card || liveRunActive) return;
  ev.preventDefault();
  openTranscriptForCard(card);
}

function compareMapFromRun(compare: BenchmarkRun | null): Map<string, TestResult> {
  const map = new Map<string, TestResult>();
  if (!compare) return map;
  for (const suite of compare.suites) {
    for (const t of suite.tests) {
      map.set(t.testId, t);
    }
  }
  return map;
}

function setProgressVisible(visible: boolean): void {
  const el = document.getElementById('benchmarkProgress');
  if (el instanceof HTMLElement) {
    el.hidden = !visible;
  }
}

function updateProgressBar(pct: number, label: string): void {
  const track = document.getElementById('benchmarkProgress');
  const fill = document.getElementById('benchmarkProgressFill');
  const labelEl = document.getElementById('benchmarkProgressLabel');
  const pctEl = document.getElementById('benchmarkProgressPct');
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));

  if (track) {
    track.setAttribute('aria-valuenow', String(clamped));
    track.setAttribute('aria-valuetext', label);
  }
  if (fill instanceof HTMLElement) {
    fill.style.width = `${clamped}%`;
  }
  if (labelEl) labelEl.textContent = label;
  if (pctEl) pctEl.textContent = `${clamped}%`;
}

function ensureSuiteSection(suiteId: SuiteId, running = false): HTMLElement | null {
  const mount = document.getElementById('benchmarkSuites');
  if (!mount) return null;

  let section = mount.querySelector<HTMLElement>(`[data-suite="${suiteId}"]`);
  if (!section) {
    section = document.createElement('section');
    section.className = `benchmark-suite-block${running ? ' is-active' : ''}`;
    section.dataset.suite = suiteId;
    section.innerHTML = `
      <header class="benchmark-suite-block-header">
        <div class="benchmark-suite-block-heading">
          <h2>${escapeHtml(SUITE_LABELS[suiteId])}</h2>
          <p class="benchmark-suite-block-intro">${escapeHtml(SUITE_INTROS[suiteId])}</p>
        </div>
        <span class="benchmark-suite-block-score" data-suite-score>—</span>
      </header>
      <div class="benchmark-test-grid" data-suite-tests></div>
    `;
    mount.appendChild(section);
  } else if (running) {
    section.classList.add('is-active');
  }

  return section.querySelector<HTMLElement>('[data-suite-tests]');
}

function updateSuiteScore(suiteId: SuiteId, passed: number, total: number, score: number): void {
  const mount = document.getElementById('benchmarkSuites');
  const scoreEl = mount?.querySelector(
    `[data-suite="${suiteId}"] [data-suite-score]`,
  );
  if (scoreEl) {
    scoreEl.textContent = `${passed}/${total} · ${formatScore(score)}`;
  }
}

function clearCurrentRunningTestCard(): void {
  if (!liveCurrentTestId) return;
  const prev = document.querySelector<HTMLElement>(
    `.benchmark-test-card.is-current[data-test-id="${CSS.escape(liveCurrentTestId)}"]`,
  );
  prev?.classList.remove('is-current');
  liveCurrentTestId = null;
  liveCurrentTestMeta = null;
}

/** Replace the in-flight card with an X icon and "Stopped" when the run is aborted. */
function markCurrentTestAsStopped(): void {
  const meta = liveCurrentTestMeta;
  if (!meta) return;

  const grid = document.querySelector<HTMLElement>(
    `[data-suite="${meta.suite}"] [data-suite-tests]`,
  );
  const existing = grid?.querySelector(`[data-test-id="${CSS.escape(meta.testId)}"]`);
  const html = renderStoppedTestCard(meta.testId, meta.suite, meta.label);

  if (existing) {
    existing.outerHTML = html;
  } else if (grid) {
    grid.insertAdjacentHTML('beforeend', html);
  }

  liveCurrentTestId = null;
  liveCurrentTestMeta = null;
}

function upsertRunningTestCard(suiteId: SuiteId, testId: string, label: string): void {
  clearCurrentRunningTestCard();
  liveCurrentTestId = testId;
  liveCurrentTestMeta = { testId, suite: suiteId, label };

  const grid = ensureSuiteSection(suiteId, true);
  if (!grid) return;

  const existing = grid.querySelector(`[data-test-id="${CSS.escape(testId)}"]`);
  const html = renderRunningTestCard(testId, suiteId, label);

  if (existing) {
    existing.outerHTML = html;
  } else {
    grid.insertAdjacentHTML('beforeend', html);
  }

  const card = grid.querySelector<HTMLElement>(`[data-test-id="${CSS.escape(testId)}"]`);
  if (card) {
    requestAnimationFrame(() => card.classList.remove('is-entering'));
  }
}

function upsertLiveTestCard(result: TestResult, compareMap: Map<string, TestResult>): void {
  if (liveCurrentTestId === result.testId) {
    liveCurrentTestId = null;
    liveCurrentTestMeta = null;
  }
  const grid = ensureSuiteSection(result.suite, true);
  if (!grid) return;

  const prev = compareMap.get(result.testId);
  const regression = Boolean(prev?.passed && !result.skipped && !result.passed);
  const existing = grid.querySelector(`[data-test-id="${CSS.escape(result.testId)}"]`);
  const html = renderTestCard(result, regression, true);

  if (existing) {
    existing.outerHTML = html;
  } else {
    grid.insertAdjacentHTML('beforeend', html);
  }

  const card = grid.querySelector<HTMLElement>(`[data-test-id="${CSS.escape(result.testId)}"]`);
  if (card) {
    requestAnimationFrame(() => card.classList.remove('is-entering'));
  }
}

function progressStartLabel(mode: BenchmarkStartMode): string {
  if (mode === 'quick') return 'Quick run starting';
  if (mode === 'full') return 'Full run starting';
  return 'Benchmark starting';
}

function runningStatusLabel(mode: BenchmarkStartMode): string {
  if (mode === 'quick') return 'Benchmark Quick running…';
  if (mode === 'full') return 'Benchmark Full running…';
  return 'Benchmark running…';
}

/** Preset stored on the run record for history and transcript drill-down. */
export function storedPresetForStartMode(mode: BenchmarkStartMode): BenchmarkPreset {
  if (mode === 'quick') return 'quick';
  if (mode === 'full') return 'full';
  return 'custom';
}

/** Quick/Full apply preset toggles; selected leaves toggles unchanged. */
export function applyStartModeToToggles(mode: BenchmarkStartMode): void {
  if (mode === 'quick') applyPresetToToggles('quick');
  else if (mode === 'full') applyPresetToToggles('full');
}

function runningTestProgressLabel(suiteId: SuiteId, label: string): string {
  return `${SUITE_LABELS[suiteId]} · ${label}`;
}

function initLiveRunUI(mode: BenchmarkStartMode, suiteIds: SuiteId[]): void {
  liveRunActive = true;
  liveSuiteIds = suiteIds;
  liveTestsDone = 0;
  liveSuiteIndex = 0;
  liveTestsInSuite = 0;
  liveCurrentTestId = null;
  liveCurrentTestMeta = null;

  const mount = document.getElementById('benchmarkSuites');
  if (mount) {
    mount.innerHTML = '';
    mount.classList.add('is-live');
  }

  const summary = document.getElementById('benchmarkSummary');
  if (summary) {
    summary.innerHTML =
      '<p class="benchmark-empty benchmark-empty--live">Scoring the active model…</p>';
  }

  setProgressVisible(true);
  updateProgressBar(0, progressStartLabel(mode));
}

function finishLiveRunUI(options?: { markCurrentStopped?: boolean }): void {
  if (options?.markCurrentStopped) {
    markCurrentTestAsStopped();
  }
  liveRunActive = false;
  liveCurrentTestId = null;
  liveCurrentTestMeta = null;
  setProgressVisible(false);
  document.getElementById('benchmarkSuites')?.classList.remove('is-live');

  for (const section of document.querySelectorAll('.benchmark-suite-block.is-active')) {
    section.classList.remove('is-active');
  }
}

function liveProgressPercent(): number {
  const suiteCount = Math.max(liveSuiteIds.length, 1);
  const suiteBase = (liveSuiteIndex / suiteCount) * 100;
  const suiteSlice = 100 / suiteCount;
  const within =
    liveTestsInSuite > 0
      ? Math.min(suiteSlice * 0.92, (liveTestsInSuite / (liveTestsInSuite + 1)) * suiteSlice)
      : suiteSlice * 0.08;
  return Math.min(98, suiteBase + within);
}

function onBenchmarkProgress(
  event: BenchmarkProgressEvent,
  compareMap: Map<string, TestResult>,
): void {
  if (!liveRunActive) return;

  if (event.type === 'suite-start') {
    liveSuiteIndex = liveSuiteIds.indexOf(event.suiteId);
    liveTestsInSuite = 0;
    ensureSuiteSection(event.suiteId, true);
    updateProgressBar(liveProgressPercent(), `${event.label} suite`);
    return;
  }

  if (event.type === 'test-start') {
    upsertRunningTestCard(event.suiteId, event.testId, event.label);
    updateProgressBar(
      liveProgressPercent(),
      runningTestProgressLabel(event.suiteId, event.label),
    );
    return;
  }

  if (event.type === 'test-done') {
    liveTestsDone += 1;
    liveTestsInSuite += 1;
    upsertLiveTestCard(event.result, compareMap);
    updateProgressBar(
      liveProgressPercent(),
      `${SUITE_LABELS[event.result.suite]} · ${event.result.label}`,
    );
    return;
  }

  if (event.type === 'run-cancelled') {
    finishLiveRunUI({ markCurrentStopped: true });
    setRunning(false);
    return;
  }

  if (event.type === 'run-done') {
    updateProgressBar(100, 'Complete');
    for (const suite of event.run.suites) {
      updateSuiteScore(
        suite.id,
        suite.passed,
        suite.passed + suite.failed + suite.skipped,
        suite.score,
      );
      const section = document.querySelector(`[data-suite="${suite.id}"]`);
      section?.classList.remove('is-active');
    }
    finishLiveRunUI();
  }
}

function renderSummary(run: BenchmarkRun | null): void {
  const root = document.getElementById('benchmarkSummary');
  if (!root) return;
  if (!run) {
    root.innerHTML =
      '<p class="benchmark-empty">Select suites below, then Run — or use Quick / Full presets.</p>';
    return;
  }
  const scoreClass =
    run.totalScore >= 0.85 ? 'is-good' : run.totalScore >= 0.6 ? 'is-warn' : 'is-bad';
  root.innerHTML = `
    <div class="benchmark-metric">
      <span class="benchmark-metric-label">Score</span>
      <span class="benchmark-metric-value ${scoreClass}">${formatScore(run.totalScore)}</span>
    </div>
    <div class="benchmark-metric">
      <span class="benchmark-metric-label">TTFT (median)</span>
      <span class="benchmark-metric-value">${formatDurationMs(run.headlineTtftMs)}</span>
    </div>
    <div class="benchmark-metric">
      <span class="benchmark-metric-label">Tok/s (median)</span>
      <span class="benchmark-metric-value">${formatMetric(run.headlineTokPerSec)}</span>
    </div>
    <div class="benchmark-metric">
      <span class="benchmark-metric-label">Duration</span>
      <span class="benchmark-metric-value">${formatDurationMs(run.durationMs)}</span>
    </div>
  `;
}

function renderSuites(run: BenchmarkRun, compare: BenchmarkRun | null): void {
  const mount = document.getElementById('benchmarkSuites');
  if (!mount) return;

  const compareMap = compareMapFromRun(compare);

  mount.classList.remove('is-live');
  mount.innerHTML = run.suites
    .map((suite) => {
      const cards = suite.tests
        .map((t) => {
          const prev = compareMap.get(t.testId);
          const regression = Boolean(prev?.passed && !t.skipped && !t.passed);
          return renderTestCard(t, regression, false);
        })
        .join('');
      const total = suite.passed + suite.failed + suite.skipped;
      return `<section class="benchmark-suite-block" data-suite="${suite.id}">
        <header class="benchmark-suite-block-header">
          <div class="benchmark-suite-block-heading">
            <h2>${escapeHtml(suite.label)}</h2>
            <p class="benchmark-suite-block-intro">${escapeHtml(SUITE_INTROS[suite.id])}</p>
          </div>
          <span class="benchmark-suite-block-score">${suite.passed}/${total} · ${formatScore(suite.score)}</span>
        </header>
        <div class="benchmark-test-grid">${cards}</div>
      </section>`;
    })
    .join('');
}

function getSuiteToggleButtons(): HTMLButtonElement[] {
  const group = document.getElementById('benchmarkSuiteToggles');
  if (!group) return [];
  return [...group.querySelectorAll<HTMLButtonElement>('.benchmark-suite-toggle')];
}

/** Reads pressed suite toggles (always visible; no hidden-panel guard). */
function getSelectedSuites(): SuiteId[] {
  return getSuiteToggleButtons()
    .filter((btn) => btn.getAttribute('aria-pressed') === 'true')
    .map((btn) => btn.dataset.suiteId as SuiteId)
    .filter((id): id is SuiteId => Boolean(id));
}

/** Option B: Quick/Full shortcuts set toggle state before run. */
function applyPresetToToggles(preset: BenchmarkPreset): void {
  const target = new Set(resolveBenchmarkSuites(preset));
  for (const btn of getSuiteToggleButtons()) {
    const id = btn.dataset.suiteId as SuiteId | undefined;
    if (!id) continue;
    const on = target.has(id);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function setSuiteTogglesDisabled(disabled: boolean): void {
  for (const btn of getSuiteToggleButtons()) {
    btn.toggleAttribute('disabled', disabled);
  }
}

function updateRunStopButton(running: boolean): void {
  const runBtn = document.getElementById('btnBenchmarkRun');
  if (!runBtn) return;
  runBtn.textContent = running ? 'Stop' : 'Run';
  const label = running ? 'Stop benchmark' : 'Run selected suites';
  runBtn.title = label;
  runBtn.setAttribute('aria-label', label);
}

function setRunning(running: boolean): void {
  const quick = document.getElementById('btnBenchmarkQuick');
  const full = document.getElementById('btnBenchmarkFull');
  const root = getBenchmarkRoot();
  quick?.toggleAttribute('disabled', running);
  full?.toggleAttribute('disabled', running);
  updateRunStopButton(running);
  setSuiteTogglesDisabled(running);
  root?.classList.toggle('is-running', running);
}

function isBenchmarkRunActive(): boolean {
  return abortController != null && !abortController.signal.aborted;
}

function onRunStopClick(): void {
  if (isBenchmarkRunActive()) {
    stopRun();
    return;
  }
  abortController = null;
  void startRun('selected');
}

async function refreshHistorySelect(): Promise<void> {
  const select = document.getElementById('benchmarkHistorySelect') as HTMLSelectElement | null;
  if (!select) return;
  historySummaries = await listRuns();
  select.innerHTML =
    '<option value="">Compare to previous run…</option>' +
    historySummaries
      .filter((h) => h.id !== lastRun?.id)
      .map(
        (h) =>
          `<option value="${escapeHtml(h.id)}">${escapeHtml(h.startedAt)} · ${escapeHtml(h.modelId)} · ${formatScore(h.totalScore)}</option>`,
      )
      .join('');
}

async function startRun(mode: BenchmarkStartMode): Promise<void> {
  if (!getActiveModelIdFromDom()) {
    setStatus('err', 'Load a model before running Benchmark.');
    return;
  }

  applyStartModeToToggles(mode);

  const selectedSuites = getSelectedSuites();
  if (!selectedSuites.length) {
    setStatus('err', 'Select at least one benchmark suite, then Run (or Quick / Full).');
    return;
  }

  const storedPreset = storedPresetForStartMode(mode);

  abortController?.abort();
  const generation = ++benchmarkRunGeneration;
  abortController = new AbortController();
  const runSignal = abortController.signal;
  setRunning(true);
  setStatus('ok', runningStatusLabel(mode));

  const suiteIds = selectedSuites;
  const compareMap = compareMapFromRun(compareRun);
  initLiveRunUI(mode, suiteIds);

  try {
    const run = await runBenchmark({
      preset: storedPreset,
      suites: selectedSuites,
      signal: runSignal,
      onProgress: (event) => {
        if (generation !== benchmarkRunGeneration) return;
        onBenchmarkProgress(event, compareMap);
        if (event.type === 'run-cancelled') {
          setStatus('ok', 'Benchmark cancelled.');
          return;
        }
        if (event.type === 'run-done') {
          lastRun = event.run;
          renderSummary(lastRun);
          renderSuites(lastRun, compareRun);
          void refreshHistorySelect();
        }
      },
    });
    if (generation !== benchmarkRunGeneration) return;
    lastRun = run;
    renderSummary(run);
    renderSuites(run, compareRun);
    await refreshHistorySelect();
    if (generation !== benchmarkRunGeneration) return;
    setStatus('ok', `Benchmark done · ${formatScore(run.totalScore)}`);
  } catch (err) {
    if (generation !== benchmarkRunGeneration) return;
    const aborted = runSignal.aborted;
    finishLiveRunUI({ markCurrentStopped: aborted });
    if (aborted) {
      setStatus('ok', 'Benchmark cancelled.');
      if (lastRun) {
        renderSummary(lastRun);
      } else {
        renderSummary(null);
      }
    } else {
      setStatus('err', err instanceof Error ? err.message : String(err));
      const mount = document.getElementById('benchmarkSuites');
      if (mount) {
        mount.innerHTML = `<p class="benchmark-empty benchmark-empty--err">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
      }
    }
  } finally {
    if (generation !== benchmarkRunGeneration) return;
    setRunning(false);
    abortController = null;
  }
}

function stopRun(): void {
  if (!abortController) return;
  benchmarkRunGeneration += 1;
  abortController.abort();
  abortController = null;
  finishLiveRunUI({ markCurrentStopped: true });
  setRunning(false);
  setStatus('ok', 'Stopping benchmark…');
}

/** Test hook: abort controller for the in-flight benchmark run. */
export function getBenchmarkAbortControllerForTests(): AbortController | null {
  return abortController;
}

/** Test hook: wire abort controller without starting a full run. */
export function setBenchmarkAbortControllerForTests(controller: AbortController | null): void {
  abortController = controller;
}

/** Test hook: invoke Stop handler. */
export function stopRunForTests(): void {
  stopRun();
}

/** Test hook: mark the in-flight test card as stopped. */
export function markCurrentTestAsStoppedForTests(): void {
  markCurrentTestAsStopped();
}

/** Test hook: seed the active running test metadata. */
export function setLiveCurrentTestMetaForTests(
  meta: { testId: string; suite: SuiteId; label: string } | null,
): void {
  liveCurrentTestMeta = meta;
  liveCurrentTestId = meta?.testId ?? null;
}

/** Test hook: read suite toggle selection. */
export function getSelectedSuitesForTests(): SuiteId[] {
  return getSelectedSuites();
}

/** Test hook: apply Quick/Full preset to suite toggles. */
export function applyPresetToTogglesForTests(preset: BenchmarkPreset): void {
  applyPresetToToggles(preset);
}

/** Test hook: suite ids used for toggle button order. */
export function getSuiteToggleOrderForTests(): readonly SuiteId[] {
  return SUITE_TOGGLE_ORDER;
}

/** Test hook: sync Run/Stop combined button label. */
export function updateRunStopButtonForTests(running: boolean): void {
  updateRunStopButton(running);
}

async function onCompareChange(): Promise<void> {
  const select = document.getElementById('benchmarkHistorySelect') as HTMLSelectElement | null;
  const toggle = document.getElementById('benchmarkCompareToggle') as HTMLInputElement | null;
  if (!select || !toggle?.checked || !select.value) {
    compareRun = null;
    if (lastRun) renderSuites(lastRun, null);
    return;
  }
  compareRun = await loadRun(select.value);
  if (lastRun && compareRun) renderSuites(lastRun, compareRun);
}

export function openBenchmark(): void {
  const root = getBenchmarkRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  if (window.location.hash.startsWith('#/settings')) {
    return;
  }

  void import('./expert-lab-page').then((m) => {
    if (m.isExpertLabPageOpen()) m.closeExpertLab();
  });
  void import('./global-bugs-page').then((m) => {
    if (m.isGlobalBugsPageOpen()) m.closeGlobalBugs();
  });

  root.classList.add('is-open');
  shell.classList.add('hidden');
  document.querySelector('header.topbar')?.classList.add('hidden');
  window.location.hash = '#/benchmark';

  void refreshHistorySelect();
  renderSummary(lastRun);
  if (lastRun) renderSuites(lastRun, compareRun);
}

export function closeBenchmark(): void {
  const root = getBenchmarkRoot();
  const shell = getChatShell();
  if (!root || !shell) return;
  closeBenchmarkTranscriptDrawer();
  stopRun();
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  document.querySelector('header.topbar')?.classList.remove('hidden');
  if (window.location.hash.startsWith('#/benchmark')) {
    window.location.hash = '#/';
  }
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/settings')) return;
  if (hash === '#/benchmark' || hash.startsWith('#/benchmark/')) {
    openBenchmark();
    return;
  }
  const root = getBenchmarkRoot();
  if (root?.classList.contains('is-open')) {
    closeBenchmark();
  }
}

function onSuiteToggleClick(this: HTMLButtonElement): void {
  if (this.disabled) return;
  const pressed = this.getAttribute('aria-pressed') === 'true';
  this.setAttribute('aria-pressed', pressed ? 'false' : 'true');
}

export function initBenchmarkPage(): void {
  document.getElementById('btnBenchmarkPageBack')?.addEventListener('click', () => closeBenchmark());
  document.getElementById('btnBenchmarkQuick')?.addEventListener('click', () => {
    void startRun('quick');
  });
  document.getElementById('btnBenchmarkFull')?.addEventListener('click', () => {
    void startRun('full');
  });
  document.getElementById('btnBenchmarkRun')?.addEventListener('click', onRunStopClick);

  for (const btn of getSuiteToggleButtons()) {
    btn.addEventListener('click', onSuiteToggleClick);
  }

  document.getElementById('benchmarkHistorySelect')?.addEventListener('change', () => void onCompareChange());
  document.getElementById('benchmarkCompareToggle')?.addEventListener('change', () => void onCompareChange());

  const suitesMount = document.getElementById('benchmarkSuites');
  suitesMount?.addEventListener('click', onBenchmarkTestCardClick);
  suitesMount?.addEventListener('keydown', onBenchmarkTestCardKeydown);

  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash === '#/benchmark') {
    openBenchmark();
  }
}

export function openBenchmarkFromTopbar(): void {
  openBenchmark();
}
