/**
 * Drag the desktop workspace drawer left edge to resize width (persisted in localStorage).
 */

const STORAGE_KEY = 'minnow.os.desktopWorkspaceDrawerWidth';
export const DEFAULT_WORKSPACE_DRAWER_W = 560;
export const WORKSPACE_DRAWER_MIN_W = 320;
export const WORKSPACE_DRAWER_MAX_W = 960;

let bound = false;

function getDesktopLayer(): HTMLElement | null {
  return document.getElementById('osDesktopLayer');
}

function getDrawer(): HTMLElement | null {
  return document.querySelector('.mn-os-workspace-rail-drawer');
}

/** Clamp drawer width against the desktop layer viewport. */
export function clampWorkspaceDrawerWidth(px: number, layer?: HTMLElement | null): number {
  const layerWidth = layer?.getBoundingClientRect().width ?? window.innerWidth;
  const viewportCap = Math.max(WORKSPACE_DRAWER_MIN_W, Math.floor(layerWidth * 0.75));
  const maxWidth = Math.min(WORKSPACE_DRAWER_MAX_W, viewportCap);
  if (!Number.isFinite(px)) return DEFAULT_WORKSPACE_DRAWER_W;
  return Math.min(maxWidth, Math.max(WORKSPACE_DRAWER_MIN_W, Math.round(px)));
}

function loadSavedWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_DRAWER_W;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : DEFAULT_WORKSPACE_DRAWER_W;
  } catch {
    return DEFAULT_WORKSPACE_DRAWER_W;
  }
}

function saveWidth(px: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(px));
  } catch {
    /* quota / private mode */
  }
}

/** Apply drawer width via CSS variable on the desktop layer. */
export function applyDesktopWorkspaceDrawerWidth(px: number): void {
  const layer = getDesktopLayer();
  if (!layer) return;
  const clamped = clampWorkspaceDrawerWidth(px, layer);
  layer.style.setProperty('--desktop-workspace-drawer-w', `${clamped}px`);
}

/** Restore saved drawer width when the rail mounts. */
export function restoreDesktopWorkspaceDrawerWidth(): void {
  applyDesktopWorkspaceDrawerWidth(loadSavedWidth());
}

function schedulePreviewLayoutSync(): void {
  void import('../ui/preview-electron-visibility').then((m) =>
    m.scheduleElectronPreviewHostLayoutSync(),
  );
}

function syncResizerEnabled(): void {
  const handle = document.getElementById('desktopWorkspaceDrawerResize');
  const rail = document.querySelector('.mn-os-workspace-rail');
  if (!handle || !rail) return;
  const expanded = rail.classList.contains('is-expanded');
  const mobile = window.matchMedia('(max-width: 640px)').matches;
  const enabled = expanded && !mobile;
  handle.hidden = !enabled;
  handle.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  handle.tabIndex = enabled ? 0 : -1;
  if (!enabled) handle.classList.remove('dragging');
}

/** Wire left-edge drag resize on the workspace drawer. */
export function initDesktopWorkspaceRailResize(): void {
  if (bound) return;
  const drawer = getDrawer();
  const handle = document.getElementById('desktopWorkspaceDrawerResize');
  if (!drawer || !handle) return;
  bound = true;

  restoreDesktopWorkspaceDrawerWidth();
  syncResizerEnabled();

  let dragging = false;

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging || handle.hidden) return;
    const layer = getDesktopLayer();
    const rect = drawer.getBoundingClientRect();
    const next = clampWorkspaceDrawerWidth(rect.right - e.clientX, layer);
    applyDesktopWorkspaceDrawerWidth(next);
    schedulePreviewLayoutSync();
    handle.setAttribute('aria-valuenow', String(next));
  };

  const stopDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    drawer.classList.remove('is-resizing');
    handle.classList.remove('dragging');
    document.body.style.removeProperty('cursor');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
    window.removeEventListener('blur', stopDrag);

    const width = drawer.getBoundingClientRect().width;
    if (width >= WORKSPACE_DRAWER_MIN_W) saveWidth(width);
    schedulePreviewLayoutSync();
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || handle.hidden) return;
    e.preventDefault();
    dragging = true;
    drawer.classList.add('is-resizing');
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    const layer = getDesktopLayer();
    const maxWidth = clampWorkspaceDrawerWidth(WORKSPACE_DRAWER_MAX_W, layer);
    handle.setAttribute('aria-valuenow', String(drawer.getBoundingClientRect().width));
    handle.setAttribute('aria-valuemin', String(WORKSPACE_DRAWER_MIN_W));
    handle.setAttribute('aria-valuemax', String(maxWidth));
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    window.addEventListener('blur', stopDrag);
  });

  handle.addEventListener('lostpointercapture', stopDrag);

  window.addEventListener('resize', () => {
    const layer = getDesktopLayer();
    const current = drawer.getBoundingClientRect().width;
    applyDesktopWorkspaceDrawerWidth(current);
    schedulePreviewLayoutSync();
    syncResizerEnabled();
  });

  window.matchMedia('(max-width: 640px)').addEventListener('change', syncResizerEnabled);
}

/** Re-enable/disable resize handle when drawer opens or closes. */
export function syncDesktopWorkspaceRailResize(): void {
  syncResizerEnabled();
}

/** Reset bindings (tests). */
export function resetDesktopWorkspaceRailResizeForTests(): void {
  bound = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    getDesktopLayer()?.style.removeProperty('--desktop-workspace-drawer-w');
  }
}
