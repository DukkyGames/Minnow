/**
 * Centered activity overlay — operational log sheet (sub-agent family, vertically centered).
 */

import '../styles/research-activity.css';

import {
  ActivityLogBuffer,
  formatActivityLogLine,
  formatActivityTimestamp,
  type ActivityLogEntry,
} from './activity-log';

export interface ResearchActivityOverlayOptions {
  title?: string;
  getRunning?: () => boolean;
  getElapsedMs?: () => number;
}

interface OverlayState {
  root: HTMLElement;
  list: HTMLElement;
  liveDot: HTMLElement;
  timerEl: HTMLElement;
  jumpChip: HTMLButtonElement;
  returnFocus: HTMLElement | null;
  onKey: (e: KeyboardEvent) => void;
  timerInterval: ReturnType<typeof setInterval> | null;
  userScrolledUp: boolean;
}

let overlay: OverlayState | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function toneClass(tone: ActivityLogEntry['tone']): string {
  if (tone === 'warning') return 'research-activity-row--warning';
  if (tone === 'danger') return 'research-activity-row--danger';
  return '';
}

function renderRow(entry: ActivityLogEntry, isLatest: boolean): string {
  const tone = toneClass(entry.tone);
  const queryHtml =
    entry.queries?.length ?
      `<ul class="research-activity-row__queries">${entry.queries
        .map((q) => `<li>${escapeHtml(q)}</li>`)
        .join('')}</ul>`
    : '';
  const urlHtml =
    entry.url ?
      `<a class="research-activity-row__link" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.url)}</a>`
    : '';
  return `<div class="research-activity-row ${tone}" ${isLatest ? 'aria-live="polite"' : ''}>
    <span class="research-activity-row__time research-mono">${formatActivityTimestamp(entry.atMs)}</span>
    <span class="research-activity-row__label">${escapeHtml(entry.label)}</span>
    ${entry.detail ? `<span class="research-activity-row__detail">${escapeHtml(entry.detail)}</span>` : ''}
    ${queryHtml}
    ${urlHtml}
  </div>`;
}

// ── DOM ──────────────────────────────────────────────────────────────────────

function ensureOverlayDom(options: ResearchActivityOverlayOptions): OverlayState {
  if (overlay) {
    return overlay;
  }

  const root = document.createElement('div');
  root.className = 'research-activity-overlay';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', options.title ?? 'Activity');

  const scrim = document.createElement('button');
  scrim.type = 'button';
  scrim.className = 'research-activity-overlay__scrim';
  scrim.setAttribute('aria-label', 'Close activity log');

  const sheet = document.createElement('div');
  sheet.className = 'research-activity-overlay__sheet';

  const header = document.createElement('header');
  header.className = 'research-activity-overlay__header';

  const heading = document.createElement('div');
  heading.className = 'research-activity-overlay__heading';
  const liveDot = document.createElement('span');
  liveDot.className = 'research-activity-overlay__live';
  liveDot.hidden = true;
  liveDot.setAttribute('aria-hidden', 'true');
  const titleEl = document.createElement('h2');
  titleEl.className = 'research-activity-overlay__title';
  titleEl.textContent = options.title ?? 'Activity';
  heading.append(liveDot, titleEl);

  const timerEl = document.createElement('span');
  timerEl.className = 'research-activity-overlay__timer research-mono';
  timerEl.textContent = '0:00';

  header.append(heading, timerEl);

  const body = document.createElement('div');
  body.className = 'research-activity-overlay__body';

  const list = document.createElement('div');
  list.className = 'research-activity-overlay__list';

  const jumpChip = document.createElement('button');
  jumpChip.type = 'button';
  jumpChip.className = 'research-activity-overlay__jump';
  jumpChip.textContent = 'Jump to latest';
  jumpChip.hidden = true;

  body.append(list, jumpChip);

  const footer = document.createElement('footer');
  footer.className = 'research-activity-overlay__footer';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'research-activity-overlay__btn research-activity-overlay__btn--ghost';
  copyBtn.textContent = 'Copy log';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'research-activity-overlay__btn research-activity-overlay__btn--primary';
  closeBtn.textContent = 'Close';

  footer.append(copyBtn, closeBtn);
  sheet.append(header, body, footer);
  root.append(scrim, sheet);
  document.body.appendChild(root);

  const close = () => closeResearchActivityOverlay();

  scrim.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  copyBtn.addEventListener('click', () => {
    const text = list
      .querySelectorAll('.research-activity-row')
      .length ?
        Array.from(list.querySelectorAll('.research-activity-row'))
          .map((row) => row.textContent?.trim() ?? '')
          .filter(Boolean)
          .join('\n')
      : '';
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  });

  jumpChip.addEventListener('click', () => {
    overlay!.userScrolledUp = false;
    jumpChip.hidden = true;
    list.scrollTop = list.scrollHeight;
  });

  list.addEventListener('scroll', () => {
    if (!overlay) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    overlay.userScrolledUp = !nearBottom;
    jumpChip.hidden = !overlay.userScrolledUp;
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  overlay = {
    root,
    list,
    liveDot,
    timerEl,
    jumpChip,
    returnFocus: null,
    onKey,
    timerInterval: null,
    userScrolledUp: false,
  };

  return overlay;
}

function paintOverlay(
  buffer: ActivityLogBuffer,
  options: ResearchActivityOverlayOptions,
): void {
  if (!overlay) return;
  const entries = buffer.getEntries();
  const running = options.getRunning?.() ?? false;
  overlay.liveDot.hidden = !running;
  overlay.timerEl.textContent = formatClock(options.getElapsedMs?.() ?? 0);

  if (!entries.length) {
    overlay.list.innerHTML =
      '<p class="research-activity-overlay__empty">Activity will appear here when the run starts.</p>';
    return;
  }

  const lastIndex = entries.length - 1;
  overlay.list.innerHTML = entries
    .map((entry, index) => renderRow(entry, index === lastIndex))
    .join('');

  if (!overlay.userScrolledUp) {
    overlay.list.scrollTop = overlay.list.scrollHeight;
    overlay.jumpChip.hidden = true;
  }
}

function startOverlayTimer(
  buffer: ActivityLogBuffer,
  options: ResearchActivityOverlayOptions,
): void {
  if (!overlay) return;
  if (overlay.timerInterval) {
    clearInterval(overlay.timerInterval);
  }
  overlay.timerInterval = setInterval(() => paintOverlay(buffer, options), 500);
}

function stopOverlayTimer(): void {
  if (overlay?.timerInterval) {
    clearInterval(overlay.timerInterval);
    overlay.timerInterval = null;
  }
}

// ── Open close ───────────────────────────────────────────────────────────────

/** Open the centered activity overlay bound to a log buffer. */
export function openResearchActivityOverlay(
  buffer: ActivityLogBuffer,
  options: ResearchActivityOverlayOptions = {},
  returnFocus?: HTMLElement | null,
): void {
  const state = ensureOverlayDom(options);
  state.returnFocus = returnFocus ?? (document.activeElement as HTMLElement | null);
  state.userScrolledUp = false;
  state.root.hidden = false;
  state.root.classList.add('is-open');
  document.addEventListener('keydown', state.onKey);
  buffer.markRead();
  paintOverlay(buffer, options);
  startOverlayTimer(buffer, options);
  state.list.focus();
}

/** Close the activity overlay without destroying it. */
export function closeResearchActivityOverlay(): void {
  if (!overlay) return;
  overlay.root.classList.remove('is-open');
  overlay.root.hidden = true;
  document.removeEventListener('keydown', overlay.onKey);
  stopOverlayTimer();
  const focus = overlay.returnFocus;
  overlay.returnFocus = null;
  focus?.focus?.();
}

/** Remove overlay DOM (teardown). */
export function destroyResearchActivityOverlay(): void {
  if (!overlay) return;
  closeResearchActivityOverlay();
  overlay.root.remove();
  overlay = null;
}

/** Refresh overlay contents when the buffer changes. */
export function bindResearchActivityOverlay(
  buffer: ActivityLogBuffer,
  options: ResearchActivityOverlayOptions,
): () => void {
  const repaint = () => {
    if (overlay && !overlay.root.hidden) {
      paintOverlay(buffer, options);
    }
  };
  return buffer.subscribe(repaint);
}

/** Plain-text export of all buffer rows. */
export function activityLogPlainText(buffer: ActivityLogBuffer): string {
  return buffer
    .getEntries()
    .map((entry) => formatActivityLogLine(entry))
    .join('\n');
}

/** Whether the overlay is currently open. */
export function isResearchActivityOverlayOpen(): boolean {
  return Boolean(overlay && !overlay.root.hidden);
}
