/**
 * Evidence ledger — the running record of what a research run actually did.
 *
 * Appends one row per real event (plan written, query issued, source opened) in
 * the order the engine produced them. Streams live from SSE, and rehydrates
 * verbatim from a finished run's persisted `activityLog`, so a brief you open
 * six weeks later can still show its own working.
 *
 * Rows are appended, never re-rendered, so a 200-source run does not thrash the
 * DOM and the reader never loses their scroll position mid-run.
 */

import type { ResearchProgress } from './types';

type EntryKind = 'query' | 'source' | 'phase' | 'warning' | 'error';

interface EntryOptions {
  kind: EntryKind;
  text: string;
  host?: string;
  url?: string;
  /** Newest source while the engine is still reading it. */
  active?: boolean;
  /** Skip the enter transition when replaying a finished run. */
  instant?: boolean;
}

const MARKS: Record<EntryKind, string> = {
  query: '?',
  source: '✓',
  phase: '·',
  warning: '!',
  error: '×',
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  );
}

/** Display host for a URL, or the trailing segment of a local file path. */
export function ledgerHost(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    const pathPart = trimmed.startsWith('file://') ? trimmed.slice(7) : trimmed;
    const segments = pathPart.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments[segments.length - 1] ?? pathPart.slice(0, 40);
  }
  try {
    return new URL(trimmed).hostname.replace(/^www\./, '');
  } catch {
    return trimmed.slice(0, 40);
  }
}

/** Live and replayed record of a single research run. */
export class ResearchRunLedger {
  private readonly mount: HTMLElement;
  private listEl: HTMLElement | null = null;
  private planEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private activeEntry: HTMLElement | null = null;

  private currentRound = 0;
  private scanned = 0;
  private readCount = 0;
  private running = true;
  private replaying = false;

  private readonly seenSources = new Set<string>();
  private readonly seenQueries = new Set<string>();

  constructor(mount: HTMLElement) {
    this.mount = mount;
  }

  reset(): void {
    this.currentRound = 0;
    this.scanned = 0;
    this.readCount = 0;
    this.running = true;
    this.activeEntry = null;
    this.seenSources.clear();
    this.seenQueries.clear();

    this.planEl = null;
    this.listEl = document.createElement('div');
    this.listEl.className = 'rs-ledger__list';

    this.emptyEl = document.createElement('p');
    this.emptyEl.className = 'rs-ledger__empty';
    this.emptyEl.textContent = 'Waiting for the first move.';

    this.mount.replaceChildren(this.emptyEl, this.listEl);
  }

  destroy(): void {
    this.mount.replaceChildren();
    this.listEl = null;
    this.planEl = null;
    this.emptyEl = null;
    this.activeEntry = null;
  }

  /** Replay a persisted activity log without enter transitions. */
  hydrate(events: ResearchProgress[]): void {
    this.reset();
    this.replaying = true;
    for (const event of events) {
      this.apply(event);
    }
    this.replaying = false;
    this.setRunning(false);
  }

  /** Clear the in-progress marker on the newest source row. */
  setRunning(running: boolean): void {
    this.running = running;
    if (running || !this.activeEntry) {
      return;
    }
    this.activeEntry.classList.remove('is-active');
    const mark = this.activeEntry.querySelector('.rs-entry__mark');
    if (mark) {
      mark.textContent = MARKS.source;
    }
    this.activeEntry = null;
  }

  getScanned(): number {
    return this.scanned;
  }

  getReadCount(): number {
    return this.readCount;
  }

  getRound(): number {
    return Math.max(1, this.currentRound);
  }

  apply(event: ResearchProgress): void {
    if (!this.listEl) {
      return;
    }

    switch (event.phase) {
      case 'probing':
        this.addEntry({
          kind: 'phase',
          text: event.model?.trim() ? `Using ${event.model.trim()}` : 'Choosing a model',
        });
        break;

      case 'planning':
        if (event.planSummary?.trim()) {
          this.setPlan(event.planSummary.trim());
        } else {
          this.addEntry({ kind: 'phase', text: 'Writing the investigation plan' });
        }
        break;

      case 'category':
        if (event.category?.trim()) {
          this.addEntry({ kind: 'phase', text: `Reporting as ${event.category.trim()}` });
        }
        break;

      case 'searching': {
        this.ensureRound(event.round || 1);
        this.scanned = event.totalSources ?? this.scanned;
        for (const query of event.queryList ?? []) {
          const trimmed = query.trim();
          if (!trimmed) {
            continue;
          }
          const key = `${this.currentRound}|${trimmed}`;
          if (this.seenQueries.has(key)) {
            continue;
          }
          this.seenQueries.add(key);
          this.addEntry({ kind: 'query', text: trimmed });
        }
        break;
      }

      case 'reading': {
        if (event.round) {
          this.ensureRound(event.round);
        }
        this.scanned = event.totalSources ?? this.scanned;
        const url = event.url?.trim();
        if (!url || this.seenSources.has(url)) {
          break;
        }
        this.seenSources.add(url);
        this.readCount += 1;
        this.setRunning(this.running);
        const entry = this.addEntry({
          kind: 'source',
          text: event.title?.trim() || url,
          host: ledgerHost(url),
          url,
          active: this.running && !this.replaying,
        });
        if (this.running && !this.replaying) {
          this.activeEntry = entry;
        }
        break;
      }

      case 'analyzing':
        if (event.round) {
          this.ensureRound(event.round);
        }
        this.scanned = event.totalSources ?? this.scanned;
        this.setRunning(this.running);
        this.addEntry({
          kind: 'phase',
          text: event.message?.trim() || `Cross-checking round ${this.getRound()}`,
        });
        break;

      case 'decision':
        if (event.message?.trim()) {
          this.addEntry({ kind: 'phase', text: event.message.trim() });
        }
        break;

      case 'writing':
        this.scanned = event.totalSources ?? this.scanned;
        this.setRunning(this.running);
        this.addEntry({ kind: 'phase', text: event.message?.trim() || 'Writing the brief' });
        break;

      case 'warning':
        this.addEntry({ kind: 'warning', text: event.message });
        break;

      case 'error':
        this.addEntry({ kind: 'error', text: event.message });
        break;

      default:
        break;
    }
  }

  /** Append a terminal line when the run stops. */
  complete(status: 'done' | 'error' | 'cancelled', message?: string): void {
    this.setRunning(false);
    if (status === 'error') {
      this.addEntry({ kind: 'error', text: message || 'The run failed' });
      return;
    }
    if (status === 'cancelled') {
      this.addEntry({ kind: 'warning', text: message || 'Stopped before finishing' });
    }
  }

  private setPlan(text: string): void {
    if (!this.planEl) {
      this.planEl = document.createElement('div');
      this.planEl.className = 'rs-ledger__plan';
      const label = document.createElement('div');
      label.className = 'rs-ledger__plan-label';
      label.textContent = 'Plan';
      const body = document.createElement('p');
      body.className = 'rs-ledger__plan-text';
      this.planEl.append(label, body);
      this.mount.insertBefore(this.planEl, this.listEl);
    }
    const body = this.planEl.querySelector('.rs-ledger__plan-text');
    if (body) {
      body.textContent = text;
    }
    this.hideEmpty();
  }

  private ensureRound(round: number): void {
    if (!this.listEl || round <= this.currentRound) {
      return;
    }
    this.currentRound = round;
    const divider = document.createElement('div');
    divider.className = 'rs-round';
    divider.textContent = `Round ${round}`;
    this.listEl.appendChild(divider);
    this.hideEmpty();
  }

  private hideEmpty(): void {
    if (this.emptyEl) {
      this.emptyEl.remove();
      this.emptyEl = null;
    }
  }

  private addEntry(options: EntryOptions): HTMLElement {
    const row = document.createElement('div');
    row.className = `rs-entry rs-entry--${options.kind}`;
    if (options.active) {
      row.classList.add('is-active');
    }
    if (!this.replaying && !options.instant && !prefersReducedMotion()) {
      row.classList.add('rs-entry--enter');
    }

    const mark = document.createElement('span');
    mark.className = 'rs-entry__mark';
    mark.setAttribute('aria-hidden', 'true');
    if (options.active) {
      const spinner = document.createElement('span');
      spinner.className = 'rs-spinner rs-spinner--sm';
      mark.appendChild(spinner);
    } else {
      mark.textContent = MARKS[options.kind];
    }

    const text = document.createElement('span');
    text.className = 'rs-entry__text';

    if (options.kind === 'query') {
      text.textContent = `"${options.text}"`;
    } else if (options.url) {
      const link = document.createElement('a');
      link.href = options.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = options.url;
      link.textContent = options.text;
      text.appendChild(link);
    } else {
      text.textContent = options.text;
    }

    if (options.host) {
      const host = document.createElement('span');
      host.className = 'rs-entry__host';
      host.textContent = options.host;
      text.appendChild(host);
    }

    row.append(mark, text);
    this.listEl?.appendChild(row);
    this.hideEmpty();
    this.followTail();
    return row;
  }

  /** Keep the newest row visible, but only when the reader is already at the tail. */
  private followTail(): void {
    if (this.replaying) {
      return;
    }
    const scroller = this.findScroller();
    if (!scroller) {
      return;
    }
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distance < 120) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  private findScroller(): HTMLElement | null {
    let node: HTMLElement | null = this.mount;
    while (node) {
      const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
      const overflowY = style?.overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }
}
