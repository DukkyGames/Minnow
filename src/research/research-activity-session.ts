/**
 * Shared research activity session — buffer, trigger button, and overlay wiring.
 */

import { ActivityLogBuffer } from './activity-log';
import {
  bindResearchActivityOverlay,
  closeResearchActivityOverlay,
  isResearchActivityOverlayOpen,
  openResearchActivityOverlay,
} from './activity-overlay';
import type { ResearchProgress } from './types';

export interface ResearchActivitySessionOptions {
  buttonMount?: HTMLElement | null;
  buttonInsert?: 'prepend' | 'append';
  getRunning?: () => boolean;
  getElapsedMs?: () => number;
  title?: string;
}

/** Manages activity log buffer + button + overlay for a single research run. */
export class ResearchActivitySession {
  readonly buffer = new ActivityLogBuffer();
  private button: HTMLButtonElement | null = null;
  private bar: HTMLElement | null = null;
  private unbindOverlay: (() => void) | null = null;
  private unbindBuffer: (() => void) | null = null;
  private options: ResearchActivitySessionOptions = {};
  private timerStart = 0;
  private frozenElapsedMs = 0;
  private running = false;

  configure(options: ResearchActivitySessionOptions): void {
    this.options = options;
    this.unbindOverlay?.();
    this.unbindOverlay = bindResearchActivityOverlay(this.buffer, {
      title: options.title ?? 'Activity',
      getRunning: () => this.running,
      getElapsedMs: () => this.getElapsedMs(),
    });
    this.unbindBuffer?.();
    this.unbindBuffer = this.buffer.subscribe(() => this.syncButton());
  }

  /** Mount or refresh the Activity trigger button. */
  mountButton(mount: HTMLElement | null | undefined): void {
    if (!mount) {
      this.button?.remove();
      this.bar?.remove();
      this.button = null;
      this.bar = null;
      return;
    }

    if (!this.bar) {
      this.bar = document.createElement('div');
      this.bar.className = 'research-activity-bar';
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.className = 'research-activity-btn';
      this.button.addEventListener('click', () => this.open());
      this.bar.appendChild(this.button);
    }

    if (this.options.buttonInsert === 'prepend') {
      mount.prepend(this.bar);
    } else {
      mount.appendChild(this.bar);
    }

    this.syncButton();
  }

  /** Mount into desktop research progress chrome when present. */
  mountDesktopChromeButton(): void {
    const chrome = document.querySelector('.mn-os-research-progress-chrome');
    if (!chrome) return;
    this.configure({ buttonInsert: 'prepend' });
    this.mountButton(chrome as HTMLElement);
  }

  reset(): void {
    this.buffer.clear();
    this.running = true;
    this.timerStart = performance.now();
    this.frozenElapsedMs = 0;
    this.syncButton();
  }

  hydrate(events: ResearchProgress[]): void {
    this.buffer.hydrateFromResearchProgress(events);
    this.syncButton();
  }

  appendProgress(event: ResearchProgress): void {
    this.buffer.appendFromResearchProgress(event);
    this.syncButton();
  }

  setRunning(running: boolean): void {
    this.running = running;
    if (!running) {
      this.frozenElapsedMs = this.getElapsedMs();
    }
    this.syncButton();
  }

  open(): void {
    this.buffer.markRead();
    openResearchActivityOverlay(
      this.buffer,
      {
        title: this.options.title ?? 'Activity',
        getRunning: () => this.running,
        getElapsedMs: () => this.getElapsedMs(),
      },
      this.button,
    );
    this.syncButton();
  }

  close(): void {
    closeResearchActivityOverlay();
  }

  destroy(): void {
    this.unbindOverlay?.();
    this.unbindOverlay = null;
    this.unbindBuffer?.();
    this.unbindBuffer = null;
    this.close();
    this.button?.remove();
    this.bar?.remove();
    this.button = null;
    this.bar = null;
    this.buffer.clear();
    this.running = false;
  }

  private getElapsedMs(): number {
    if (!this.running) {
      return this.frozenElapsedMs;
    }
    return this.timerStart ? performance.now() - this.timerStart : 0;
  }

  private syncButton(): void {
    if (!this.button) return;
    const hasEntries = this.buffer.getEntries().length > 0;
    const show = this.running || hasEntries;
    this.button.hidden = !show;
    if (!show) return;

    const unread = isResearchActivityOverlayOpen() ? 0 : this.buffer.getUnreadCount();
    const liveDot = this.running ?
      '<span class="research-activity-btn__dot is-live" aria-hidden="true"></span>'
    : '';
    const badge =
      unread > 0 ?
        `<span class="research-activity-btn__badge" aria-label="${unread} new">${unread > 99 ? '99+' : unread}</span>`
      : '';
    this.button.innerHTML = `${liveDot}<span>Activity</span>${badge}`;
    this.button.setAttribute(
      'aria-label',
      unread > 0 ? `Activity, ${unread} new entries` : 'Activity',
    );
  }
}
