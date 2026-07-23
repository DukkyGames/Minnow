/**
 * Draggable width resizers for the Email spine rail and reader dock.
 * Widths persist in localStorage so the layout survives reloads.
 */

const STORAGE_KEY = 'minnow.email.panelWidths';
const MOBILE_LAYOUT_MQ = '(max-width: 640px)';

export const DEFAULT_EMAIL_RAIL_W = 244;
export const EMAIL_RAIL_MIN_W = 180;
export const EMAIL_RAIL_MAX_W = 420;

export const DEFAULT_EMAIL_READER_DOCK_W = 600;
export const EMAIL_READER_DOCK_MIN_W = 320;
export const EMAIL_READER_DOCK_MAX_W = 960;

interface StoredPanelWidths {
  rail?: number;
  readerDock?: number;
}

let storedWidths: StoredPanelWidths | null = null;

function isMobileLayout(): boolean {
  return window.matchMedia(MOBILE_LAYOUT_MQ).matches;
}

function readStored(): StoredPanelWidths {
  if (storedWidths) return storedWidths;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    storedWidths = raw ? (JSON.parse(raw) as StoredPanelWidths) : {};
  } catch {
    storedWidths = {};
  }
  return storedWidths;
}

function writeStored(patch: Partial<StoredPanelWidths>): void {
  const next = { ...readStored(), ...patch };
  storedWidths = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or privacy mode — live drag still works for the session.
  }
}

export function clampEmailRailWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_EMAIL_RAIL_W;
  return Math.min(EMAIL_RAIL_MAX_W, Math.max(EMAIL_RAIL_MIN_W, Math.round(px)));
}

export function clampEmailReaderDockWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_EMAIL_READER_DOCK_W;
  return Math.min(EMAIL_READER_DOCK_MAX_W, Math.max(EMAIL_READER_DOCK_MIN_W, Math.round(px)));
}

export function resolvedEmailRailWidth(): number {
  return clampEmailRailWidth(readStored().rail ?? DEFAULT_EMAIL_RAIL_W);
}

export function resolvedEmailReaderDockWidth(): number {
  return clampEmailReaderDockWidth(readStored().readerDock ?? DEFAULT_EMAIL_READER_DOCK_W);
}

/** Push persisted panel widths onto the shell as CSS variables. */
export function syncEmailShellWidthVars(shell: HTMLElement): void {
  shell.style.setProperty('--email-rail-w', `${resolvedEmailRailWidth()}px`);
  shell.style.setProperty('--email-reader-dock-w', `${resolvedEmailReaderDockWidth()}px`);
}

function maxWidthForContainer(containerRect: DOMRect, minWidth: number, hardMax: number): number {
  const viewportCap = Math.floor(containerRect.width * 0.55);
  return Math.max(minWidth, Math.min(hardMax, viewportCap));
}

function setResizerEnabled(resizer: HTMLElement, enabled: boolean): void {
  resizer.hidden = !enabled;
  resizer.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  resizer.tabIndex = enabled ? 0 : -1;
  if (!enabled) resizer.classList.remove('dragging');
}

type PanelResizeSide = 'start' | 'end';

interface BindPanelResizerOptions {
  resizer: HTMLElement;
  container: HTMLElement;
  side: PanelResizeSide;
  minWidth: number;
  hardMaxWidth: number;
  readWidth: () => number;
  writeWidth: (width: number) => void;
  onWidthChange: (width: number) => void;
  isEnabled?: () => boolean;
  onDragEnd?: () => void;
}

function bindPanelResizer(options: BindPanelResizerOptions): void {
  const {
    resizer,
    container,
    side,
    minWidth,
    hardMaxWidth,
    readWidth,
    writeWidth,
    onWidthChange,
    isEnabled,
    onDragEnd,
  } = options;
  let dragging = false;

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging || resizer.hidden) return;
    const rect = container.getBoundingClientRect();
    const maxWidth = maxWidthForContainer(rect, minWidth, hardMaxWidth);
    const nextWidth =
      side === 'start' ? e.clientX - rect.left : rect.right - e.clientX;
    const clamped = Math.min(maxWidth, Math.max(minWidth, Math.round(nextWidth)));
    writeWidth(clamped);
    onWidthChange(clamped);
    resizer.setAttribute('aria-valuenow', String(clamped));
    resizer.setAttribute('aria-valuemin', String(minWidth));
    resizer.setAttribute('aria-valuemax', String(maxWidth));
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
    onDragEnd?.();
  };

  resizer.addEventListener('pointerdown', (e) => {
    if (resizer.hidden || isEnabled?.() === false) return;
    e.preventDefault();
    dragging = true;
    resizer.classList.add('dragging');
    resizer.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    const rect = container.getBoundingClientRect();
    const maxWidth = maxWidthForContainer(rect, minWidth, hardMaxWidth);
    resizer.setAttribute('aria-valuenow', String(readWidth()));
    resizer.setAttribute('aria-valuemin', String(minWidth));
    resizer.setAttribute('aria-valuemax', String(maxWidth));
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    window.addEventListener('blur', stopDrag);
  });

  resizer.addEventListener('lostpointercapture', stopDrag);
}

function createResizer(className: string, label: string): HTMLElement {
  const resizer = document.createElement('div');
  resizer.className = className;
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', label);
  return resizer;
}

/** Mount the rail's right-edge drag handle once per shell. */
export function mountEmailRailResizer(rail: HTMLElement, shell: HTMLElement): void {
  if (rail.querySelector('.email-panel-resizer--rail')) return;

  const resizer = createResizer(
    'email-panel-resizer email-panel-resizer--rail',
    'Resize email navigation',
  );
  rail.appendChild(resizer);
  syncEmailShellWidthVars(shell);

  const syncEnabled = (): void => {
    setResizerEnabled(resizer, !isMobileLayout());
  };

  bindPanelResizer({
    resizer,
    container: shell,
    side: 'start',
    minWidth: EMAIL_RAIL_MIN_W,
    hardMaxWidth: EMAIL_RAIL_MAX_W,
    readWidth: resolvedEmailRailWidth,
    writeWidth: (width) => {
      writeStored({ rail: width });
    },
    onWidthChange: () => {
      syncEmailShellWidthVars(shell);
    },
    isEnabled: () => !isMobileLayout(),
    onDragEnd: () => {
      writeStored({ rail: resolvedEmailRailWidth() });
    },
  });

  syncEnabled();
  window.addEventListener('resize', syncEnabled);
}

/** Mount the reader dock's left-edge drag handle on the surface (persists across dock redraws). */
export function mountEmailReaderDockResizer(surface: HTMLElement): void {
  if (surface.querySelector('.email-panel-resizer--reader')) return;

  const shell = surface.closest<HTMLElement>('.email-shell-a');
  const resizer = createResizer(
    'email-panel-resizer email-panel-resizer--reader',
    'Resize message reader',
  );
  surface.appendChild(resizer);

  const syncEnabled = (): void => {
    const open = surface.classList.contains('has-reader');
    setResizerEnabled(resizer, !isMobileLayout() && open);
  };

  bindPanelResizer({
    resizer,
    container: surface,
    side: 'end',
    minWidth: EMAIL_READER_DOCK_MIN_W,
    hardMaxWidth: EMAIL_READER_DOCK_MAX_W,
    readWidth: resolvedEmailReaderDockWidth,
    writeWidth: (width) => {
      writeStored({ readerDock: width });
    },
    onWidthChange: () => {
      if (shell) syncEmailShellWidthVars(shell);
    },
    isEnabled: () => !isMobileLayout() && surface.classList.contains('has-reader'),
    onDragEnd: () => {
      writeStored({ readerDock: resolvedEmailReaderDockWidth() });
    },
  });

  syncEnabled();
  window.addEventListener('resize', syncEnabled);

  (surface as HTMLElement & { syncEmailReaderResizer?: () => void }).syncEmailReaderResizer =
    syncEnabled;
}

/** Enable or hide the reader resizer when the dock opens or closes. */
export function syncEmailReaderDockResizer(surface: HTMLElement): void {
  const sync = (surface as HTMLElement & { syncEmailReaderResizer?: () => void })
    .syncEmailReaderResizer;
  sync?.();
}

/** Test helper — reset cached widths and clear persisted storage. */
export function resetEmailPanelWidthsForTests(): void {
  storedWidths = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Test helper — drop the in-memory cache so the next read hits storage. */
export function invalidateEmailPanelWidthCacheForTests(): void {
  storedWidths = null;
}
