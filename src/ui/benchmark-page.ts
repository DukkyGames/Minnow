/**
 * Benchmark full-page UI (#/benchmark) — active-model integration battery.
 */

import '../styles/benchmark-page.css';

import { runBenchmark, resolveBenchmarkSuites } from '../benchmark/runner.ts';
import { listRuns, loadRun, type BenchmarkRunSummary } from '../benchmark/persistence.ts';
import type {
  BenchmarkPreset,
  BenchmarkRun,
  BenchmarkProgressEvent,
  SuiteId,
  TestResult,
} from '../benchmark/types.ts';
import { getActiveModelIdFromDom } from '../benchmark/resolve-binding.ts';
import { setStatus } from './status';

const SUITE_LABELS: Record<SuiteId, string> = {
  capability: 'Capability',
  speed: 'Speed',
  tools: 'Tools',
  skills: 'Skills',
  modes: 'Modes',
  coding: 'Coding',
};

let abortController: AbortController | null = null;
let lastRun: BenchmarkRun | null = null;
let compareRun: BenchmarkRun | null = null;
let historySummaries: BenchmarkRunSummary[] = [];

/** Tracks in-flight UI while a run is active. */
let liveRunActive = false;
let liveSuiteIds: SuiteId[] = [];
let liveTestsDone = 0;
let liveSuiteIndex = 0;
let liveTestsInSuite = 0;

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
  return `${Math.round(n)}${suffix}`;
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

function renderTestCard(result: TestResult, regression: boolean, animate = false): string {
  const state = cardState(result, regression);
  const icon = cardIconKind(result, regression);
  const judged = result.judged ? ' · judged' : '';
  const details = result.details?.trim();
  const meta = `${formatDurationMs(result.durationMs)} · ${statusText(result, regression)}${judged}`;

  return `<article class="benchmark-test-card ${state}${animate ? ' is-entering' : ''}" data-test-id="${escapeHtml(result.testId)}">
    <div class="benchmark-test-card-status" aria-hidden="true">${iconSvg(icon)}</div>
    <div class="benchmark-test-card-body">
      <h3 class="benchmark-test-card-title">${escapeHtml(result.label)}</h3>
      <p class="benchmark-test-card-meta">${escapeHtml(meta)}</p>
      ${details ? `<p class="benchmark-test-card-details">${escapeHtml(details.slice(0, 120))}</p>` : ''}
    </div>
  </article>`;
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
        <h2>${escapeHtml(SUITE_LABELS[suiteId])}</h2>
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

function upsertLiveTestCard(result: TestResult, compareMap: Map<string, TestResult>): void {
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

function initLiveRunUI(preset: BenchmarkPreset, suiteIds: SuiteId[]): void {
  liveRunActive = true;
  liveSuiteIds = suiteIds;
  liveTestsDone = 0;
  liveSuiteIndex = 0;
  liveTestsInSuite = 0;

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
  updateProgressBar(0, preset === 'quick' ? 'Quick run starting' : 'Full run starting');
}

function finishLiveRunUI(): void {
  liveRunActive = false;
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
      '<p class="benchmark-empty">Run Quick or Full to score the active model.</p>';
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
      <span class="benchmark-metric-value">${formatMetric(run.headlineTtftMs, ' ms')}</span>
    </div>
    <div class="benchmark-metric">
      <span class="benchmark-metric-label">Tok/s (median)</span>
      <span class="benchmark-metric-value">${formatMetric(run.headlineTokPerSec)}</span>
    </div>
    <div class="benchmark-metric">
      <span class="benchmark-metric-label">Duration</span>
      <span class="benchmark-metric-value">${formatMetric(run.durationMs, ' ms')}</span>
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
          <h2>${escapeHtml(suite.label)}</h2>
          <span class="benchmark-suite-block-score">${suite.passed}/${total} · ${formatScore(suite.score)}</span>
        </header>
        <div class="benchmark-test-grid">${cards}</div>
      </section>`;
    })
    .join('');
}

function getSelectedSuites(): SuiteId[] | undefined {
  const custom = document.getElementById('benchmarkCustomSuites');
  if (!(custom instanceof HTMLElement) || custom.hidden) return undefined;
  const boxes = custom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  const ids = [...boxes].map((b) => b.value as SuiteId);
  return ids.length ? ids : undefined;
}

function setRunning(running: boolean): void {
  const quick = document.getElementById('btnBenchmarkQuick');
  const full = document.getElementById('btnBenchmarkFull');
  const stop = document.getElementById('btnBenchmarkStop');
  const root = getBenchmarkRoot();
  quick?.toggleAttribute('disabled', running);
  full?.toggleAttribute('disabled', running);
  stop?.toggleAttribute('disabled', !running);
  root?.classList.toggle('is-running', running);
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

async function startRun(preset: 'quick' | 'full'): Promise<void> {
  if (!getActiveModelIdFromDom()) {
    setStatus('err', 'Load a model before running Benchmark.');
    return;
  }

  abortController?.abort();
  abortController = new AbortController();
  setRunning(true);
  setStatus('ok', preset === 'quick' ? 'Benchmark Quick running…' : 'Benchmark Full running…');

  const suiteIds = resolveBenchmarkSuites(preset, getSelectedSuites());
  const compareMap = compareMapFromRun(compareRun);
  initLiveRunUI(preset, suiteIds);

  try {
    const run = await runBenchmark({
      preset,
      suites: getSelectedSuites(),
      signal: abortController.signal,
      onProgress: (event) => {
        onBenchmarkProgress(event, compareMap);
        if (event.type === 'run-done') {
          lastRun = event.run;
          renderSummary(lastRun);
          renderSuites(lastRun, compareRun);
          void refreshHistorySelect();
        }
      },
    });
    lastRun = run;
    renderSummary(run);
    renderSuites(run, compareRun);
    await refreshHistorySelect();
    setStatus('ok', `Benchmark done · ${formatScore(run.totalScore)}`);
  } catch (err) {
    finishLiveRunUI();
    if (abortController.signal.aborted) {
      setStatus('ok', 'Benchmark cancelled.');
      if (lastRun) {
        renderSummary(lastRun);
        renderSuites(lastRun, compareRun);
      } else {
        const mount = document.getElementById('benchmarkSuites');
        if (mount) {
          mount.innerHTML = '<p class="benchmark-empty">Run cancelled.</p>';
        }
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
    setRunning(false);
    abortController = null;
  }
}

function stopRun(): void {
  abortController?.abort();
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

export function initBenchmarkPage(): void {
  document.getElementById('btnBenchmarkPageBack')?.addEventListener('click', () => closeBenchmark());
  document.getElementById('btnBenchmarkQuick')?.addEventListener('click', () => void startRun('quick'));
  document.getElementById('btnBenchmarkFull')?.addEventListener('click', () => void startRun('full'));
  document.getElementById('btnBenchmarkStop')?.addEventListener('click', () => stopRun());

  const customBtn = document.getElementById('btnBenchmarkCustom');
  const customPanel = document.getElementById('benchmarkCustomSuites');
  customBtn?.addEventListener('click', () => {
    if (customPanel instanceof HTMLElement) {
      customPanel.hidden = !customPanel.hidden;
    }
  });

  document.getElementById('benchmarkHistorySelect')?.addEventListener('change', () => void onCompareChange());
  document.getElementById('benchmarkCompareToggle')?.addEventListener('change', () => void onCompareChange());

  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash === '#/benchmark') {
    openBenchmark();
  }
}

export function openBenchmarkFromTopbar(): void {
  openBenchmark();
}
