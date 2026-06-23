/**
 * Super Plan progress UI — multi-stage stepper + live status feed.
 */

import type { SuperPlanProgress, SuperPlanStage } from './types';

const STEPS = [
  { key: 'intake', label: 'Gathering requirements', short: 'Intake' },
  { key: 'spec', label: 'Building specification', short: 'Build Spec' },
  { key: 'research', label: 'Researching context', short: 'Research' },
  { key: 'draft1', label: 'Writing first draft', short: 'Draft' },
  { key: 'review1', label: 'Reviewing draft', short: 'Review' },
  { key: 'draft2', label: 'Writing second draft', short: 'Draft 2' },
  { key: 'review2', label: 'Second review pass', short: 'Review 2' },
  { key: 'impeccable', label: 'Polishing UI design', short: 'UI Design' },
  { key: 'finalize', label: 'Finalizing plan', short: 'Finalize' },
] as const;

export type SuperPlanStepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Map pipeline stage to stepper index. */
export function progressStageToStep(stage: SuperPlanStage | undefined): SuperPlanStepIndex {
  switch (stage) {
    case 'intake':
      return 0;
    case 'spec':
      return 1;
    case 'research':
      return 2;
    case 'draft1':
      return 3;
    case 'review1':
      return 4;
    case 'draft2':
      return 5;
    case 'review2':
      return 6;
    case 'impeccable':
      return 7;
    case 'finalize':
    case 'done':
      return 8;
    case 'error':
    default:
      return 0;
  }
}

export interface SuperPlanProgressPanelOptions {
  onCancel?: () => void;
  onConfirmSpec?: () => void;
  onReviseSpec?: () => void;
}

interface FeedLine {
  stage: SuperPlanStage;
  message: string;
  at: number;
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

/** Live Super Plan progress panel driven by controller progress events. */
export class SuperPlanProgressPanel {
  private readonly mount: HTMLElement;
  private readonly options: SuperPlanProgressPanelOptions;
  private root: HTMLElement | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private timerStart = 0;
  private stepIndex: SuperPlanStepIndex = 0;
  private status: 'running' | 'done' | 'error' | 'cancelled' | 'awaiting_user' = 'running';
  private statusMessage = '';
  private feed: FeedLine[] = [];
  private specPreview = '';
  private awaitingSpecConfirmation = false;
  private showCancel = true;

  constructor(mount: HTMLElement, options: SuperPlanProgressPanelOptions = {}) {
    this.mount = mount;
    this.options = options;
  }

  reset(): void {
    this.stopTimer();
    this.stepIndex = 0;
    this.feed = [];
    this.status = 'running';
    this.statusMessage = '';
    this.specPreview = '';
    this.awaitingSpecConfirmation = false;
    this.showCancel = true;
    this.timerStart = performance.now();
    this.root = document.createElement('div');
    this.root.className = 'sp-prog';
    this.mount.replaceChildren(this.root);
    this.startTimer();
    this.paint();
  }

  destroy(): void {
    this.stopTimer();
    this.mount.replaceChildren();
    this.root = null;
  }

  setStatus(
    status: 'running' | 'done' | 'error' | 'cancelled' | 'awaiting_user',
    message?: string,
  ): void {
    this.status = status;
    if (message) {
      this.statusMessage = message;
    }
    if (status === 'done') {
      this.stepIndex = 8;
      this.showCancel = false;
      this.stopTimer();
    }
    if (status === 'error' || status === 'cancelled') {
      this.showCancel = false;
      this.stopTimer();
    }
    this.paint();
  }

  apply(event: SuperPlanProgress): void {
    if (!this.root) {
      return;
    }

    if (event.stage === 'error') {
      this.status = 'error';
      this.statusMessage = event.message;
      this.pushFeed('error', event.message);
      this.stopTimer();
      this.paint();
      return;
    }

    this.stepIndex = progressStageToStep(event.stage);

    if (event.stage === 'done') {
      this.status = 'done';
      this.showCancel = false;
      this.stopTimer();
    }

    if (event.stage === 'spec') {
      this.awaitingSpecConfirmation = Boolean(event.awaitingUser);
      if (event.preview) {
        this.specPreview = event.preview;
      }
      if (event.awaitingUser) {
        this.status = 'awaiting_user';
      }
    } else {
      this.awaitingSpecConfirmation = false;
      if (this.status === 'awaiting_user') {
        this.status = 'running';
      }
    }

    if (event.message) {
      this.pushFeed(event.stage, event.message);
    }

    this.paint();
  }

  getElapsedMs(): number {
    return this.timerStart ? performance.now() - this.timerStart : 0;
  }

  private pushFeed(stage: SuperPlanStage, message: string): void {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    const last = this.feed[this.feed.length - 1];
    if (last && last.message === trimmed && last.stage === stage) {
      return;
    }
    this.feed.push({ stage, message: trimmed, at: Date.now() });
    if (this.feed.length > 40) {
      this.feed.shift();
    }
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
    const el = this.root?.querySelector('[data-sp-timer]');
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
        ? this.statusMessage || 'Super Plan failed'
        : this.status === 'cancelled'
          ? 'Super Plan cancelled'
          : this.status === 'awaiting_user'
            ? 'Review the specification'
            : this.status === 'done'
              ? 'Super Plan complete'
              : step.label;

    const stepperHtml = STEPS.map((s, i) => {
      const st = i < this.stepIndex ? 'done' : i === this.stepIndex ? 'active' : 'todo';
      const track =
        i > 0 ? `<span class="sp-track ${i <= this.stepIndex ? 'fill' : ''}"></span>` : '';
      const inner =
        st === 'done'
          ? '<span class="sp-check" aria-hidden="true">✓</span>'
          : '<span class="sp-node-i"></span>';
      return `${track}<span class="sp-node ${st}" title="${escapeHtml(s.short)}">${inner}</span>`;
    }).join('');

    const labelsHtml = STEPS.map(
      (s, i) =>
        `<span class="sp-slabel sp-mono ${i === this.stepIndex ? 'on' : i < this.stepIndex ? 'did' : ''}">${escapeHtml(s.short)}</span>`,
    ).join('');

    const specGateHtml =
      this.awaitingSpecConfirmation && this.specPreview
        ? `<div class="sp-spec-gate">
            <div class="sp-spec-preview sp-mono">${escapeHtml(this.specPreview)}</div>
            <div class="sp-spec-actions">
              <button type="button" class="sp-btn sp-btn-primary" data-sp-confirm-spec>Confirm</button>
              <button type="button" class="sp-btn sp-btn-ghost" data-sp-revise-spec>Revise</button>
            </div>
          </div>`
        : '';

    const feedHtml =
      this.feed.length > 0
        ? `<div class="sp-feed">${this.feed
            .map(
              (line, i) => `<div class="sp-feed-row ${i === this.feed.length - 1 && this.status === 'running' ? 'live' : ''}">
                <span class="sp-feed-stage sp-mono">${escapeHtml(line.stage)}</span>
                <span class="sp-feed-msg">${escapeHtml(line.message)}</span>
              </div>`,
            )
            .join('')}</div>`
        : '';

    const cancelHtml =
      this.showCancel && this.options.onCancel
        ? `<div class="sp-prog-actions">
            <button type="button" class="sp-btn sp-btn-ghost sp-cancel" data-sp-cancel>Cancel</button>
          </div>`
        : '';

    this.root.innerHTML = `
      <div class="sp-prog-head">
        <div class="sp-prog-title"><span class="sp-dot"></span> ${escapeHtml(label)}</div>
        <div class="sp-timer sp-mono" data-sp-timer>${formatClock(this.getElapsedMs())}</div>
      </div>
      <div class="sp-stepper">${stepperHtml}</div>
      <div class="sp-stepper-labels">${labelsHtml}</div>
      ${specGateHtml}
      ${feedHtml}
      ${cancelHtml}
    `;

    this.root.querySelector('[data-sp-cancel]')?.addEventListener('click', () => {
      this.options.onCancel?.();
    });
    this.root.querySelector('[data-sp-confirm-spec]')?.addEventListener('click', () => {
      this.awaitingSpecConfirmation = false;
      this.status = 'running';
      this.options.onConfirmSpec?.();
      this.paint();
    });
    this.root.querySelector('[data-sp-revise-spec]')?.addEventListener('click', () => {
      this.options.onReviseSpec?.();
    });
  }
}
