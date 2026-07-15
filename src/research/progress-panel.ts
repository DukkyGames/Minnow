/**
 * Deep Research progress UI — handoff stepper + live source feed (replaces ResearchSynapse).
 */

import type { ResearchProgress } from './types';

const STEPS = [
  { key: 'plan', label: 'Planning the investigation', short: 'Planning' },
  { key: 'search', label: 'Searching the web', short: 'Searching' },
  { key: 'read', label: 'Reading sources', short: 'Reading' },
  { key: 'cross', label: 'Cross-checking claims', short: 'Cross-check' },
  { key: 'write', label: 'Synthesizing the brief', short: 'Synthesizing' },
] as const;

export type ProgressStepIndex = 0 | 1 | 2 | 3 | 4;

/** Map SSE phase to stepper index. */
export function progressPhaseToStep(phase: string | undefined): ProgressStepIndex {
  switch (phase) {
    case 'probing':
    case 'planning':
      return 0;
    case 'searching':
      return 1;
    case 'reading':
      return 2;
    case 'analyzing':
      return 3;
    case 'writing':
      return 4;
    default:
      return 0;
  }
}

export interface FeedSource {
  url: string;
  title: string;
  host: string;
  type: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function hostFromUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) {
    const pathPart = url.startsWith('file://') ? url.slice(7) : url;
    const segments = pathPart.replace(/\\/g, '/').split('/');
    return segments[segments.length - 1] || pathPart.slice(0, 40);
  }
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

/** Infer source badge type from URL host or local file path. */
export function inferSourceType(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return 'blog';
  }

  const pathPart = trimmed.startsWith('file://') ? trimmed.slice(7) : trimmed;
  const looksLikeLocalPath =
    !/^https?:\/\//i.test(trimmed) &&
    (/[/\\]/.test(pathPart) ||
      /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|cs|cpp|h|md|json|yaml|yml|css|html|vue|svelte)$/i.test(
        pathPart,
      ));
  if (looksLikeLocalPath) {
    return 'code';
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes('arxiv.org') || lower.includes('doi.org') || lower.includes('scholar.')) {
    return 'paper';
  }
  if (lower.includes('docs.') || lower.endsWith('.gov') || lower.includes('/docs/')) {
    return 'docs';
  }
  if (
    lower.includes('news') ||
    lower.includes('techcrunch') ||
    lower.includes('reuters') ||
    lower.includes('bbc.')
  ) {
    return 'news';
  }
  if (lower.includes('news.ycombinator') || lower.includes('reddit.com')) {
    return 'forum';
  }
  if (lower.includes('benchmark') || lower.includes('leaderboard') || lower.includes('arena')) {
    return 'bench';
  }
  return 'blog';
}

/** Live run progress panel driven by SSE events. */
export class ResearchProgressPanel {
  private readonly mount: HTMLElement;
  private root: HTMLElement | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private timerStart = 0;
  private stepIndex: ProgressStepIndex = 0;
  private round = 1;
  private scanned = 0;
  private feed: FeedSource[] = [];
  private feedKeys = new Set<string>();
  private status: 'running' | 'done' | 'error' | 'cancelled' = 'running';
  private statusMessage = '';

  constructor(mount: HTMLElement) {
    this.mount = mount;
  }

  reset(): void {
    this.stopTimer();
    this.stepIndex = 0;
    this.round = 1;
    this.scanned = 0;
    this.feed = [];
    this.feedKeys.clear();
    this.status = 'running';
    this.statusMessage = '';
    this.timerStart = performance.now();
    this.root = document.createElement('div');
    this.root.className = 'dr-prog';
    this.mount.replaceChildren(this.root);
    this.startTimer();
    this.paint();
  }

  destroy(): void {
    this.stopTimer();
    this.mount.replaceChildren();
    this.root = null;
  }

  apply(event: ResearchProgress): void {
    if (!this.root) {
      return;
    }
    if (event.phase === 'error') {
      this.status = 'error';
      this.statusMessage = event.message;
      this.stopTimer();
      this.paint();
      return;
    }
    if (event.phase === 'warning') {
      this.statusMessage = event.message;
    }
    this.stepIndex = progressPhaseToStep(event.phase);
    if (event.phase === 'searching') {
      this.round = event.round || 1;
      this.scanned = event.totalSources ?? this.scanned;
    }
    if (event.phase === 'reading') {
      if (event.round) {
        this.round = event.round;
      }
      this.scanned = event.totalSources ?? this.scanned;
      if (event.url) {
        const key = event.url;
        if (!this.feedKeys.has(key)) {
          this.feedKeys.add(key);
          this.feed.push({
            url: event.url,
            title: event.title?.trim() || event.url,
            host: hostFromUrl(event.url),
            type: inferSourceType(event.url),
          });
        }
      }
    }
    if (event.phase === 'analyzing') {
      this.round = event.round ?? this.round;
      this.scanned = event.totalSources ?? this.scanned;
    }
    if (event.phase === 'writing') {
      this.scanned = event.totalSources ?? this.scanned;
    }
    this.paint();
  }

  complete(status: 'done' | 'error' | 'cancelled', message?: string): void {
    this.status = status;
    if (message) {
      this.statusMessage = message;
    }
    if (status === 'done') {
      this.stepIndex = 4;
    }
    this.stopTimer();
    this.paint();
  }

  getElapsedMs(): number {
    return this.timerStart ? performance.now() - this.timerStart : 0;
  }

  getScanned(): number {
    return this.scanned;
  }

  getRound(): number {
    return this.round;
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerInterval = setInterval(() => this.paintTimer(), 500);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private paintTimer(): void {
    const el = this.root?.querySelector('[data-dr-timer]');
    if (el) {
      el.textContent = formatClock(this.getElapsedMs());
    }
  }

  private paint(): void {
    if (!this.root) {
      return;
    }
    const step = STEPS[this.stepIndex];
    const label =
      this.status === 'error'
        ? this.statusMessage || 'Research failed'
        : this.status === 'cancelled'
          ? 'Research cancelled'
          : step.label;

    const stepperHtml = STEPS.map((s, i) => {
      const st = i < this.stepIndex ? 'done' : i === this.stepIndex ? 'active' : 'todo';
      const track =
        i > 0
          ? `<span class="dr-track ${i <= this.stepIndex ? 'fill' : ''}"></span>`
          : '';
      const inner =
        st === 'done'
          ? '<span class="dr-check" aria-hidden="true">✓</span>'
          : '<span class="dr-node-i"></span>';
      return `${track}<span class="dr-node ${st}" title="${escapeHtml(s.short)}">${inner}</span>`;
    }).join('');

    const labelsHtml = STEPS.map(
      (s, i) =>
        `<span class="dr-slabel research-mono ${i === this.stepIndex ? 'on' : i < this.stepIndex ? 'did' : ''}">${escapeHtml(s.short)}</span>`,
    ).join('');

    const latest = this.feed.length ? this.feed[this.feed.length - 1] : null;
    const currentHtml = latest
      ? `<div class="dr-current">
          <div class="dr-cur-link">${escapeHtml(latest.title)} <span class="dr-cur-dim">| ${escapeHtml(latest.host)}</span></div>
          <div class="dr-cur-meta research-mono">Round ${this.round} · ${this.scanned} sources scanned · ${this.feed.length} read</div>
        </div>`
      : '';

    const feedHtml =
      this.feed.length > 0
        ? `<div class="dr-feed">${this.feed
            .map((s, i) => {
              const isLast = i === this.feed.length - 1 && this.status === 'running';
              return `<div class="dr-feed-row ${isLast ? 'reading' : 'read'}">
                <span class="dr-stype research-mono t-${escapeHtml(s.type)}">${escapeHtml(s.type)}</span>
                <a class="dr-feed-title" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a>
                <span class="dr-feed-host research-mono">${escapeHtml(s.host)}</span>
                <span class="dr-feed-state">${isLast ? '<span class="dr-spinner sm"></span>' : '<span class="dr-check">✓</span>'}</span>
              </div>`;
            })
            .join('')}</div>`
        : '';

    this.root.innerHTML = `
      <div class="dr-prog-head">
        <div class="dr-prog-title"><span class="dr-dot"></span> ${escapeHtml(label)}</div>
        <div class="dr-timer research-mono" data-dr-timer>${formatClock(this.getElapsedMs())}</div>
      </div>
      <div class="dr-stepper">${stepperHtml}</div>
      <div class="dr-stepper-labels">${labelsHtml}</div>
      ${currentHtml}
      ${feedHtml}
    `;
  }
}
