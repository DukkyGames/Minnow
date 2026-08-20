/**
 * Compact Code composer strip: when the controls row is too narrow, keep
 * mode / cog / model / context wheel on the row and park the rest in the cog
 * sheet. Compact moves the cog next to the mode dropdown; CSS `order` puts
 * the wheel last.
 *
 * Hub (`.input-bar--hub`) and active chat share `#composerControls`, so one
 * observer covers both. Threshold is width-based with hysteresis — not live
 * overflow measuring — so a few leftover icons never keep the dense row.
 */

import { closeModeSelectorMenu } from './mode-selector';
import { closeComposerRunTargetMenus } from './composer-run-target';
import {
  closeComposerToolsPopover,
  fillComposerToolsPopover,
} from './composer-tools-popover';

/** Enter compact at or below this controls-row width (covers ~665–710px overflow). */
export const COMPOSER_COMPACT_ENTER_PX = 880;

/** Leave compact only after the row grows past this, so the class does not flicker. */
export const COMPOSER_COMPACT_LEAVE_PX = 920;

/**
 * Controls that leave the compact row. Order is the overflow sheet top-to-bottom.
 * Mode, cog, model, and the context wheel stay on the row.
 */
const OVERFLOW_ITEM_IDS = [
  'composerRunTargetWrap',
  'composerThinkingWrap',
  'composerContextDocumentsWrap',
  'composerCodeMapWrap',
  'composerBrainNotesWrap',
  'orchestratePlanStrip',
  'workAgentDev',
  'btnViewModeToggleBoard',
  'composerToolsAnchor',
] as const;

const overflowHomes = new Map<string, { parent: Node; next: ChildNode | null }>();

let compact = false;
let overflowOpen = false;
let rowObserver: ResizeObserver | null = null;
let outsideHandler: ((event: PointerEvent) => void) | null = null;
let escapeHandler: ((event: KeyboardEvent) => void) | null = null;
let controlsChangedHandler: ((event: Event) => void) | null = null;
let initialized = false;
/** Original neighbor of the overflow sheet before it was portaled to `document.body`. */
let overflowPopoverHome: { parent: Node; next: ChildNode | null } | null = null;

function getRow(): HTMLElement | null {
  return document.getElementById('composerControls');
}

function getInputBar(): HTMLElement | null {
  return getRow()?.closest('.input-bar') as HTMLElement | null;
}

function getOverflowButton(): HTMLButtonElement | null {
  return document.getElementById('btnComposerOverflow') as HTMLButtonElement | null;
}

function getOverflowPopover(): HTMLElement | null {
  return document.getElementById('composerOverflowPopover');
}

function getOverflowSlot(): HTMLElement | null {
  return document.getElementById('composerOverflowSlot');
}

/** True when the Code composer is in the compact strip. */
export function isComposerControlsCompact(): boolean {
  return compact;
}

/**
 * Width hysteresis for the compact strip. Widths ≤ 0 keep the current state
 * (the row is not laid out yet).
 */
export function nextComposerCompactState(current: boolean, width: number): boolean {
  if (!Number.isFinite(width) || width <= 0) return current;
  if (current) return width <= COMPOSER_COMPACT_LEAVE_PX;
  return width < COMPOSER_COMPACT_ENTER_PX;
}

function detachOverflowListeners(): void {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler, true);
    outsideHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
}

/**
 * Viewport box used to keep the overflow sheet on screen and, when it fits,
 * inside the Code chat column so it does not slide under the chats sidebar.
 */
export type ComposerOverflowViewport = {
  width: number;
  height: number;
  columnLeft?: number;
  columnRight?: number;
  margin?: number;
};

/**
 * Clamp a viewport-fixed overflow sheet. Prefers the chat column (`#mainColumn`)
 * when the sheet fits there; otherwise keeps the preferred left and only
 * viewport-clamps so a too-narrow column can still overlay the sidebar.
 */
export function clampComposerOverflowPlacement(
  box: { top: number; left: number; width: number; height: number },
  viewport: ComposerOverflowViewport,
): { top: number; left: number } {
  const margin = viewport.margin ?? 8;
  let { top, left } = box;
  const { width, height } = box;

  const colLeft = viewport.columnLeft;
  const colRight = viewport.columnRight;
  const columnInner =
    colLeft != null && colRight != null ? colRight - colLeft - margin * 2 : Number.NaN;

  // Sheet fits in the chat column: keep it to the right of the chats sidebar.
  if (Number.isFinite(columnInner) && width <= columnInner && colLeft != null && colRight != null) {
    const minLeft = colLeft + margin;
    const maxLeft = colRight - width - margin;
    left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));
  }

  const minLeft = margin;
  const maxLeft = viewport.width - width - margin;
  left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));

  const minTop = margin;
  const maxTop = viewport.height - height - margin;
  top = Math.min(Math.max(top, minTop), Math.max(minTop, maxTop));

  return { top, left };
}

/**
 * Lift the sheet to `document.body` while open. `#mainColumn` uses
 * `container-type: inline-size`, which creates a stacking context; a
 * `position:fixed` descendant at z-index 36 then paints under `.chat-sidebar`
 * (also 36) even though the sheet is "fixed".
 */
function portalOverflowPopover(popover: HTMLElement): void {
  if (popover.parentElement === document.body) return;
  if (popover.parentNode) {
    overflowPopoverHome = { parent: popover.parentNode, next: popover.nextSibling };
  }
  document.body.appendChild(popover);
}

/** Put the hidden sheet back next to the cog so compact DOM stays predictable. */
function unportalOverflowPopover(popover: HTMLElement): void {
  const home = overflowPopoverHome;
  overflowPopoverHome = null;
  if (!home?.parent.isConnected) return;
  const next = home.next && home.next.isConnected ? home.next : null;
  home.parent.insertBefore(popover, next);
}

/** Close the overflow settings sheet (cog popover). */
export function closeComposerOverflowPopover(): void {
  const popover = getOverflowPopover();
  const button = getOverflowButton();
  if (!popover) {
    overflowOpen = false;
    overflowPopoverHome = null;
    return;
  }
  popover.classList.add('hidden');
  overflowOpen = false;
  button?.setAttribute('aria-expanded', 'false');
  detachOverflowListeners();
  unportalOverflowPopover(popover);
}

/** Place a panel above `anchor`, flipping below if it would clip the viewport. */
function positionFixedPanel(anchor: HTMLElement, panel: HTMLElement, align: 'start' | 'end'): void {
  panel.style.position = 'fixed';
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  const height = panel.offsetHeight || panel.getBoundingClientRect().height;
  const width = panel.offsetWidth || panel.getBoundingClientRect().width;

  let top = rect.top - height - gap;
  if (top < margin) {
    top = rect.bottom + gap;
  }

  const column = document.getElementById('mainColumn');
  const columnRect = column?.getBoundingClientRect();
  const preferredLeft = align === 'end' ? rect.right - width : rect.left;
  const placed = clampComposerOverflowPlacement(
    { top, left: preferredLeft, width, height },
    {
      width: window.innerWidth,
      height: window.innerHeight,
      columnLeft: columnRect?.left,
      columnRight: columnRect?.right,
      margin,
    },
  );

  panel.style.top = `${Math.round(placed.top)}px`;
  panel.style.left = `${Math.round(placed.left)}px`;
}

function attachOverflowListeners(): void {
  detachOverflowListeners();

  outsideHandler = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    const popover = getOverflowPopover();
    const button = getOverflowButton();
    if (popover?.contains(target) || button?.contains(target)) return;
    closeComposerOverflowPopover();
  };
  document.addEventListener('pointerdown', outsideHandler, true);

  escapeHandler = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !overflowOpen) return;
    event.stopPropagation();
    closeComposerOverflowPopover();
    getOverflowButton()?.focus();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

function openOverflowPopover(): void {
  const popover = getOverflowPopover();
  const button = getOverflowButton();
  if (!popover || !button || !compact) return;

  closeModeSelectorMenu();
  try {
    fillComposerToolsPopover();
  } catch {
    /* Tools list is lazy; an empty section is still better than failing the sheet. */
  }
  // Portal before un-hiding so the first paint is already above the sidebar.
  portalOverflowPopover(popover);
  popover.classList.remove('hidden');
  overflowOpen = true;
  button.setAttribute('aria-expanded', 'true');
  positionFixedPanel(button, popover, 'end');
  attachOverflowListeners();
}

function toggleOverflowPopover(): void {
  if (overflowOpen) {
    closeComposerOverflowPopover();
    return;
  }
  openOverflowPopover();
}

function overflowKey(el: HTMLElement): string {
  return el.id || el.dataset.overflowId || '';
}

function ensureOverflowKey(el: HTMLElement): string {
  if (el.id) return el.id;
  if (!el.dataset.overflowId) {
    el.dataset.overflowId = `anon-${el.className.slice(0, 24)}`;
  }
  return el.dataset.overflowId;
}

/** Move one control into the overflow slot, remembering its original neighbor. */
function parkElement(el: HTMLElement, slot: HTMLElement): void {
  if (slot.contains(el)) return;
  const key = ensureOverflowKey(el);
  if (!overflowHomes.has(key) && el.parentNode) {
    overflowHomes.set(key, { parent: el.parentNode, next: el.nextSibling });
  }
  slot.appendChild(el);
}

/** Put a parked control back next to the sibling it had before compact. */
function restoreElement(el: HTMLElement): void {
  const key = overflowKey(el);
  const home = key ? overflowHomes.get(key) : undefined;
  if (key) overflowHomes.delete(key);
  if (home?.parent.isConnected) {
    const next = home.next && home.next.isConnected ? home.next : null;
    home.parent.insertBefore(el, next);
    return;
  }
  const row = getRow();
  const trail = row?.querySelector('.composer-controls__trail');
  if (el.id === 'composerToolsAnchor' || el.id === 'btnViewModeToggleBoard') {
    const overflowAnchor = document.getElementById('composerOverflowAnchor');
    if (overflowAnchor?.parentElement) {
      overflowAnchor.parentElement.insertBefore(el, overflowAnchor);
      return;
    }
  }
  if (trail && row) {
    row.insertBefore(el, trail);
  } else {
    row?.appendChild(el);
  }
}

function overflowElements(): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const id of OVERFLOW_ITEM_IDS) {
    const el = document.getElementById(id);
    if (el) found.push(el);
  }
  return found;
}

function setToolsPopoverInline(inline: boolean): void {
  const popover = document.getElementById('composerToolsPopover');
  if (!popover) return;
  popover.classList.toggle('hidden', !inline);
}

/**
 * Compact row is flex, not a 4-column grid: the cog must be a sibling of the
 * mode dropdown. Leaving it inside the trail (or promoting it with
 * display:contents) dropped it onto a second implicit row.
 */
function placeOverflowAnchor(compactMode: boolean): void {
  const anchor = document.getElementById('composerOverflowAnchor');
  const trail = getRow()?.querySelector('.composer-controls__trail');
  if (!anchor) return;

  if (!compactMode) {
    if (trail && anchor.parentElement !== trail) trail.appendChild(anchor);
    return;
  }

  const dropdown = document.getElementById('modeSelectorDropdown');
  const row = dropdown?.parentElement ?? getRow();
  if (!row) return;
  if (dropdown && anchor.parentElement === row && dropdown.nextSibling === anchor) return;
  if (dropdown) {
    row.insertBefore(anchor, dropdown.nextSibling);
    return;
  }
  if (row.firstChild !== anchor) row.insertBefore(anchor, row.firstChild);
}

/** Park (or restore) overflow controls to match the current compact flag. */
export function refreshComposerCompactOverflow(): void {
  const slot = getOverflowSlot();
  if (!slot) return;

  if (compact) {
    for (const el of overflowElements()) {
      parkElement(el, slot);
    }
    setToolsPopoverInline(true);
    placeOverflowAnchor(true);
    return;
  }

  // Overflow must be back in the trail before restore uses it as nextSibling.
  placeOverflowAnchor(false);
  setToolsPopoverInline(false);
  // Reverse order so stored nextSibling pointers are already back in the row.
  for (const el of overflowElements().reverse()) {
    if (slot.contains(el)) restoreElement(el);
  }
}

function applyCompactClass(next: boolean): void {
  const row = getRow();
  const bar = getInputBar();
  row?.classList.toggle('composer-controls--compact', next);
  bar?.classList.toggle('input-bar--composer-compact', next);
}

function applyCompactState(next: boolean): void {
  const changed = compact !== next;
  compact = next;
  applyCompactClass(next);

  if (changed) {
    closeComposerOverflowPopover();
    closeModeSelectorMenu();
    closeComposerRunTargetMenus();
    closeComposerToolsPopover();
  }

  refreshComposerCompactOverflow();
}

/**
 * Apply hysteresis to a measured `#composerControls` width.
 * Widths ≤ 0 are ignored (not laid out yet).
 */
export function syncComposerCompactFromWidth(width: number): boolean {
  const next = nextComposerCompactState(compact, width);
  if (next !== compact) applyCompactState(next);
  return compact;
}

function measureAndSync(): void {
  const row = getRow();
  if (!row) return;
  syncComposerCompactFromWidth(row.clientWidth);
}

function onOverflowButtonClick(event: MouseEvent): void {
  event.stopPropagation();
  toggleOverflowPopover();
}

function onControlsChanged(): void {
  refreshComposerCompactOverflow();
  if (overflowOpen) {
    const button = getOverflowButton();
    const popover = getOverflowPopover();
    if (button && popover) positionFixedPanel(button, popover, 'end');
  }
}

/** Wire the compact observer and overflow cog (idempotent). */
export function initComposerCompact(): void {
  const row = getRow();
  const button = getOverflowButton();
  if (!row || !button || initialized) return;
  initialized = true;

  button.addEventListener('click', onOverflowButtonClick);

  controlsChangedHandler = () => onControlsChanged();
  document.addEventListener('minnow:composer-controls-changed', controlsChangedHandler);
  document.addEventListener('minnow:close-composer-overflow', closeComposerOverflowPopover);

  if (typeof ResizeObserver === 'undefined') {
    measureAndSync();
    return;
  }

  rowObserver = new ResizeObserver(() => {
    measureAndSync();
  });
  rowObserver.observe(row);
  measureAndSync();
}

/** Tear down observers and restore parked nodes (unit tests). */
export function disposeComposerCompactForTests(): void {
  closeComposerOverflowPopover();
  if (compact) applyCompactState(false);
  rowObserver?.disconnect();
  rowObserver = null;
  if (controlsChangedHandler) {
    document.removeEventListener('minnow:composer-controls-changed', controlsChangedHandler);
    controlsChangedHandler = null;
  }
  document.removeEventListener('minnow:close-composer-overflow', closeComposerOverflowPopover);
  const button = getOverflowButton();
  button?.removeEventListener('click', onOverflowButtonClick);
  overflowHomes.clear();
  overflowPopoverHome = null;
  initialized = false;
  compact = false;
  overflowOpen = false;
  getRow()?.classList.remove('composer-controls--compact');
  getInputBar()?.classList.remove('input-bar--composer-compact');
}
