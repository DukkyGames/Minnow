/**
 * Operating mode segmented control (General / Build / Plan / Debug).
 */

import { isActiveChatStreaming } from '../chat/streaming-state';
import { isComposerRecoveryBlocked } from './composer-send';
import { getDefaultWorkAgentForMode } from '../agents/work-agent-registry';
import { syncWorkAgentDevFromActiveChat } from './work-agent-dev';
import { getMode, listComposerModes, listModes } from '../chat/modes/registry';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import {
  getActiveChat,
  isExpertChat,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from '../state/sessions';
import { renderChatFromHistory } from './messages';
import { setStatus } from './status';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import { syncViewModeToggleFromActiveChat } from './view-mode-toggle';
import { refreshComposerRunTargetDisabled } from './composer-run-target';
import {
  applyModeMaskIcon,
  createModeMaskIcon,
  syncModeIconInDom,
} from './mode-icons';

const MODE_STATUS_MS = 2200;

const PLAN_SUBMENU_ITEMS: ReadonlyArray<{ id: ModeId; label: string }> = [
  { id: 'plan', label: 'Plan' },
  { id: 'super-plan', label: 'Super Plan' },
];

let modeSelectorRoot: HTMLElement | null = null;
let statusHideTimer: ReturnType<typeof setTimeout> | null = null;
let planSubmenuDocListener: ((event: MouseEvent) => void) | null = null;
let modeSelectorCompactObserver: ResizeObserver | null = null;

function measureComposerGapPx(parent: HTMLElement): number {
  const style = getComputedStyle(parent);
  const raw = style.columnGap !== 'normal' ? style.columnGap : style.gap;
  const gap = parseFloat(raw);
  return Number.isFinite(gap) ? gap : 0;
}

function getComposerControlsRow(root: HTMLElement): HTMLElement | null {
  return root.closest('#composerControls') as HTMLElement | null;
}

function isHubComposerModeSelector(root: HTMLElement): boolean {
  return Boolean(root.closest('.input-bar--hub'));
}

/** Space left in #composerControls for the mode strip (not its current icon-only width). */
function availableModeSelectorWidth(root: HTMLElement): number {
  const row = getComposerControlsRow(root) ?? root.parentElement;
  if (!row) return root.clientWidth;

  const gap = measureComposerGapPx(row);
  const childCount = row.children.length;
  let siblingsWidth = 0;

  for (const child of row.children) {
    if (child === root) continue;
    const el = child as HTMLElement;
    if (el.classList.contains('hidden') || el.hidden) continue;
    siblingsWidth += el.getBoundingClientRect().width;
  }

  const totalGap = childCount > 1 ? gap * (childCount - 1) : 0;
  return Math.max(0, row.clientWidth - siblingsWidth - totalGap);
}

/** Natural labelled strip width without flex shrink or max-width squeezing the measure. */
function measureLabelledModeSelectorWidth(root: HTMLElement): number {
  root.classList.add('mode-segmented--measuring');
  void root.offsetWidth;
  const width = root.scrollWidth;
  root.classList.remove('mode-segmented--measuring');
  return width;
}

/** True when labelled segments need more space than the composer row can give them. */
function shouldModeSelectorBeCompact(root: HTMLElement): boolean {
  const availableWidth = availableModeSelectorWidth(root);
  root.classList.remove('mode-segmented--compact');
  const labelledWidth = measureLabelledModeSelectorWidth(root);
  return labelledWidth > availableWidth + 1;
}

/** Hide segment labels when labelled content cannot fit the space left in the composer row. */
function syncModeSelectorCompact(root: HTMLElement): void {
  if (root.querySelector('.is-submenu-open')) return;

  // Hub keeps labelled segments (horizontal scroll on the strip when tight).
  if (isHubComposerModeSelector(root)) {
    root.classList.remove('mode-segmented--compact');
    syncPlanSegmentCompactAffordance(root);
    return;
  }

  if (shouldModeSelectorBeCompact(root)) {
    root.classList.add('mode-segmented--compact');
  } else {
    root.classList.remove('mode-segmented--compact');
  }

  syncPlanSegmentCompactAffordance(root);
}

/** Re-run compact layout after composer siblings (branch/worktree chips) change width. */
export function refreshModeSelectorLayout(): void {
  const root = getModeSelectorEl();
  if (!root) return;
  syncModeSelectorCompact(root);
}

/** Observe a composer sibling inserted after boot (e.g. run-target wrap). */
export function observeModeSelectorComposerSibling(el: HTMLElement): void {
  const root = getModeSelectorEl();
  if (!root) return;

  if (modeSelectorCompactObserver) {
    modeSelectorCompactObserver.observe(el);
  }
  syncModeSelectorCompact(root);
}

function isModeSelectorCompact(root: HTMLElement | null = getModeSelectorEl()): boolean {
  return root?.classList.contains('mode-segmented--compact') ?? false;
}

function syncPlanSegmentCompactAffordance(root: HTMLElement): void {
  const planBtn = root.querySelector<HTMLButtonElement>('.mode-segment--plan');
  if (!planBtn) return;

  const compact = isModeSelectorCompact(root);
  const mode = getMode('plan');
  if (compact) {
    planBtn.title = `${mode.label} — choose Plan or Super Plan`;
    planBtn.setAttribute('aria-label', `${mode.label}, open plan mode menu`);
    return;
  }

  if (!sessionState) return;
  const activeId = normalizeModeId(getActiveChat().modeId);
  const displayMode = getMode(resolvePlanFamilyDisplayMode(activeId));
  planBtn.title = displayMode.description;
  planBtn.setAttribute('aria-label', displayMode.label);
}

function attachModeSelectorCompactObserver(root: HTMLElement): void {
  if (modeSelectorCompactObserver) return;
  const row = getComposerControlsRow(root) ?? root.parentElement;
  if (!row) return;

  if (typeof ResizeObserver === 'undefined') {
    syncModeSelectorCompact(root);
    return;
  }

  modeSelectorCompactObserver = new ResizeObserver(() => {
    syncModeSelectorCompact(root);
  });
  modeSelectorCompactObserver.observe(root);
  modeSelectorCompactObserver.observe(row);
  for (const child of row.children) {
    if (child !== root) modeSelectorCompactObserver.observe(child);
  }
  syncModeSelectorCompact(root);
}

function getModeSelectorEl(): HTMLElement | null {
  if (!modeSelectorRoot) {
    modeSelectorRoot = document.getElementById('modeSelector');
  }
  return modeSelectorRoot;
}

/** Board-managed chats must retain the role and tool policy assigned by the orchestrator. */
function isBoardManagedChat(chat: ReturnType<typeof getActiveChat>): boolean {
  return Boolean(chat.boardGroupId?.trim() || chat.boardTaskId?.trim());
}

function isPlanFamilyMode(modeId: ModeId | string | null | undefined): boolean {
  const normalized = normalizeModeId(modeId ?? undefined);
  return normalized === 'plan' || normalized === 'super-plan';
}

function resolvePlanFamilyDisplayMode(activeId: ModeId): ModeId {
  return isPlanFamilyMode(activeId) ? normalizeModeId(activeId) : 'plan';
}

function closePlanSubmenu(): void {
  if (planSubmenuDocListener) {
    document.removeEventListener('click', planSubmenuDocListener);
    planSubmenuDocListener = null;
  }
  document.querySelectorAll('.mode-submenu').forEach((el) => el.remove());
  document
    .querySelectorAll('.mode-segment-wrap--plan.is-submenu-open')
    .forEach((el) => el.classList.remove('is-submenu-open'));
  document.querySelectorAll<HTMLButtonElement>('.mode-segment__caret').forEach((caret) => {
    caret.setAttribute('aria-expanded', 'false');
  });
}

function openPlanSubmenu(wrap: HTMLElement, caret: HTMLButtonElement): void {
  const existing = wrap.querySelector('.mode-submenu');
  if (existing) {
    closePlanSubmenu();
    return;
  }

  closePlanSubmenu();
  wrap.classList.add('is-submenu-open');
  caret.setAttribute('aria-expanded', 'true');

  const activeId = normalizeModeId(getActiveChat().modeId);
  const menu = document.createElement('div');
  menu.className = 'mode-submenu';
  menu.setAttribute('role', 'menu');

  for (const item of PLAN_SUBMENU_ITEMS) {
    const itemBtn = document.createElement('button');
    itemBtn.type = 'button';
    itemBtn.className = 'mode-submenu__item';
    itemBtn.setAttribute('role', 'menuitem');
    itemBtn.dataset.modeId = item.id;
    itemBtn.textContent = item.label;
    if (item.id === activeId) {
      itemBtn.setAttribute('aria-current', 'true');
    }
    itemBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      closePlanSubmenu();
      setChatMode(item.id);
    });
    menu.appendChild(itemBtn);
  }

  wrap.appendChild(menu);

  planSubmenuDocListener = (event: MouseEvent) => {
    if (!wrap.contains(event.target as Node)) {
      closePlanSubmenu();
      caret.setAttribute('aria-expanded', 'false');
    }
  };
  setTimeout(() => {
    if (planSubmenuDocListener) {
      document.addEventListener('click', planSubmenuDocListener);
    }
  }, 0);
}

function syncPlanSegmentDisplay(btn: HTMLButtonElement, activeId: ModeId): void {
  const displayModeId = resolvePlanFamilyDisplayMode(activeId);
  const mode = getMode(displayModeId);
  const icon = btn.querySelector<HTMLElement>('.mode-segment__icon');
  const label = btn.querySelector('.mode-segment__label');
  if (icon) applyModeMaskIcon(icon, displayModeId);
  if (label) label.textContent = mode.label;
  btn.title = mode.description;
  btn.setAttribute('aria-label', mode.label);
}

/** Apply active chat mode to segment buttons. */
export function syncModeSelectorFromActiveChat(): void {
  const root = getModeSelectorEl();
  if (!root || !sessionState) return;

  const chat = getActiveChat();
  root.hidden = isBoardManagedChat(chat);
  if (root.hidden) {
    closePlanSubmenu();
    return;
  }

  const activeId = normalizeModeId(chat.modeId);
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-mode-id]');
  let index = 0;
  let selectedIndex = 0;

  buttons.forEach((btn) => {
    const segmentModeId = btn.dataset.modeId as ModeId;
    const isPlanSegment = segmentModeId === 'plan';
    const isSelected = isPlanSegment
      ? isPlanFamilyMode(activeId)
      : segmentModeId === activeId;

    if (isPlanSegment) {
      syncPlanSegmentDisplay(btn, activeId);
    }

    btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    btn.tabIndex = isSelected ? 0 : -1;
    if (isSelected) selectedIndex = index;
    index += 1;
  });

  root.setAttribute(
    'aria-label',
    `Operating mode, ${listModes().find((m) => m.id === activeId)?.label ?? activeId}, selected, ${selectedIndex + 1} of ${buttons.length}`,
  );

  refreshModeSelectorDisabled();
  syncModeSelectorCompact(root);
}

/** Disable segments while the model is streaming. */
export function refreshModeSelectorDisabled(): void {
  const root = getModeSelectorEl();
  if (!root) return;
  const disabled = isActiveChatStreaming() || isComposerRecoveryBlocked();
  root.querySelectorAll<HTMLButtonElement>('[data-mode-id]').forEach((btn) => {
    btn.disabled = disabled;
  });
  root.querySelectorAll<HTMLButtonElement>('.mode-segment__caret').forEach((btn) => {
    btn.disabled = disabled;
  });
  refreshComposerRunTargetDisabled();
}

function showModeStatusPill(label: string): void {
  setStatus('ok', `Mode: ${label}`);
  if (statusHideTimer) clearTimeout(statusHideTimer);
  statusHideTimer = setTimeout(() => {
    statusHideTimer = null;
    setStatus('idle', '');
  }, MODE_STATUS_MS);
}

export interface SetChatModeResult {
  ok: boolean;
  modeId?: ModeId;
  label?: string;
  error?: string;
}

/** Apply operating mode to the active chat (tool / programmatic handoff). */
export function setChatMode(modeId: ModeId): SetChatModeResult {
  if (isActiveChatStreaming()) {
    return { ok: false, error: 'Finish the current reply first' };
  }

  const chat = getActiveChat();

  const normalized = modeId;
  if (chat.modeId === normalized) {
    const mode = listModes().find((m) => m.id === normalized);
    return { ok: true, modeId: normalized, label: mode?.label };
  }

  if (isBoardManagedChat(chat)) {
    return {
      ok: false,
      error: 'Board chats keep the role assigned by the orchestrator',
    };
  }

  chat.modeId = normalized;
  if (normalizeModeId(normalized) === 'orchestrate' && !chat.orchestrateBoard) {
    // Keep the empty-chat hub visible until there is history or a mounted board.
    chat.viewMode = chat.history.length > 0 ? 'board' : 'chat';
  }
  if (chat.workAgentAuto !== false) {
    const agent = getDefaultWorkAgentForMode(normalized);
    chat.workAgentId = agent?.id ?? null;
  }
  touchChat(chat);
  scheduleSaveSessions();
  renderChatFromHistory(getActiveChat());
  syncModeSelectorFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncWorkAgentDevFromActiveChat();

  const mode = listModes().find((m) => m.id === normalized);
  if (mode) showModeStatusPill(mode.label);
  syncModeIconInDom(chat.id, normalized);
  return { ok: true, modeId: normalized, label: mode?.label };
}

function selectMode(modeId: ModeId): void {
  setChatMode(modeId);
}

function onSegmentKeydown(event: KeyboardEvent, modeId: ModeId): void {
  const root = getModeSelectorEl();
  if (!root || isActiveChatStreaming()) return;

  const modes = listComposerModes();
  const currentIndex = modes.findIndex((m) => m.id === modeId);
  if (currentIndex < 0) return;

  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % modes.length;
    event.preventDefault();
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + modes.length) % modes.length;
    event.preventDefault();
  } else if (event.key === 'Home') {
    nextIndex = 0;
    event.preventDefault();
  } else if (event.key === 'End') {
    nextIndex = modes.length - 1;
    event.preventDefault();
  } else {
    return;
  }

  const nextId = modes[nextIndex].id;
  selectMode(nextId);
  const nextBtn = root.querySelector<HTMLButtonElement>(
    `[data-mode-id="${nextId}"]`,
  );
  nextBtn?.focus();
}

function buildPlanSegment(mode: ReturnType<typeof listComposerModes>[number]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mode-segment-wrap mode-segment-wrap--plan';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mode-segment mode-segment--plan';
  btn.dataset.modeId = mode.id;
  btn.setAttribute('role', 'radio');
  btn.setAttribute('aria-checked', 'false');
  btn.title = mode.description;
  btn.setAttribute('aria-label', mode.label);

  const icon = createModeMaskIcon(mode.id, 'mode-segment__icon mode-mask-icon');
  const label = document.createElement('span');
  label.className = 'mode-segment__label';
  label.textContent = mode.label;
  btn.append(icon, label);

  btn.addEventListener('click', (event) => {
    if (isActiveChatStreaming() || isComposerRecoveryBlocked()) return;

    const root = getModeSelectorEl();
    const caret = wrap.querySelector<HTMLButtonElement>('.mode-segment__caret');
    if (root && isModeSelectorCompact(root) && caret) {
      event.preventDefault();
      event.stopPropagation();
      openPlanSubmenu(wrap, caret);
      return;
    }

    const activeId = normalizeModeId(getActiveChat().modeId);
    selectMode(isPlanFamilyMode(activeId) ? activeId : 'plan');
  });
  btn.addEventListener('keydown', (e) => onSegmentKeydown(e, mode.id));

  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'mode-segment__caret';
  caret.setAttribute('aria-label', 'Plan mode options');
  caret.setAttribute('aria-haspopup', 'menu');
  caret.setAttribute('aria-expanded', 'false');
  caret.textContent = '▾';
  caret.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isActiveChatStreaming() || isComposerRecoveryBlocked()) return;
    openPlanSubmenu(wrap, caret);
  });

  wrap.append(btn, caret);
  return wrap;
}

/** Build segments and wire handlers (idempotent). */
export function initModeSelector(): void {
  const root = getModeSelectorEl();
  if (!root || root.dataset.initialized === 'true') return;

  root.innerHTML = '';
  root.setAttribute('role', 'radiogroup');

  for (const mode of listComposerModes()) {
    if (mode.id === 'plan') {
      root.appendChild(buildPlanSegment(mode));
      continue;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-segment';
    btn.dataset.modeId = mode.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.title = mode.description;
    btn.setAttribute('aria-label', mode.label);

    const icon = createModeMaskIcon(mode.id, 'mode-segment__icon mode-mask-icon');
    const label = document.createElement('span');
    label.className = 'mode-segment__label';
    label.textContent = mode.label;
    btn.append(icon, label);

    btn.addEventListener('click', () => selectMode(mode.id));
    btn.addEventListener('keydown', (e) => onSegmentKeydown(e, mode.id));

    root.appendChild(btn);
  }

  root.dataset.initialized = 'true';
  attachModeSelectorCompactObserver(root);
  syncModeSelectorFromActiveChat();
}

/** Tear down observers and DOM for unit tests. */
export function disposeModeSelectorForTests(): void {
  closePlanSubmenu();
  if (modeSelectorCompactObserver) {
    modeSelectorCompactObserver.disconnect();
    modeSelectorCompactObserver = null;
  }
  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }
  modeSelectorRoot = null;
  const root = document.getElementById('modeSelector');
  if (root) {
    root.innerHTML = '';
    root.classList.remove('mode-segmented--compact');
    delete root.dataset.initialized;
  }
}
