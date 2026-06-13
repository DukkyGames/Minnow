/**
 * Read-only benchmark test transcript drawer (messages, tool calls, results).
 */

import type { BenchmarkRun, TestResult } from '../benchmark/types.ts';
import { SUITE_LABELS } from './benchmark-transcript-labels.ts';
import { renderTranscriptView } from './transcript-view.ts';

export interface BenchmarkTranscriptRunMeta {
  preset: BenchmarkRun['preset'];
  modelId: string;
  startedAt: string;
}

let openLayer: { backdrop: HTMLElement; onKey: (e: KeyboardEvent) => void } | null = null;

export function closeBenchmarkTranscriptDrawer(): void {
  if (!openLayer) return;
  document.removeEventListener('keydown', openLayer.onKey);
  openLayer.backdrop.remove();
  openLayer = null;
}

function statusBadgeClass(result: TestResult): string {
  if (result.skipped) return 'benchmark-transcript-drawer__badge--skip';
  if (result.passed) return 'benchmark-transcript-drawer__badge--pass';
  return 'benchmark-transcript-drawer__badge--fail';
}

function statusBadgeLabel(result: TestResult): string {
  if (result.skipped) return 'Skipped';
  if (result.passed) return 'Pass';
  return 'Fail';
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function renderEmptyState(root: HTMLElement, test: TestResult): void {
  const p = document.createElement('p');
  p.className = 'benchmark-transcript-drawer__empty';
  if (test.transcriptMeta?.error) {
    p.textContent = test.transcriptMeta.error;
  } else if (!test.transcript?.length) {
    p.textContent =
      'This check did not run a model completion, or no transcript was captured for this run.';
  }
  root.appendChild(p);
  if (test.details?.trim()) {
    const details = document.createElement('pre');
    details.className = 'benchmark-transcript-drawer__details';
    details.textContent = test.details;
    root.appendChild(details);
  }
}

/**
 * Opens the transcript drawer for one benchmark test result.
 */
export function openBenchmarkTranscriptDrawer(
  test: TestResult,
  runMeta: BenchmarkTranscriptRunMeta,
  options?: { suiteLabel?: string },
): void {
  closeBenchmarkTranscriptDrawer();

  const root = document.getElementById('benchmarkView');
  if (!root) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'benchmark-transcript-drawer-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const panel = document.createElement('div');
  panel.className = 'benchmark-transcript-drawer-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', `Benchmark transcript · ${test.label}`);

  const header = document.createElement('header');
  header.className = 'benchmark-transcript-drawer__header';

  const title = document.createElement('h2');
  title.className = 'benchmark-transcript-drawer__title';
  title.textContent = test.label;

  const meta = document.createElement('div');
  meta.className = 'benchmark-transcript-drawer__meta';
  const suiteSpan = document.createElement('span');
  suiteSpan.textContent = options?.suiteLabel ?? SUITE_LABELS[test.suite] ?? test.suite;
  const badge = document.createElement('span');
  badge.className = `benchmark-transcript-drawer__badge ${statusBadgeClass(test)}`;
  badge.textContent = statusBadgeLabel(test);
  const duration = document.createElement('span');
  duration.textContent = formatDurationMs(test.durationMs);
  meta.appendChild(suiteSpan);
  meta.appendChild(badge);
  meta.appendChild(duration);

  const sub = document.createElement('p');
  sub.className = 'benchmark-transcript-drawer__sub';
  sub.textContent = `${runMeta.preset} · ${runMeta.modelId} · ${runMeta.startedAt}`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'benchmark-transcript-drawer__close';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => closeBenchmarkTranscriptDrawer());

  header.appendChild(title);
  header.appendChild(meta);
  header.appendChild(sub);
  header.appendChild(closeBtn);

  const scroll = document.createElement('div');
  scroll.className = 'benchmark-transcript-drawer__scroll';

  const footer = document.createElement('div');
  footer.className = 'benchmark-transcript-drawer__footer';
  const parts: string[] = [];
  if (test.details?.trim()) parts.push(test.details.trim());
  if (test.transcriptMeta?.finishReason) {
    parts.push(`finish: ${test.transcriptMeta.finishReason}`);
  }
  if (test.ttftMs != null) parts.push(`TTFT ${Math.round(test.ttftMs)} ms`);
  if (test.tokPerSec != null) parts.push(`${Math.round(test.tokPerSec)} tok/s`);
  if (parts.length) footer.textContent = parts.join(' · ');

  const body = document.createElement('div');
  body.className = 'benchmark-transcript-drawer__body';

  if (test.transcript?.length) {
    renderTranscriptView(body, test.transcript as unknown[]);
  } else {
    renderEmptyState(body, test);
  }

  if (test.transcriptMeta?.judgeRaw) {
    const judge = document.createElement('details');
    judge.className = 'benchmark-transcript-drawer__judge';
    const summary = document.createElement('summary');
    summary.textContent = 'Judge output';
    const pre = document.createElement('pre');
    pre.textContent = test.transcriptMeta.judgeRaw;
    judge.appendChild(summary);
    judge.appendChild(pre);
    scroll.appendChild(judge);
  }

  scroll.appendChild(body);

  panel.appendChild(header);
  if (footer.textContent) panel.appendChild(footer);
  panel.appendChild(scroll);

  backdrop.appendChild(panel);
  root.appendChild(backdrop);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBenchmarkTranscriptDrawer();
    }
  };
  document.addEventListener('keydown', onKey);
  openLayer = { backdrop, onKey };

  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) closeBenchmarkTranscriptDrawer();
  });

  closeBtn.focus();
}
