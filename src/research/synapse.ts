/**
 * Live SVG synapse progress visualization (port of Odysseus researchSynapse.js).
 */

import type { ResearchProgress } from './types';

/** Human-readable phase labels for the synapse status line. */
export const PHASE_LABEL: Record<string, string> = {
  probing: 'Connecting to model',
  planning: 'Planning research',
  searching: 'Searching the web',
  reading: 'Reading sources',
  analyzing: 'Analyzing findings',
  writing: 'Writing report',
  warning: 'Warning',
  error: 'Error',
};

const PHASE_ORDER = ['planning', 'searching', 'reading', 'analyzing', 'writing'] as const;

type PhaseId = (typeof PHASE_ORDER)[number];

/** Drive the synapse from SSE progress events. */
export class ResearchSynapse {
  private readonly root: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly nodes: Map<PhaseId, SVGCircleElement> = new Map();
  private readonly edges: SVGLineElement[] = [];
  private activePhase: PhaseId | 'probing' | 'warning' | 'error' | null = null;
  private timerStart = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private round = 0;
  private totalSources = 0;
  private totalFindings = 0;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'research-synapse';
    this.root.innerHTML = `
      <div class="research-synapse__header">
        <span class="research-synapse__phase" data-synapse-phase>Idle</span>
        <span class="research-synapse__timer" data-synapse-timer>0:00</span>
      </div>
      <svg class="research-synapse__svg" viewBox="0 0 400 80" aria-hidden="true">
        <g class="research-synapse__edges"></g>
        <g class="research-synapse__nodes"></g>
      </svg>
      <p class="research-synapse__detail" data-synapse-detail></p>
      <p class="research-synapse__stats research-mono" data-synapse-stats></p>
    `;
    mount.replaceChildren(this.root);

    this.labelEl = this.root.querySelector('[data-synapse-phase]') as HTMLElement;
    this.detailEl = this.root.querySelector('[data-synapse-detail]') as HTMLElement;
    this.statsEl = this.root.querySelector('[data-synapse-stats]') as HTMLElement;
    this.timerEl = this.root.querySelector('[data-synapse-timer]') as HTMLElement;

    const svg = this.root.querySelector('.research-synapse__svg') as SVGSVGElement;
    const nodesG = svg.querySelector('.research-synapse__nodes') as SVGGElement;
    const edgesG = svg.querySelector('.research-synapse__edges') as SVGGElement;

    const xs = [40, 120, 200, 280, 360];
    const y = 40;
    for (let i = 0; i < PHASE_ORDER.length; i += 1) {
      const id = PHASE_ORDER[i];
      if (i > 0) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(xs[i - 1]));
        line.setAttribute('y1', String(y));
        line.setAttribute('x2', String(xs[i]));
        line.setAttribute('y2', String(y));
        line.classList.add('research-synapse__edge');
        edgesG.appendChild(line);
        this.edges.push(line);
      }
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(xs[i]));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', '10');
      circle.classList.add('research-synapse__node');
      circle.setAttribute('data-phase', id);
      nodesG.appendChild(circle);
      this.nodes.set(id, circle);
    }
  }

  /** Reset visualization for a new run. */
  reset(): void {
    this.stopTimer();
    this.activePhase = null;
    this.round = 0;
    this.totalSources = 0;
    this.totalFindings = 0;
    this.labelEl.textContent = 'Starting…';
    this.detailEl.textContent = '';
    this.statsEl.textContent = '';
    this.timerEl.textContent = '0:00';
    for (const node of this.nodes.values()) {
      node.classList.remove('is-active', 'is-done');
    }
    for (const edge of this.edges) {
      edge.classList.remove('is-active');
    }
    this.startTimer();
  }

  /** Apply one progress event from the SSE stream. */
  applyProgress(event: ResearchProgress): void {
    const phase = event.phase;
    this.labelEl.textContent = PHASE_LABEL[phase] ?? phase;

    if (phase === 'probing' && 'model' in event) {
      this.detailEl.textContent = event.model;
      return;
    }

    if (phase === 'warning' || phase === 'error') {
      this.detailEl.textContent = event.message;
      this.activePhase = phase;
      return;
    }

    if (phase === 'searching') {
      this.round = event.round;
      this.totalSources = event.totalSources;
    }
    if (phase === 'reading') {
      if (event.round != null) this.round = event.round;
      this.totalSources = event.totalSources;
      if (event.totalFindings != null) this.totalFindings = event.totalFindings;
      const title = event.title?.trim() || event.url?.trim();
      this.detailEl.textContent = title ?? '';
    } else if (phase === 'searching') {
      const preview = event.queryPreview?.trim();
      const q = event.queries != null ? `${event.queries} queries` : '';
      this.detailEl.textContent = [q, preview].filter(Boolean).join(' · ');
    } else if (phase === 'writing' && event.message) {
      this.detailEl.textContent = event.message;
    } else if (phase === 'analyzing') {
      this.round = event.round;
      this.totalSources = event.totalSources;
      this.totalFindings = event.totalFindings;
      this.detailEl.textContent = '';
    } else if (phase === 'writing') {
      this.totalSources = event.totalSources;
      this.totalFindings = event.totalFindings;
      if (!event.message) this.detailEl.textContent = '';
    } else {
      this.detailEl.textContent = '';
    }

    if ((PHASE_ORDER as readonly string[]).includes(phase)) {
      this.setActivePhase(phase as PhaseId);
    }

    this.statsEl.textContent = [
      this.round > 0 ? `Round ${this.round}` : '',
      `Sources ${this.totalSources}`,
      this.totalFindings > 0 ? `Findings ${this.totalFindings}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** Mark run complete and stop the timer. */
  complete(status: 'done' | 'error' | 'cancelled', message?: string): void {
    this.stopTimer();
    if (status === 'done') {
      this.labelEl.textContent = 'Complete';
      for (const id of PHASE_ORDER) {
        this.nodes.get(id)?.classList.add('is-done');
        this.nodes.get(id)?.classList.remove('is-active');
      }
    } else if (status === 'cancelled') {
      this.labelEl.textContent = 'Cancelled';
    } else {
      this.labelEl.textContent = 'Failed';
      if (message) this.detailEl.textContent = message;
    }
  }

  destroy(): void {
    this.stopTimer();
    this.root.remove();
  }

  private setActivePhase(phase: PhaseId): void {
    this.activePhase = phase;
    let seen = true;
    for (const id of PHASE_ORDER) {
      const node = this.nodes.get(id);
      if (!node) continue;
      if (id === phase) {
        node.classList.add('is-active');
        node.classList.remove('is-done');
        seen = false;
      } else if (seen) {
        node.classList.add('is-done');
        node.classList.remove('is-active');
      } else {
        node.classList.remove('is-active', 'is-done');
      }
    }
    const idx = PHASE_ORDER.indexOf(phase);
    for (let i = 0; i < this.edges.length; i += 1) {
      this.edges[i].classList.toggle('is-active', i < idx);
    }
  }

  private startTimer(): void {
    this.timerStart = Date.now();
    this.timerInterval = setInterval(() => this.tickTimer(), 1000);
    this.tickTimer();
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private tickTimer(): void {
    const sec = Math.floor((Date.now() - this.timerStart) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    this.timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }
}

/** Test hook: phase label map size. */
export function phaseLabelCountForTests(): number {
  return Object.keys(PHASE_LABEL).length;
}
