/**
 * Benchmark full-page UI (#/benchmark) — active-model integration battery.
 */

import '../styles/benchmark-page.css';

import { runBenchmark } from '../benchmark/runner.ts';
import { listRuns, loadRun, type BenchmarkRunSummary } from '../benchmark/persistence.ts';
import type { BenchmarkRun, SuiteId, TestResult } from '../benchmark/types.ts';
import { getActiveModelIdFromDom } from '../benchmark/resolve-binding.ts';
import { setStatus } from './status';

const ALL_SUITES: SuiteId[] = [
  'capability',
  'speed',
  'tools',
  'skills',
  'modes',
  'coding',
];

let abortController: AbortController | null = null;
let lastRun: BenchmarkRun | null = null;
let compareRun: BenchmarkRun | null = null;
let historySummaries: BenchmarkRunSummary[] = [];

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

function statusLabel(result: TestResult, regression: boolean): string {
  if (result.skipped) return `skip: ${result.skipReason ?? 'skipped'}`;
  if (regression) return 'REGRESSION';
  if (result.passed) return 'pass';
  return 'fail';
}

function renderSuites(run: BenchmarkRun, compare: BenchmarkRun | null): void {
  const mount = document.getElementById('benchmarkSuites');
  if (!mount) return;

  const compareMap = new Map<string, TestResult>();
  if (compare) {
    for (const suite of compare.suites) {
      for (const t of suite.tests) {
        compareMap.set(t.testId, t);
      }
    }
  }

  mount.innerHTML = run.suites
    .map((suite) => {
      const rows = suite.tests
        .map((t) => {
          const prev = compareMap.get(t.testId);
          const regression = Boolean(prev?.passed && !t.skipped && !t.passed);
          const judged = t.judged ? 'true' : 'false';
          return `<tr class="${regression ? 'is-regression' : ''}" data-judged="${judged}">
            <td>${escapeHtml(t.label)}</td>
            <td class="benchmark-status">${escapeHtml(statusLabel(t, regression))}</td>
            <td>${t.durationMs} ms</td>
            <td>${escapeHtml(t.details?.slice(0, 80) ?? '')}</td>
          </tr>`;
        })
        .join('');
      return `<section class="benchmark-suite is-expanded" data-suite="${suite.id}">
        <div class="benchmark-suite-header" role="button" tabindex="0" aria-expanded="true">
          <span>${escapeHtml(suite.label)}</span>
          <span>${suite.passed}/${suite.passed + suite.failed} · ${formatScore(suite.score)}</span>
        </div>
        <div class="benchmark-suite-body">
          <table class="benchmark-results-table">
            <thead><tr><th>Test</th><th>Status</th><th>Time</th><th>Details</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
    })
    .join('');

  mount.querySelectorAll('.benchmark-suite-header').forEach((header) => {
    header.addEventListener('click', () => {
      header.parentElement?.classList.toggle('is-expanded');
      const expanded = header.parentElement?.classList.contains('is-expanded');
      header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  quick?.toggleAttribute('disabled', running);
  full?.toggleAttribute('disabled', running);
  stop?.toggleAttribute('disabled', !running);
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

  const suitesMount = document.getElementById('benchmarkSuites');
  if (suitesMount) suitesMount.innerHTML = '<p class="benchmark-empty">Running…</p>';

  try {
    const run = await runBenchmark({
      preset,
      suites: getSelectedSuites(),
      signal: abortController.signal,
      onProgress: (event) => {
        if (event.type === 'test-done' && lastRun) {
          /* incremental DOM update deferred — full render on run-done */
        }
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
    if (abortController.signal.aborted) {
      setStatus('ok', 'Benchmark cancelled.');
    } else {
      setStatus('err', err instanceof Error ? err.message : String(err));
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
