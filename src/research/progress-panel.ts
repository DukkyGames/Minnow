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

/** Early-phase checklist rows — active index advances with elapsed time. */
const PLANNING_CHECKLIST = [
  'Parse the research question',
  'Identify topics and angles',
  'Draft the investigation plan',
] as const;

/** Rotating status line while the model is still planning (no plan text yet). */
const PLANNING_STATUS_LINES = [
  'Breaking down your question…',
  'Choosing what evidence to gather…',
  'Mapping search angles…',
  'Preparing the investigation plan…',
] as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  );
}

function planningChecklistIndex(elapsedMs: number): number {
  const step = Math.floor(elapsedMs / 2800);
  return Math.min(PLANNING_CHECKLIST.length - 1, step);
}

function planningStatusIndex(elapsedMs: number): number {
  return Math.floor(elapsedMs / 3200) % PLANNING_STATUS_LINES.length;
}

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

export interface ResearchProgressPanelOptions {
  /** Flat embed inside Super Plan — hides duplicate headline, uses compact chrome. */
  embedded?: boolean;
}

/** Live run progress panel driven by SSE events. */
export class ResearchProgressPanel {
  private readonly mount: HTMLElement;
  private readonly embedded: boolean;
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
  /** Latest SSE phase — drives whether the source feed shows an active read. */
  private currentPhase = 'probing';
  /** Optional server message for analyzing / writing phases. */
  private phaseMessage = '';
  /** Model id from probing SSE — shown during early planning. */
  private model = '';
  /** Truncated plan from planning SSE. */
  private planSummary = '';
  /** Latest search queries from searching SSE. */
  private searchQueries: string[] = [];
  /** Auto-detected report category. */
  private category = '';

  constructor(mount: HTMLElement, options: ResearchProgressPanelOptions = {}) {
    this.mount = mount;
    this.embedded = options.embedded === true;
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
    this.currentPhase = 'probing';
    this.phaseMessage = '';
    this.model = '';
    this.planSummary = '';
    this.searchQueries = [];
    this.category = '';
    this.timerStart = performance.now();
    this.root = document.createElement('div');
    this.root.className = 'dr-prog';
    if (this.embedded) {
      this.root.classList.add('dr-prog--embedded');
    }
    if (prefersReducedMotion()) {
      this.root.classList.add('dr-prog--reduced-motion');
    }
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
    } else {
      this.currentPhase = event.phase;
    }
    this.stepIndex = progressPhaseToStep(event.phase);
    if (event.phase === 'probing' && event.model?.trim()) {
      this.model = event.model.trim();
    }
    if (event.phase === 'planning' && event.planSummary?.trim()) {
      this.planSummary = event.planSummary.trim();
    }
    if (event.phase === 'category' && event.category?.trim()) {
      this.category = event.category.trim();
    }
    if (event.phase === 'searching') {
      this.round = event.round || 1;
      this.scanned = event.totalSources ?? this.scanned;
      const queries = event.queryList ?? [];
      if (queries.length) {
        this.searchQueries = queries.slice(0, 8);
      }
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
      this.phaseMessage = event.message?.trim() || `Synthesizing round ${this.round}…`;
    }
    if (event.phase === 'writing') {
      this.scanned = event.totalSources ?? this.scanned;
      this.phaseMessage = event.message?.trim() || 'Composing final report…';
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
    if (
      this.status === 'running' &&
      (this.currentPhase === 'probing' || this.currentPhase === 'planning') &&
      !this.planSummary
    ) {
      this.updateWorkspaceLead();
    }
  }

  /** Update rotating status text without rebuilding the whole panel. */
  private updateWorkspaceLead(): void {
    const lead = this.root?.querySelector('[data-dr-workspace-lead]');
    if (lead) {
      lead.textContent = PLANNING_STATUS_LINES[planningStatusIndex(this.getElapsedMs())];
    }
    const checklist = this.root?.querySelector('.dr-workspace-checklist');
    if (checklist) {
      const activeIdx = planningChecklistIndex(this.getElapsedMs());
      checklist.querySelectorAll('.dr-workspace-step').forEach((node, i) => {
        const step = node as HTMLElement;
        const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
        step.classList.remove('done', 'active', 'todo');
        step.classList.add(state);
      });
    }
  }

  /** Whether the main workspace (pre-feed activity) should show. */
  private showWorkspace(): boolean {
    if (this.status !== 'running') {
      return false;
    }
    if (this.feed.length > 0) {
      return false;
    }
    return (
      this.currentPhase === 'probing' ||
      this.currentPhase === 'planning' ||
      this.currentPhase === 'searching' ||
      this.currentPhase === 'category'
    );
  }

  private buildWorkspaceHtml(): string {
    const elapsed = this.getElapsedMs();
    const checklistIdx = planningChecklistIndex(elapsed);

    if (this.currentPhase === 'searching') {
      const queryRows =
        this.searchQueries.length > 0
          ? `<ul class="dr-workspace-queries">${this.searchQueries
              .map(
                (q) =>
                  `<li class="dr-workspace-query research-mono">${escapeHtml(q)}</li>`,
              )
              .join('')}</ul>`
          : `<div class="dr-workspace-wait">
              <span class="dr-workspace-pulse" aria-hidden="true"></span>
              <span class="dr-workspace-pulse" aria-hidden="true"></span>
              <span class="dr-workspace-pulse" aria-hidden="true"></span>
            </div>`;

      const metaParts = [`Round ${this.round}`];
      if (this.scanned > 0) {
        metaParts.push(`${this.scanned} sources found`);
      }
      if (this.searchQueries.length) {
        metaParts.push(`${this.searchQueries.length} queries`);
      }

      return `<div class="dr-workspace${this.embedded ? ' dr-workspace--embedded' : ''}" aria-live="polite">
        <div class="dr-workspace-hero">
          <span class="dr-spinner" aria-hidden="true"></span>
          <div class="dr-workspace-copy">
            <div class="dr-workspace-lead">Searching for sources…</div>
            <div class="dr-workspace-meta research-mono">${escapeHtml(metaParts.join(' · '))}</div>
          </div>
        </div>
        ${queryRows}
      </div>`;
    }

    const statusLine =
      this.planSummary.trim() !== ''
        ? 'Investigation plan ready'
        : PLANNING_STATUS_LINES[planningStatusIndex(elapsed)];

    const checklistHtml = PLANNING_CHECKLIST.map((label, i) => {
      const state = i < checklistIdx ? 'done' : i === checklistIdx ? 'active' : 'todo';
      const icon =
        state === 'done'
          ? '<span class="dr-workspace-icon done" aria-hidden="true">✓</span>'
          : state === 'active'
            ? '<span class="dr-spinner sm" aria-hidden="true"></span>'
            : '<span class="dr-workspace-icon todo" aria-hidden="true"></span>';
      return `<li class="dr-workspace-step ${state}">${icon}<span>${escapeHtml(label)}</span></li>`;
    }).join('');

    const planBlock = this.planSummary
      ? `<div class="dr-workspace-plan">
          <div class="dr-workspace-plan-label research-mono">Plan</div>
          <p class="dr-workspace-plan-text">${escapeHtml(this.planSummary)}</p>
        </div>`
      : '';

    const metaParts: string[] = [];
    if (this.model) {
      metaParts.push(this.model);
    }
    if (this.category) {
      metaParts.push(this.category);
    }

    return `<div class="dr-workspace${this.embedded ? ' dr-workspace--embedded' : ''}" aria-live="polite">
      <div class="dr-workspace-hero">
        <span class="dr-spinner" aria-hidden="true"></span>
        <div class="dr-workspace-copy">
          <div class="dr-workspace-lead" data-dr-workspace-lead>${escapeHtml(statusLine)}</div>
          ${
            metaParts.length
              ? `<div class="dr-workspace-meta research-mono">${escapeHtml(metaParts.join(' · '))}</div>`
              : ''
          }
        </div>
      </div>
      <ul class="dr-workspace-checklist">${checklistHtml}</ul>
      ${planBlock}
    </div>`;
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
    const embeddedPhase =
      this.status === 'error' ? 'Error' : this.status === 'cancelled' ? 'Stopped' : step.short;

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

    const isReadingPhase = this.status === 'running' && this.currentPhase === 'reading';
    const isSynthesisPhase =
      this.status === 'running' &&
      (this.currentPhase === 'analyzing' || this.currentPhase === 'writing');
    const latest = this.feed.length ? this.feed[this.feed.length - 1] : null;
    const currentHtml = isSynthesisPhase
      ? `<div class="dr-current">
          <div class="dr-cur-link">${escapeHtml(this.phaseMessage)}</div>
          <div class="dr-cur-meta research-mono">Round ${this.round} · ${this.scanned} sources scanned · ${this.feed.length} read</div>
        </div>`
      : latest && isReadingPhase
        ? `<div class="dr-current">
          <div class="dr-cur-link">${escapeHtml(latest.title)} <span class="dr-cur-dim">| ${escapeHtml(latest.host)}</span></div>
          <div class="dr-cur-meta research-mono">Round ${this.round} · ${this.scanned} sources scanned · ${this.feed.length} read</div>
        </div>`
        : '';

    const workspaceHtml = this.showWorkspace() ? this.buildWorkspaceHtml() : '';

    const feedHtml =
      this.feed.length > 0
        ? `<div class="dr-feed">${this.feed
            .map((s, i) => {
              const isLast = i === this.feed.length - 1 && isReadingPhase;
              return `<div class="dr-feed-row ${isLast ? 'reading' : 'read'}">
                <span class="dr-stype research-mono t-${escapeHtml(s.type)}">${escapeHtml(s.type)}</span>
                <a class="dr-feed-title" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a>
                <span class="dr-feed-host research-mono">${escapeHtml(s.host)}</span>
                <span class="dr-feed-state">${isLast ? '<span class="dr-spinner sm"></span>' : '<span class="dr-check">✓</span>'}</span>
              </div>`;
            })
            .join('')}</div>`
        : '';

    const headHtml = this.embedded
      ? `<div class="dr-embedded-bar">
          <div class="dr-embedded-bar__copy">
            <span class="dr-embedded-eyebrow research-mono">Deep research</span>
            <span class="dr-embedded-phase">${escapeHtml(embeddedPhase)}</span>
          </div>
          <div class="dr-timer research-mono" data-dr-timer>${formatClock(this.getElapsedMs())}</div>
        </div>`
      : `<div class="dr-prog-head">
          <div class="dr-prog-title"><span class="dr-dot"></span> ${escapeHtml(label)}</div>
          <div class="dr-timer research-mono" data-dr-timer>${formatClock(this.getElapsedMs())}</div>
        </div>`;

    this.root.innerHTML = `
      ${headHtml}
      <div class="dr-stepper${this.embedded ? ' dr-stepper--embedded' : ''}">${stepperHtml}</div>
      <div class="dr-stepper-labels${this.embedded ? ' dr-stepper-labels--embedded' : ''}">${labelsHtml}</div>
      ${workspaceHtml}
      ${currentHtml}
      ${feedHtml}
    `;

    const feed = this.root.querySelector('.dr-feed');
    if (feed) {
      feed.scrollTop = feed.scrollHeight;
    }
  }
}
