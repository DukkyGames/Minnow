/**
 * Docked Issues peek width and expand-to-sheet layout.
 *
 * Width is a CSS variable on `.issues-shell`. The expanded sheet is a class on
 * the same shell so remounting the peek body does not lose the mode.
 */

import { scheduleAnimationFrame } from '../lib/schedule-animation-frame';
import { getWorkspacePath } from '../state/workspace';
import { applyIcon } from './icon';

/** Default docked peek width (matches the previous CSS max). */
export const ISSUES_PEEK_DEFAULT_W = 520;
/** Narrowest usable docked peek (matches `minmax(380px, …)`). */
export const ISSUES_PEEK_MIN_W = 380;
/** Absolute cap so the list never collapses to a sliver. */
export const ISSUES_PEEK_HARD_MAX_W = 900;
/** Compact Issues container: list is already replaced by peek. */
export const ISSUES_PEEK_COMPACT_MAX = 900;
/** Fraction of `.issues-body` the docked peek may occupy. */
export const ISSUES_PEEK_MAX_FRACTION = 0.7;
/** localStorage map: workspace path → peek width in px. */
export const ISSUES_PEEK_WIDTH_STORAGE_KEY = 'minnow.issues.peekWidth';

let sheetExpanded = false;
let compactPeek = false;
let pageObserver: ResizeObserver | null = null;

function workspaceStorageKey(): string {
  return getWorkspacePath().trim() || '_';
}

function readWidthMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ISSUES_PEEK_WIDTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeWidthMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(ISSUES_PEEK_WIDTH_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — live CSS var still applies this session */
  }
}

/** Clamp a peek width against min, hard max, and the current Issues body. */
export function clampIssuesPeekWidth(px: number, bodyWidth: number): number {
  if (!Number.isFinite(px)) return ISSUES_PEEK_DEFAULT_W;
  const fractionCap = Math.floor(bodyWidth * ISSUES_PEEK_MAX_FRACTION);
  const maxWidth = Math.max(
    ISSUES_PEEK_MIN_W,
    Math.min(ISSUES_PEEK_HARD_MAX_W, Number.isFinite(fractionCap) ? fractionCap : ISSUES_PEEK_HARD_MAX_W),
  );
  return Math.min(maxWidth, Math.max(ISSUES_PEEK_MIN_W, Math.round(px)));
}

/** Persisted width for the current workspace, or the default. */
export function readIssuesPeekWidth(): number {
  const stored = readWidthMap()[workspaceStorageKey()];
  if (typeof stored !== 'number') return ISSUES_PEEK_DEFAULT_W;
  return stored;
}

/** Remember the docked peek width for this workspace. */
export function persistIssuesPeekWidth(px: number): void {
  const map = readWidthMap();
  map[workspaceStorageKey()] = px;
  writeWidthMap(map);
}

function issuesShell(): HTMLElement | null {
  return document.querySelector('#issuesView .issues-shell');
}

function issuesBody(): HTMLElement | null {
  return document.querySelector('#issuesView .issues-body');
}

function issuesPage(): HTMLElement | null {
  return document.getElementById('issuesView');
}

function peekHost(): HTMLElement | null {
  return document.getElementById('issuesDetailHost');
}

function bodyWidthPx(): number {
  const body = issuesBody();
  const width = body?.getBoundingClientRect().width ?? 0;
  return width > 0 ? width : ISSUES_PEEK_HARD_MAX_W / ISSUES_PEEK_MAX_FRACTION;
}

/** Push `--issues-peek-w` onto the shell so the grid column tracks the handle. */
export function applyIssuesPeekWidthCss(width = readIssuesPeekWidth()): void {
  const shell = issuesShell();
  if (!shell) return;
  const clamped = clampIssuesPeekWidth(width, bodyWidthPx());
  shell.style.setProperty('--issues-peek-w', `${clamped}px`);
}

function paintLayoutExpandButton(): void {
  const btn = document.querySelector<HTMLButtonElement>('.issues-detail__layout-expand');
  if (!btn) return;
  btn.setAttribute('aria-pressed', sheetExpanded ? 'true' : 'false');
  btn.setAttribute(
    'aria-label',
    sheetExpanded ? 'Restore issue peek' : 'Open issue in a larger sheet',
  );
  btn.title = sheetExpanded ? 'Restore peek' : 'Larger view';
  const icon = btn.querySelector<HTMLElement>('.icon-svg');
  if (icon) applyIcon(icon, sheetExpanded ? 'compress' : 'expand', { size: 16 });
}

function syncCompactClass(): void {
  const page = issuesPage();
  const shell = issuesShell();
  if (!page || !shell) return;
  compactPeek = page.clientWidth > 0 && page.clientWidth <= ISSUES_PEEK_COMPACT_MAX;
  shell.classList.toggle('is-peek-compact', compactPeek);
  if (compactPeek && sheetExpanded) {
    setIssueDetailSheetExpanded(false);
  }
}

function syncResizerEnabled(): void {
  const resizer = document.getElementById('issuesDetailResizer');
  const host = peekHost();
  const docked = Boolean(host?.classList.contains('is-open'));
  const enabled = docked && !compactPeek && !sheetExpanded;
  if (!resizer) return;
  resizer.hidden = !enabled;
  resizer.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  resizer.tabIndex = enabled ? 0 : -1;
  if (!enabled) resizer.classList.remove('dragging');
}

function syncSheetClass(): void {
  issuesShell()?.classList.toggle('is-detail-expanded', sheetExpanded);
  const scrim = document.getElementById('issuesDetailScrim');
  if (scrim) {
    scrim.hidden = !sheetExpanded;
    scrim.setAttribute('aria-hidden', sheetExpanded ? 'false' : 'true');
  }
  paintLayoutExpandButton();
  syncResizerEnabled();
}

/** Whether the peek is currently the overlay sheet. */
export function isIssueDetailSheetExpanded(): boolean {
  return sheetExpanded;
}

/** Open or close the overlay sheet. Compact layout always stays docked. */
export function setIssueDetailSheetExpanded(expanded: boolean): void {
  sheetExpanded = expanded && !compactPeek;
  syncSheetClass();
}

/** Collapse the sheet. Returns true when Escape (or scrim) consumed the action. */
export function collapseIssueDetailSheet(): boolean {
  if (!sheetExpanded) return false;
  setIssueDetailSheetExpanded(false);
  return true;
}

function currentPeekWidth(): number {
  const shell = issuesShell();
  const raw = shell?.style.getPropertyValue('--issues-peek-w');
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  return clampIssuesPeekWidth(readIssuesPeekWidth(), bodyWidthPx());
}

function setLivePeekWidth(px: number, persist: boolean): void {
  const clamped = clampIssuesPeekWidth(px, bodyWidthPx());
  applyIssuesPeekWidthCss(clamped);
  const resizer = document.getElementById('issuesDetailResizer');
  resizer?.setAttribute('aria-valuenow', String(clamped));
  resizer?.setAttribute('aria-valuemin', String(ISSUES_PEEK_MIN_W));
  resizer?.setAttribute(
    'aria-valuemax',
    String(clampIssuesPeekWidth(ISSUES_PEEK_HARD_MAX_W, bodyWidthPx())),
  );
  if (persist) persistIssuesPeekWidth(clamped);
}

function bindPeekResizer(resizer: HTMLElement): void {
  let dragging = false;

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || resizer.hidden) return;
    const body = issuesBody();
    if (!body) return;
    const rect = body.getBoundingClientRect();
    // Right-docked column: width is distance from pointer to the body's right edge.
    setLivePeekWidth(rect.right - event.clientX, false);
  };

  const stopDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.removeProperty('cursor');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
    window.removeEventListener('blur', stopDrag);
    persistIssuesPeekWidth(currentPeekWidth());
  };

  resizer.addEventListener('pointerdown', (event) => {
    if (resizer.hidden) return;
    event.preventDefault();
    dragging = true;
    resizer.classList.add('dragging');
    resizer.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    setLivePeekWidth(currentPeekWidth(), false);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    window.addEventListener('blur', stopDrag);
  });
  resizer.addEventListener('lostpointercapture', stopDrag);

  resizer.addEventListener('keydown', (event) => {
    if (resizer.hidden) return;
    const step = event.shiftKey ? 32 : 16;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setLivePeekWidth(currentPeekWidth() + step, true);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setLivePeekWidth(currentPeekWidth() - step, true);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setLivePeekWidth(ISSUES_PEEK_HARD_MAX_W, true);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setLivePeekWidth(ISSUES_PEEK_MIN_W, true);
    }
  });
}

function ensureScrim(body: HTMLElement): HTMLButtonElement {
  let scrim = document.getElementById('issuesDetailScrim') as HTMLButtonElement | null;
  if (scrim) return scrim;
  scrim = document.createElement('button');
  scrim.type = 'button';
  scrim.id = 'issuesDetailScrim';
  scrim.className = 'issues-detail-scrim';
  scrim.hidden = true;
  scrim.setAttribute('aria-hidden', 'true');
  scrim.setAttribute('aria-label', 'Restore issue peek');
  scrim.addEventListener('click', () => {
    collapseIssueDetailSheet();
  });
  body.insertBefore(scrim, peekHost());
  return scrim;
}

function ensureResizer(host: HTMLElement): HTMLElement {
  let resizer = document.getElementById('issuesDetailResizer');
  if (resizer) return resizer;
  resizer = document.createElement('div');
  resizer.id = 'issuesDetailResizer';
  resizer.className = 'issues-detail-resizer';
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', 'Resize issue peek');
  host.insertBefore(resizer, host.firstChild);
  bindPeekResizer(resizer);
  return resizer;
}

function observePageWidth(): void {
  const page = issuesPage();
  if (!page || pageObserver) return;
  const onSize = scheduleAnimationFrame(() => {
    syncCompactClass();
    applyIssuesPeekWidthCss();
    syncResizerEnabled();
  });
  if (typeof ResizeObserver !== 'function') {
    onSize();
    return;
  }
  pageObserver = new ResizeObserver(onSize);
  pageObserver.observe(page);
  onSize();
}

/** Recompute compact, sheet, and resizer after the peek opens or closes. */
export function refreshIssuesPeekLayoutChrome(): void {
  applyIssuesPeekWidthCss();
  syncCompactClass();
  syncSheetClass();
}

/**
 * Create the persistent resizer + scrim (survives peek remounts) and apply
 * stored width. Safe to call on every `ensureDetailHost`.
 */
export function ensureIssuesPeekLayout(host: HTMLElement): void {
  const body = issuesBody();
  if (!body) return;
  if (host.parentElement !== body) body.appendChild(host);
  ensureScrim(body);
  ensureResizer(host);
  refreshIssuesPeekLayoutChrome();
  observePageWidth();
}

/** Drop expand state when the peek itself closes. */
export function resetIssueDetailSheetOnClose(): void {
  sheetExpanded = false;
  syncSheetClass();
}

/** Test helper — module + observer state. */
export function resetIssuesDetailLayoutForTests(): void {
  sheetExpanded = false;
  compactPeek = false;
  pageObserver?.disconnect();
  pageObserver = null;
}
