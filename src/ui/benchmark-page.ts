/**
 * Benchmark full-page UI (#/benchmark) — active-model integration battery.
 */

import '../styles/benchmark-page.css';
import '../styles/sub-agent-drawer.css';

import { aggregateRunScore } from '../benchmark/scoring.ts';
import { runBenchmark, resolveBenchmarkSuites } from '../benchmark/runner.ts';
import {
  formatTestCardDescription,
  resolveTestDescription,
  SUITE_INTROS,
} from '../benchmark/test-catalog.ts';
import {
  clearActiveBenchmarkSession,
  loadActiveBenchmarkSession,
  remainingSuiteIds,
  saveActiveBenchmarkSession,
  type ActiveBenchmarkSession,
} from '../benchmark/active-run-session.ts';
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
  type BenchmarkTranscriptRunMeta,
} from './benchmark-transcript-drawer.ts';
import { SUITE_LABELS } from './benchmark-transcript-labels.ts';
import { setStatus } from './status';

/** How a benchmark run was started from the run bar. */
export type BenchmarkStartMode = 'quick' | 'full' | 'selected';

/** History dropdown value to return from a saved-run view to the live panel. */
const HISTORY_CURRENT_VALUE = '__current__';

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
/** Finished probes in the current (or last cancelled) run — used for transcript drill-down before `lastRun` is set. */
const liveTestResults = new Map<string, TestResult>();
/** Run header for the transcript drawer during an active or partial run. */
let liveRunDrawerMeta: BenchmarkTranscriptRunMeta | null = null;
let liveSuiteIds: SuiteId[] = [];
let liveTestsDone = 0;
let liveSuiteIndex = 0;
let liveTestsInSuite = 0;
/** Test card currently showing the running spinner (at most one). */
let liveCurrentTestId: string | null = null;
/** Metadata for the in-flight probe (used when marking Stopped on cancel). */
let liveCurrentTestMeta: { testId: string; suite: SuiteId; label: string } | null = null;
/** User is viewing a saved run in the main panel while a live run may still be updating. */
let browsingHistory = false;
/** Stable id for the in-flight run (matches persisted session and saved run). */
let liveRunId: string | null = null;
/** How the active run was started (for session restore labels). */
let liveStartMode: BenchmarkStartMode = 'selected';

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

  const ariaLabel = `View transcript: ${label}, stopped`;
  return `<article class="benchmark-test-card is-stopped is-fail" data-test-id="${escapeHtml(testId)}" role="button" tabindex="0" aria-label="${escapeHtml(ariaLabel)}"${labelledBy}${describedBy}>
    <div class="benchmark-test-card-status" aria-hidden="true">${iconSvg('fail')}</div>
    <div class="benchmark-test-card-body">
      <h3 class="benchmark-test-card-title" id="${escapeHtml(titleId)}">${escapeHtml(label)}</h3>
      ${descriptionHtml}
    </div>
    <p class="benchmark-test-card-meta">Stopped</p>
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

  const ariaLabel = `View transcript: ${label}, running`;
  return `<article class="benchmark-test-card is-running is-current" data-test-id="${escapeHtml(testId)}" role="button" tabindex="0" aria-busy="true" aria-label="${escapeHtml(ariaLabel)}"${labelledBy}${describedBy}>
    <div class="benchmark-test-card-status" aria-hidden="true">${iconSvg('running')}</div>
    <div class="benchmark-test-card-body">
      <h3 class="benchmark-test-card-title" id="${escapeHtml(titleId)}">${escapeHtml(label)}</h3>
      ${descriptionHtml}
    </div>
    <p class="benchmark-test-card-meta">Running…</p>
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

  const detailsHtml = details
    ? `<p class="benchmark-test-card-details">${escapeHtml(details.slice(0, 120))}</p>`
    : '';

  return `<article class="benchmark-test-card ${state}${animate ? ' is-entering' : ''}" data-test-id="${escapeHtml(result.testId)}" role="button" tabindex="0" aria-label="${escapeHtml(ariaLabel)}"${labelledBy}${describedBy}>
    <div class="benchmark-test-card-status" aria-hidden="true">${iconSvg(icon)}</div>
    <div class="benchmark-test-card-body">
      <h3 class="benchmark-test-card-title" id="${escapeHtml(titleId)}">${escapeHtml(result.label)}</h3>
      ${descriptionHtml}
      ${detailsHtml}
    </div>
    <p class="benchmark-test-card-meta">${escapeHtml(meta)}</p>
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

function syntheticStoppedResult(testId: string, suite: SuiteId, label: string): TestResult {
  return {
    testId,
    suite,
    label,
    passed: false,
    skipped: false,
    durationMs: 0,
    score: 0,
    details: 'Benchmark run was stopped during this test.',
    transcriptMeta: {
      error: 'No transcript — the benchmark was stopped before this test finished.',
    },
  };
}

function syntheticRunningResult(testId: string, suite: SuiteId, label: string): TestResult {
  return {
    testId,
    suite,
    label,
    passed: false,
    skipped: false,
    durationMs: 0,
    score: 0,
    transcriptMeta: {
      error: 'This test is still running. Open again after it finishes to see the transcript.',
    },
  };
}

/** Resolve a test for transcript drill-down (live map, then saved run). */
export function resolveTestForTranscript(testId: string): TestResult | null {
  const live = liveTestResults.get(testId);
  if (live) return live;
  return resolveTestResultForCard(lastRun, testId);
}

function resolveTestFromCard(card: HTMLElement): TestResult | null {
  const testId = card.dataset.testId;
  if (!testId) return null;

  const found = resolveTestForTranscript(testId);
  if (found) return found;

  const suiteEl = card.closest<HTMLElement>('[data-suite]');
  const suite = suiteEl?.dataset.suite as SuiteId | undefined;
  const label =
    card.querySelector('.benchmark-test-card-title')?.textContent?.trim() ?? testId;
  if (!suite) return null;

  if (card.classList.contains('is-stopped')) {
    return syntheticStoppedResult(testId, suite, label);
  }
  if (card.classList.contains('is-running')) {
    return syntheticRunningResult(testId, suite, label);
  }
  return null;
}

function transcriptRunMeta(): BenchmarkTranscriptRunMeta | null {
  if (liveRunDrawerMeta) return liveRunDrawerMeta;
  if (!lastRun) return null;
  return {
    preset: lastRun.preset,
    modelId: lastRun.model.id,
    startedAt: lastRun.startedAt,
  };
}

function buildPartialBenchmarkRun(
  meta: BenchmarkTranscriptRunMeta,
  results: Map<string, TestResult>,
  suiteIds: SuiteId[],
): BenchmarkRun {
  const suites: BenchmarkRun['suites'] = [];
  for (const suiteId of suiteIds) {
    const tests = [...results.values()].filter((t) => t.suite === suiteId);
    if (!tests.length) continue;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const t of tests) {
      if (t.skipped) skipped += 1;
      else if (t.passed) passed += 1;
      else failed += 1;
    }
    const score =
      tests.length > 0 ? tests.reduce((sum, t) => sum + t.score, 0) / tests.length : 0;
    suites.push({
      id: suiteId,
      label: SUITE_LABELS[suiteId],
      passed,
      failed,
      skipped,
      score,
      tests,
    });
  }

  return {
    id: `partial-${meta.startedAt}`,
    startedAt: meta.startedAt,
    durationMs: 0,
    preset: meta.preset,
    provider: { id: '', baseUrl: '' },
    model: { id: meta.modelId },
    totalScore: suites.length ? aggregateRunScore(suites) : 0,
    headlineTtftMs: 0,
    headlineTokPerSec: 0,
    modeMatrixPassed: suites.find((s) => s.id === 'modes')?.passed ?? 0,
    toolsPassed: suites.find((s) => s.id === 'tools')?.passed ?? 0,
    skillsPassed: suites.find((s) => s.id === 'skills')?.passed ?? 0,
    suites,
  };
}

function commitPartialRunFromLive(): void {
  if (!liveRunDrawerMeta || liveTestResults.size === 0) return;
  lastRun = buildPartialBenchmarkRun(liveRunDrawerMeta, liveTestResults, liveSuiteIds);
}

function completedSuitesFromLiveProgress(): BenchmarkRun['suites'] {
  if (!liveRunDrawerMeta || liveSuiteIndex <= 0) return [];
  return buildPartialBenchmarkRun(
    liveRunDrawerMeta,
    liveTestResults,
    liveSuiteIds.slice(0, liveSuiteIndex),
  ).suites;
}

function persistActiveRunSession(): void {
  if (!liveRunDrawerMeta || !liveRunId || !isLiveRunInProgress()) return;
  saveActiveBenchmarkSession({
    version: 1,
    runId: liveRunId,
    startedAt: liveRunDrawerMeta.startedAt,
    preset: liveRunDrawerMeta.preset,
    startMode: liveStartMode,
    suiteIds: liveSuiteIds,
    modelId: liveRunDrawerMeta.modelId,
    completedSuites: completedSuitesFromLiveProgress(),
    completedTests: [...liveTestResults.values()],
    status: 'running',
  });
}

function clearActiveRunPersistence(): void {
  clearActiveBenchmarkSession();
}

function applyActiveSessionToLiveState(session: ActiveBenchmarkSession): void {
  liveRunId = session.runId;
  liveStartMode = session.startMode;
  liveRunDrawerMeta = {
    preset: session.preset,
    modelId: session.modelId,
    startedAt: session.startedAt,
  };
  liveSuiteIds = [...session.suiteIds];
  liveSuiteIndex = session.completedSuites.length;
  liveTestsDone = session.completedTests.length;
  liveRunActive = true;
  liveCurrentTestId = null;
  liveCurrentTestMeta = null;
  liveTestResults.clear();
  for (const result of session.completedTests) {
    liveTestResults.set(result.testId, result);
  }
}

function regressionForTest(test: TestResult, compareMap: Map<string, TestResult>): boolean {
  const prev = compareMap.get(test.testId);
  return Boolean(prev?.passed && !test.skipped && !test.passed);
}

function openTranscriptForCard(card: HTMLElement): void {
  const test = resolveTestFromCard(card);
  const meta = transcriptRunMeta();
  if (!test || !meta) return;
  const compareMap = compareMapFromRun(compareRun);
  openBenchmarkTranscriptDrawer(test, meta, { regression: regressionForTest(test, compareMap) });
}

function onBenchmarkTestCardClick(ev: MouseEvent): void {
  const card = (ev.target as HTMLElement).closest<HTMLElement>('.benchmark-test-card');
  if (!card) return;
  openTranscriptForCard(card);
}

function onBenchmarkTestCardKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const card = (ev.target as HTMLElement).closest<HTMLElement>('.benchmark-test-card');
  if (!card) return;
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

  liveTestResults.set(meta.testId, syntheticStoppedResult(meta.testId, meta.suite, meta.label));

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
  browsingHistory = false;
  liveRunActive = true;
  liveSuiteIds = suiteIds;
  liveTestsDone = 0;
  liveSuiteIndex = 0;
  liveTestsInSuite = 0;
  liveCurrentTestId = null;
  liveCurrentTestMeta = null;
  liveTestResults.clear();

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
  updateBackToCurrentControl();
}

function finishLiveRunUI(options?: {
  markCurrentStopped?: boolean;
  commitPartial?: boolean;
}): void {
  if (options?.markCurrentStopped) {
    markCurrentTestAsStopped();
  }
  if (options?.commitPartial) {
    commitPartialRunFromLive();
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
  if (event.type === 'test-done') {
    liveTestResults.set(event.result.testId, event.result);
  }

  if (browsingHistory || !liveRunActive) return;

  if (event.type === 'suite-start') {
    liveSuiteIndex = liveSuiteIds.indexOf(event.suiteId);
    liveTestsInSuite = 0;
    ensureSuiteSection(event.suiteId, true);
    updateProgressBar(liveProgressPercent(), `${event.label} suite`);
    persistActiveRunSession();
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
    persistActiveRunSession();
    return;
  }

  if (event.type === 'run-cancelled') {
    clearActiveRunPersistence();
    finishLiveRunUI({ markCurrentStopped: true, commitPartial: true });
    setRunning(false);
    return;
  }

  if (event.type === 'run-done') {
    browsingHistory = false;
    updateBackToCurrentControl();
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
    clearActiveRunPersistence();
    finishLiveRunUI();
  }
}

function renderSummary(run: BenchmarkRun | null): void {
  const root = document.getElementById('benchmarkSummary');
  if (!root) return;
  if (!run) {
    root.innerHTML =
      '<p class="benchmark-empty">Choose suites in the deck above, then Run. Quick and Full apply a preset first.</p>';
    return;
  }
  const scoreClass =
    run.totalScore >= 0.85 ? 'is-good' : run.totalScore >= 0.6 ? 'is-warn' : 'is-bad';
  root.innerHTML = `
    <div class="benchmark-results-strip" role="group" aria-label="Run summary">
      <div class="benchmark-stat-cell">
        <span class="benchmark-stat-name">Score</span>
        <span class="benchmark-stat-val ${scoreClass}">${formatScore(run.totalScore)}</span>
      </div>
      <div class="benchmark-stat-cell">
        <span class="benchmark-stat-name">TTFT (median)</span>
        <span class="benchmark-stat-val">${formatDurationMs(run.headlineTtftMs)}</span>
      </div>
      <div class="benchmark-stat-cell">
        <span class="benchmark-stat-name">Tok/s (median)</span>
        <span class="benchmark-stat-val">${formatMetric(run.headlineTokPerSec)}</span>
      </div>
      <div class="benchmark-stat-cell">
        <span class="benchmark-stat-name">Duration</span>
        <span class="benchmark-stat-val">${formatDurationMs(run.durationMs)}</span>
      </div>
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

function isLiveRunInProgress(): boolean {
  return liveRunActive || isBenchmarkRunActive();
}

function updateBackToCurrentControl(): void {
  const btn = document.getElementById('btnBenchmarkBackToCurrent');
  if (!btn) return;
  const show = browsingHistory && isLiveRunInProgress();
  btn.hidden = !show;
}

/** Rebuild the live suite panel from in-memory progress (after browsing saved history). */
function renderLiveRunFromState(compareMap: Map<string, TestResult>): void {
  const mount = document.getElementById('benchmarkSuites');
  if (!mount) return;

  mount.innerHTML = '';
  mount.classList.add('is-live');

  const summary = document.getElementById('benchmarkSummary');
  if (summary) {
    summary.innerHTML =
      '<p class="benchmark-empty benchmark-empty--live">Scoring the active model…</p>';
  }

  for (const suiteId of liveSuiteIds) {
    const suiteTests = [...liveTestResults.values()].filter((t) => t.suite === suiteId);
    const grid = ensureSuiteSection(suiteId, liveCurrentTestMeta?.suite === suiteId);
    if (!grid) continue;

    for (const result of suiteTests) {
      if (result.testId === liveCurrentTestId) continue;
      grid.insertAdjacentHTML(
        'beforeend',
        renderTestCard(result, regressionForTest(result, compareMap), false),
      );
    }

    if (liveCurrentTestMeta?.suite === suiteId) {
      upsertRunningTestCard(
        liveCurrentTestMeta.suite,
        liveCurrentTestMeta.testId,
        liveCurrentTestMeta.label,
      );
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const t of suiteTests) {
      if (t.skipped) skipped += 1;
      else if (t.passed) passed += 1;
      else failed += 1;
    }
    const total = passed + failed + skipped + (liveCurrentTestMeta?.suite === suiteId ? 1 : 0);
    const score =
      suiteTests.length > 0
        ? suiteTests.reduce((sum, t) => sum + t.score, 0) / suiteTests.length
        : 0;
    updateSuiteScore(suiteId, passed, Math.max(total, 1), score);
  }

  setProgressVisible(liveRunActive);
  if (liveRunActive) {
    const label = liveCurrentTestMeta
      ? runningTestProgressLabel(liveCurrentTestMeta.suite, liveCurrentTestMeta.label)
      : 'Benchmark running…';
    updateProgressBar(liveProgressPercent(), label);
  }
}

function restoreCurrentRunView(): void {
  browsingHistory = false;
  const select = document.getElementById('benchmarkHistorySelect') as HTMLSelectElement | null;
  if (select && select.value !== '') {
    select.value = '';
  }
  updateBackToCurrentControl();

  if (isLiveRunInProgress()) {
    renderLiveRunFromState(compareMapFromRun(compareRun));
    setStatus('ok', 'Showing current benchmark run.');
    return;
  }

  if (lastRun) {
    renderSummary(lastRun);
    renderSuites(lastRun, compareRun);
    setStatus('ok', `Showing latest run · ${formatScore(lastRun.totalScore)}`);
  }
}

function onRunStopClick(): void {
  if (isBenchmarkRunActive()) {
    stopRun();
    return;
  }
  abortController = null;
  void startRun('selected');
}

function syncLiveDrawerMetaFromRun(run: BenchmarkRun): void {
  liveRunDrawerMeta = {
    preset: run.preset,
    modelId: run.model.id,
    startedAt: run.startedAt,
  };
}

async function refreshHistorySelect(): Promise<void> {
  const select = document.getElementById('benchmarkHistorySelect') as HTMLSelectElement | null;
  if (!select) return;
  const previous = select.value;
  const compareToggle = document.getElementById('benchmarkCompareToggle') as HTMLInputElement | null;
  historySummaries = await listRuns();
  const currentOption = isLiveRunInProgress()
    ? `<option value="${HISTORY_CURRENT_VALUE}">Current run (in progress)</option>`
    : '';
  select.innerHTML =
    '<option value="">View or compare a saved run…</option>' +
    currentOption +
    historySummaries
      .filter((h) => h.id !== lastRun?.id)
      .map(
        (h) =>
          `<option value="${escapeHtml(h.id)}">${escapeHtml(h.startedAt)} · ${escapeHtml(h.modelId)} · ${formatScore(h.totalScore)}</option>`,
      )
      .join('');

  const restoreId =
    (previous && historySummaries.some((h) => h.id === previous) ? previous : null) ??
    (compareToggle?.checked && compareRun?.id ? compareRun.id : null);
  if (restoreId) {
    select.value = restoreId;
  }
}

/** Load a saved run for viewing, or as the compare baseline when Compare is checked. */
async function onHistorySelectChange(): Promise<void> {
  const select = document.getElementById('benchmarkHistorySelect') as HTMLSelectElement | null;
  const toggle = document.getElementById('benchmarkCompareToggle') as HTMLInputElement | null;
  if (!select) return;

  const id = select.value;

  if (id === HISTORY_CURRENT_VALUE) {
    restoreCurrentRunView();
    return;
  }

  if (!id) {
    compareRun = null;
    if (browsingHistory || isLiveRunInProgress()) {
      restoreCurrentRunView();
      return;
    }
    if (lastRun) {
      renderSummary(lastRun);
      renderSuites(lastRun, null);
    }
    return;
  }

  const loaded = await loadRun(id);
  if (!loaded) {
    setStatus('err', 'Could not load that benchmark run.');
    compareRun = null;
    if (browsingHistory || isLiveRunInProgress()) {
      restoreCurrentRunView();
    } else if (lastRun) {
      renderSummary(lastRun);
      renderSuites(lastRun, null);
    }
    return;
  }

  if (toggle?.checked) {
    compareRun = loaded;
    if (isLiveRunInProgress()) {
      browsingHistory = false;
      renderLiveRunFromState(compareMapFromRun(compareRun));
      updateBackToCurrentControl();
      setStatus('ok', 'Comparing current run against saved baseline.');
      return;
    }
    if (!lastRun) {
      setStatus('ok', 'Run a benchmark to compare against this saved run.');
      return;
    }
    renderSummary(lastRun);
    renderSuites(lastRun, compareRun);
    return;
  }

  browsingHistory = true;
  compareRun = null;
  if (!isLiveRunInProgress()) {
    lastRun = loaded;
    syncLiveDrawerMetaFromRun(loaded);
  }
  renderSummary(loaded);
  renderSuites(loaded, null);
  updateBackToCurrentControl();
  setStatus('ok', `Loaded saved run · ${formatScore(loaded.totalScore)}`);
}

async function executeBenchmarkRun(options: {
  mode: BenchmarkStartMode;
  suiteIds: SuiteId[];
  preset: BenchmarkPreset;
  resume?: ActiveBenchmarkSession;
}): Promise<void> {
  const { mode, suiteIds, preset, resume } = options;

  abortController?.abort();
  const generation = ++benchmarkRunGeneration;
  abortController = new AbortController();
  const runSignal = abortController.signal;
  setRunning(true);
  setStatus('ok', resume ? 'Resuming benchmark…' : runningStatusLabel(mode));

  const compareMap = compareMapFromRun(compareRun);
  const modelId = getActiveModelIdFromDom() ?? resume?.modelId ?? 'unknown';
  const startedAt = resume?.startedAt ?? new Date().toISOString();
  liveRunId = resume?.runId ?? startedAt.replace(/[:.]/g, '-');
  liveStartMode = resume?.startMode ?? mode;
  liveRunDrawerMeta = {
    preset,
    modelId,
    startedAt,
  };

  if (resume) {
    applyActiveSessionToLiveState(resume);
    renderLiveRunFromState(compareMap);
    setProgressVisible(true);
    updateBackToCurrentControl();
  } else {
    initLiveRunUI(mode, suiteIds);
  }

  persistActiveRunSession();
  void refreshHistorySelect();

  const suitesToRun = resume ? remainingSuiteIds(resume) : suiteIds;
  if (!suitesToRun.length) {
    clearActiveRunPersistence();
    setRunning(false);
    abortController = null;
    return;
  }

  try {
    const run = await runBenchmark({
      preset,
      suites: suitesToRun,
      runId: liveRunId,
      resume: resume
        ? {
            runId: resume.runId,
            startedAt: resume.startedAt,
            priorSuites: resume.completedSuites,
          }
        : undefined,
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
          liveRunId = event.run.id;
          syncLiveDrawerMetaFromRun(event.run);
          renderSummary(lastRun);
          renderSuites(lastRun, compareRun);
          void refreshHistorySelect();
        }
      },
    });
    if (generation !== benchmarkRunGeneration) return;
    lastRun = run;
    liveRunId = run.id;
    renderSummary(run);
    renderSuites(run, compareRun);
    await refreshHistorySelect();
    if (generation !== benchmarkRunGeneration) return;
    setStatus('ok', `Benchmark done · ${formatScore(run.totalScore)}`);
  } catch (err) {
    if (generation !== benchmarkRunGeneration) return;
    const aborted = runSignal.aborted;
    if (aborted) {
      clearActiveRunPersistence();
    }
    finishLiveRunUI({ markCurrentStopped: aborted, commitPartial: aborted });
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
    liveRunId = null;
    setRunning(false);
    abortController = null;
  }
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
  await executeBenchmarkRun({ mode, suiteIds: selectedSuites, preset: storedPreset });
}

async function resumeBenchmarkFromSession(session: ActiveBenchmarkSession): Promise<void> {
  if (isBenchmarkRunActive()) return;

  const remaining = remainingSuiteIds(session);
  if (!remaining.length) {
    clearActiveBenchmarkSession();
    return;
  }

  if (!getActiveModelIdFromDom()) {
    setStatus('err', 'Load a model to resume the benchmark.');
    return;
  }

  applyStartModeToToggles(session.startMode);
  await executeBenchmarkRun({
    mode: session.startMode,
    suiteIds: session.suiteIds,
    preset: session.preset,
    resume: session,
  });
}

function tryResumeBenchmarkFromSession(): void {
  const session = loadActiveBenchmarkSession();
  if (!session) return;
  if (isBenchmarkRunActive()) return;
  void resumeBenchmarkFromSession(session);
}

function stopRun(): void {
  if (!abortController) return;
  benchmarkRunGeneration += 1;
  abortController.abort();
  abortController = null;
  clearActiveRunPersistence();
  liveRunId = null;
  finishLiveRunUI({ markCurrentStopped: true, commitPartial: true });
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

/** Test hook: seed live transcript lookup state. */
export function seedLiveTranscriptStateForTests(options: {
  meta: BenchmarkTranscriptRunMeta;
  results?: TestResult[];
}): void {
  liveRunDrawerMeta = options.meta;
  liveTestResults.clear();
  for (const result of options.results ?? []) {
    liveTestResults.set(result.testId, result);
  }
}

/** Test hook: clear live transcript lookup state. */
export function clearLiveTranscriptStateForTests(): void {
  liveRunDrawerMeta = null;
  liveTestResults.clear();
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

/** Test hook: seed live-run panel state for history-browse restore tests. */
export function seedLiveRunPanelForTests(options: {
  suiteIds: SuiteId[];
  results?: TestResult[];
  running?: { testId: string; suite: SuiteId; label: string } | null;
}): void {
  liveRunActive = true;
  liveSuiteIds = options.suiteIds;
  liveTestResults.clear();
  for (const result of options.results ?? []) {
    liveTestResults.set(result.testId, result);
  }
  liveCurrentTestId = options.running?.testId ?? null;
  liveCurrentTestMeta = options.running ?? null;
  document.body.innerHTML = `
    <div id="benchmarkSummary"></div>
    <div id="benchmarkProgress" hidden><div id="benchmarkProgressFill"></div></div>
    <div id="benchmarkSuites"></div>
    <button type="button" id="btnBenchmarkBackToCurrent" hidden>Current run</button>
  `;
}

/** Test hook: mark that the user is viewing saved history while a run is active. */
export function setBrowsingHistoryForTests(browsing: boolean): void {
  browsingHistory = browsing;
  updateBackToCurrentControl();
}

/** Test hook: restore the live benchmark panel. */
export function restoreCurrentRunViewForTests(): void {
  restoreCurrentRunView();
}

/** Test hook: whether the back-to-current control is visible. */
export function isBackToCurrentVisibleForTests(): boolean {
  const btn = document.getElementById('btnBenchmarkBackToCurrent');
  return btn instanceof HTMLElement && !btn.hidden;
}

function syncBenchmarkPageOnOpen(): void {
  void refreshHistorySelect();
  if (browsingHistory) {
    updateBackToCurrentControl();
    return;
  }
  if (isLiveRunInProgress()) {
    setRunning(isBenchmarkRunActive());
    restoreCurrentRunView();
    return;
  }
  renderSummary(lastRun);
  if (lastRun) renderSuites(lastRun, compareRun);
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
  window.location.hash = '#/benchmark';

  syncBenchmarkPageOnOpen();
}

export function closeBenchmark(): void {
  const root = getBenchmarkRoot();
  const shell = getChatShell();
  if (!root || !shell) return;
  closeBenchmarkTranscriptDrawer();
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  if (window.location.hash.startsWith('#/benchmark')) {
    window.location.hash = '#/';
  }
}

/** Whether a benchmark is running (including while another page is open). */
export function isBenchmarkRunningInBackground(): boolean {
  return isLiveRunInProgress();
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

  document.getElementById('benchmarkHistorySelect')?.addEventListener('change', () => {
    void onHistorySelectChange();
  });
  document.getElementById('benchmarkCompareToggle')?.addEventListener('change', () => {
    void onHistorySelectChange();
  });
  document.getElementById('btnBenchmarkBackToCurrent')?.addEventListener('click', () => {
    restoreCurrentRunView();
  });

  const suitesMount = document.getElementById('benchmarkSuites');
  suitesMount?.addEventListener('click', onBenchmarkTestCardClick);
  suitesMount?.addEventListener('keydown', onBenchmarkTestCardKeydown);

  window.addEventListener('hashchange', onHashChange);
  tryResumeBenchmarkFromSession();
  if (window.location.hash === '#/benchmark') {
    openBenchmark();
  }
}

export function openBenchmarkFromTopbar(): void {
  openBenchmark();
}
