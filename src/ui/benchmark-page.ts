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
  abortActiveBenchmarkOnServer,
  fetchActiveBenchmarkSnapshot,
  startActiveBenchmarkOnServer,
} from '../benchmark/active-run-client.ts';
import { listRuns, loadRun, type BenchmarkRunSummary } from '../benchmark/persistence.ts';
import { getActiveProvider } from '../providers/store.ts';
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
/** Server child process drives the run (survives full page reload). */
let benchmarkUsesServer = false;
let benchmarkPollTimer: ReturnType<typeof setInterval> | null = null;
let benchmarkEventsSeen = 0;
let activeStartMode: BenchmarkStartMode = 'selected';
let lastRun: BenchmarkRun | null = null;
let compareRun: BenchmarkRun | null = null;
let historySummaries: BenchmarkRunSummary[] = [];
/** Saved run id shown in the main panel (view mode); cleared when returning to current/last run. */
let viewingHistoryRunId: string | null = null;

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

  const ariaLabel = `View transcript: ${label}, running`;
  return `<article class="benchmark-test-card is-running is-current" data-test-id="${escapeHtml(testId)}" role="button" tabindex="0" aria-busy="true" aria-label="${escapeHtml(ariaLabel)}"${labelledBy}${describedBy}>
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
    liveTestResults.set(event.result.testId, event.result);
    upsertLiveTestCard(event.result, compareMap);
    updateProgressBar(
      liveProgressPercent(),
      `${SUITE_LABELS[event.result.suite]} · ${event.result.label}`,
    );
    return;
  }

  if (event.type === 'run-cancelled') {
    finishLiveRunUI({ markCurrentStopped: true, commitPartial: true });
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
  syncBenchmarkTopbarRunning(running);
}

/** Top-bar chart icon shows activity while a run continues off-page. */
function syncBenchmarkTopbarRunning(running: boolean): void {
  document.getElementById('btnBenchmark')?.classList.toggle('is-benchmark-running', running);
}

function isBenchmarkRunActive(): boolean {
  if (benchmarkUsesServer) return liveRunActive;
  return abortController != null && !abortController.signal.aborted;
}

function stopActiveBenchmarkPolling(): void {
  if (benchmarkPollTimer != null) {
    clearInterval(benchmarkPollTimer);
    benchmarkPollTimer = null;
  }
}

function applyBenchmarkProgressEvent(
  event: BenchmarkProgressEvent,
  compareMap: Map<string, TestResult>,
): void {
  onBenchmarkProgress(event, compareMap);
}

function replayBenchmarkProgressEvents(
  events: BenchmarkProgressEvent[],
  compareMap: Map<string, TestResult>,
  fromIndex = 0,
): void {
  for (let i = fromIndex; i < events.length; i += 1) {
    applyBenchmarkProgressEvent(events[i], compareMap);
  }
  benchmarkEventsSeen = events.length;
}

function startActiveBenchmarkPolling(generation: number, compareMap: Map<string, TestResult>): void {
  stopActiveBenchmarkPolling();
  benchmarkPollTimer = setInterval(() => {
    if (generation !== benchmarkRunGeneration) return;
    void (async () => {
      const snap = await fetchActiveBenchmarkSnapshot();
      if (!snap || generation !== benchmarkRunGeneration) return;

      if (snap.events.length > benchmarkEventsSeen) {
        replayBenchmarkProgressEvents(snap.events, compareMap, benchmarkEventsSeen);
      }

      if (snap.status === 'running') return;

      stopActiveBenchmarkPolling();
      benchmarkUsesServer = false;

      if (snap.status === 'error' && snap.error) {
        setStatus('err', snap.error);
      } else if (snap.status === 'complete' && snap.run) {
        lastRun = snap.run;
        liveRunDrawerMeta = {
          preset: lastRun.preset,
          modelId: lastRun.model.id,
          startedAt: lastRun.startedAt,
        };
        renderSummary(lastRun);
        renderSuites(lastRun, compareRun);
        void refreshHistorySelect();
        setStatus('ok', `Benchmark done · ${formatScore(snap.run.totalScore)}`);
      }

      if (generation === benchmarkRunGeneration) {
        setRunning(false);
        abortController = null;
      }
    })();
  }, 400);
}

/** Rebuild suite cards from accumulated live state after leaving the page mid-run. */
function rebuildLiveBenchmarkView(): void {
  const mount = document.getElementById('benchmarkSuites');
  if (!mount || !liveRunActive) return;

  mount.innerHTML = '';
  mount.classList.add('is-live');
  setProgressVisible(true);

  const summary = document.getElementById('benchmarkSummary');
  if (summary) {
    summary.innerHTML =
      '<p class="benchmark-empty benchmark-empty--live">Scoring the active model…</p>';
  }

  for (const suiteId of liveSuiteIds) {
    ensureSuiteSection(suiteId, false);
  }

  const compareMap = compareMapFromRun(compareRun);
  for (const result of liveTestResults.values()) {
    upsertLiveTestCard(result, compareMap);
  }

  if (liveCurrentTestMeta) {
    upsertRunningTestCard(
      liveCurrentTestMeta.suite,
      liveCurrentTestMeta.testId,
      liveCurrentTestMeta.label,
    );
  }

  updateProgressBar(liveProgressPercent(), 'Benchmark running…');
}

function renderBenchmarkPanelForCurrentState(): void {
  if (liveRunActive || isBenchmarkRunActive()) {
    rebuildLiveBenchmarkView();
    setRunning(true);
    return;
  }
  renderSummary(lastRun);
  if (lastRun) renderSuites(lastRun, compareRun);
  setRunning(false);
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

function isViewingHistoryRun(): boolean {
  return viewingHistoryRunId != null;
}

function canReturnToCurrentRun(): boolean {
  return liveRunActive || isBenchmarkRunActive();
}

function syncReturnToCurrentControl(): void {
  const btn = document.getElementById('benchmarkReturnToCurrent');
  if (!btn) return;
  const show =
    isViewingHistoryRun() && (canReturnToCurrentRun() || lastRun != null);
  btn.classList.toggle('hidden', !show);
  if (show) btn.removeAttribute('hidden');
  else btn.setAttribute('hidden', '');
}

function returnToCurrentRunView(): void {
  viewingHistoryRunId = null;
  const select = document.getElementById('benchmarkHistorySelect') as HTMLSelectElement | null;
  if (select) select.value = '';
  syncReturnToCurrentControl();

  if (canReturnToCurrentRun()) {
    rebuildLiveBenchmarkView();
    setRunning(true);
    setStatus('ok', 'Showing current benchmark run.');
    return;
  }

  if (lastRun) {
    syncLiveDrawerMetaFromRun(lastRun);
    renderSummary(lastRun);
    renderSuites(lastRun, compareRun);
    setStatus('ok', 'Showing latest run.');
    return;
  }

  renderSummary(null);
  const mount = document.getElementById('benchmarkSuites');
  if (mount) mount.innerHTML = '';
}

async function refreshHistorySelect(): Promise<void> {
  const select = document.getElementById('benchmarkHistorySelect') as HTMLSelectElement | null;
  if (!select) return;
  const previous = select.value;
  const compareToggle = document.getElementById('benchmarkCompareToggle') as HTMLInputElement | null;
  historySummaries = await listRuns();
  select.innerHTML =
    '<option value="">View or compare a saved run…</option>' +
    historySummaries
      .filter((h) => h.id !== lastRun?.id)
      .map(
        (h) =>
          `<option value="${escapeHtml(h.id)}">${escapeHtml(h.startedAt)} · ${escapeHtml(h.modelId)} · ${formatScore(h.totalScore)}</option>`,
      )
      .join('');

  const restoreId =
    (previous && historySummaries.some((h) => h.id === previous) ? previous : null) ??
    (compareToggle?.checked && compareRun?.id ? compareRun.id : null) ??
    (isViewingHistoryRun() ? viewingHistoryRunId : null);
  if (restoreId) {
    select.value = restoreId;
  }
  syncReturnToCurrentControl();
}

/** Load a saved run for viewing, or as the compare baseline when Compare is checked. */
async function onHistorySelectChange(): Promise<void> {
  const select = document.getElementById('benchmarkHistorySelect') as HTMLSelectElement | null;
  const toggle = document.getElementById('benchmarkCompareToggle') as HTMLInputElement | null;
  if (!select) return;

  const id = select.value;
  if (!id) {
    compareRun = null;
    returnToCurrentRunView();
    return;
  }

  const loaded = await loadRun(id);
  if (!loaded) {
    setStatus('err', 'Could not load that benchmark run.');
    compareRun = null;
    viewingHistoryRunId = null;
    syncReturnToCurrentControl();
    returnToCurrentRunView();
    return;
  }

  if (toggle?.checked) {
    compareRun = loaded;
    viewingHistoryRunId = null;
    syncReturnToCurrentControl();
    if (canReturnToCurrentRun()) {
      setStatus('ok', 'Comparing current run against saved baseline.');
      return;
    }
    if (!lastRun) {
      setStatus('ok', 'Run a benchmark to compare against this saved run.');
      return;
    }
    renderSuites(lastRun, compareRun);
    return;
  }

  compareRun = null;
  viewingHistoryRunId = id;
  syncReturnToCurrentControl();
  renderSummary(loaded);
  renderSuites(loaded, null);
  setStatus('ok', `Loaded saved run · ${formatScore(loaded.totalScore)}`);
}

async function startRun(mode: BenchmarkStartMode): Promise<void> {
  if (!getActiveModelIdFromDom()) {
    setStatus('err', 'Load a model before running Benchmark.');
    return;
  }

  applyStartModeToToggles(mode);
  activeStartMode = mode;

  const selectedSuites = getSelectedSuites();
  if (!selectedSuites.length) {
    setStatus('err', 'Select at least one benchmark suite, then Run (or Quick / Full).');
    return;
  }

  const storedPreset = storedPresetForStartMode(mode);

  stopActiveBenchmarkPolling();
  abortController?.abort();
  if (benchmarkUsesServer) {
    await abortActiveBenchmarkOnServer();
  }

  const generation = ++benchmarkRunGeneration;
  benchmarkEventsSeen = 0;
  benchmarkUsesServer = false;
  abortController = new AbortController();
  const runSignal = abortController.signal;
  setRunning(true);
  setStatus('ok', runningStatusLabel(mode));

  const suiteIds = selectedSuites;
  const compareMap = compareMapFromRun(compareRun);
  const modelId = getActiveModelIdFromDom() ?? 'unknown';
  const startedAt = new Date().toISOString();
  liveRunDrawerMeta = {
    preset: storedPreset,
    modelId,
    startedAt,
  };
  initLiveRunUI(mode, suiteIds);

  try {
    const provider = await getActiveProvider();
    const baseUrl = `${window.location.origin}`;
    const serverSnap = await startActiveBenchmarkOnServer({
      baseUrl,
      preset: storedPreset,
      suites: selectedSuites,
      providerId: provider.id,
      modelId,
      provider,
    });

    if (serverSnap?.status === 'running') {
      benchmarkUsesServer = true;
      replayBenchmarkProgressEvents(serverSnap.events, compareMap);
      startActiveBenchmarkPolling(generation, compareMap);
      return;
    }

    const run = await runBenchmark({
      preset: storedPreset,
      suites: selectedSuites,
      signal: runSignal,
      onProgress: (event) => {
        if (generation !== benchmarkRunGeneration) return;
        applyBenchmarkProgressEvent(event, compareMap);
        if (event.type === 'run-cancelled') {
          setStatus('ok', 'Benchmark cancelled.');
          return;
        }
        if (event.type === 'run-done') {
          lastRun = event.run;
          liveRunDrawerMeta = {
            preset: lastRun.preset,
            modelId: lastRun.model.id,
            startedAt: lastRun.startedAt,
          };
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
    if (benchmarkUsesServer) return;
    setRunning(false);
    abortController = null;
  }
}

function stopRun(): void {
  if (!isBenchmarkRunActive() && !abortController) return;
  benchmarkRunGeneration += 1;
  stopActiveBenchmarkPolling();
  if (benchmarkUsesServer) {
    void abortActiveBenchmarkOnServer();
    benchmarkUsesServer = false;
  }
  abortController?.abort();
  abortController = null;
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

/** Test hook: whether the saved-run panel is showing instead of the current run. */
export function isViewingHistoryRunForTests(): boolean {
  return isViewingHistoryRun();
}

/** Test hook: show or hide the return-to-current control. */
export function syncReturnToCurrentControlForTests(): void {
  syncReturnToCurrentControl();
}

/** Test hook: return from history view to the live or latest run panel. */
export function returnToCurrentRunViewForTests(): void {
  returnToCurrentRunView();
}

/** Test hook: mark that a saved run is displayed in the main panel. */
export function setViewingHistoryRunIdForTests(id: string | null): void {
  viewingHistoryRunId = id;
}

/** Test hook: seed live run UI state for restore tests. */
export function seedLiveRunUiStateForTests(options: {
  suiteIds: SuiteId[];
  results?: TestResult[];
  current?: { testId: string; suite: SuiteId; label: string } | null;
}): void {
  liveRunActive = true;
  liveSuiteIds = options.suiteIds;
  liveSuiteIndex = 0;
  liveTestsInSuite = options.results?.length ?? 0;
  liveTestResults.clear();
  for (const result of options.results ?? []) {
    liveTestResults.set(result.testId, result);
  }
  liveCurrentTestMeta = options.current ?? null;
  liveCurrentTestId = options.current?.testId ?? null;
}

/** Test hook: rebuild the live suite grid after leaving history view. */
export function rebuildLiveBenchmarkViewForTests(): void {
  rebuildLiveBenchmarkView();
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

  void refreshHistorySelect();
  renderBenchmarkPanelForCurrentState();
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

/** Re-attach UI after reload while a server-side run is still active. */
async function attachToActiveBenchmarkIfRunning(): Promise<void> {
  const snap = await fetchActiveBenchmarkSnapshot();
  if (!snap || snap.status !== 'running' || !snap.config) return;

  benchmarkUsesServer = true;
  benchmarkEventsSeen = 0;
  activeStartMode = 'selected';
  liveRunDrawerMeta = {
    preset: snap.config.preset,
    modelId: snap.config.modelId,
    startedAt: snap.config.startedAt,
  };
  liveSuiteIds = snap.config.suites;
  liveRunActive = true;
  liveTestResults.clear();
  liveCurrentTestId = null;
  liveCurrentTestMeta = null;

  const compareMap = compareMapFromRun(compareRun);
  replayBenchmarkProgressEvents(snap.events, compareMap);
  setRunning(true);
  setStatus('ok', 'Benchmark running…');

  const root = getBenchmarkRoot();
  if (root?.classList.contains('is-open')) {
    rebuildLiveBenchmarkView();
  }

  const generation = benchmarkRunGeneration;
  startActiveBenchmarkPolling(generation, compareMap);
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
  document.getElementById('benchmarkReturnToCurrent')?.addEventListener('click', () => {
    returnToCurrentRunView();
  });

  const suitesMount = document.getElementById('benchmarkSuites');
  suitesMount?.addEventListener('click', onBenchmarkTestCardClick);
  suitesMount?.addEventListener('keydown', onBenchmarkTestCardKeydown);

  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash === '#/benchmark') {
    openBenchmark();
  }
  void attachToActiveBenchmarkIfRunning();
}

export function openBenchmarkFromTopbar(): void {
  openBenchmark();
}
