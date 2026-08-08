/**
 * Operating mode segmented control (General / Build / Plan / Debug).
 *
 * Plan is one plain segment. Super Plan used to hang off it behind a caret —
 * a disclosure menu inside a radio button, which is neither a radio nor a menu
 * and was invisible until hovered. It is a top-bar destination now (see
 * `super-plan-entry.ts`), so the strip is four equal segments again.
 */

import { isActiveChatStreaming } from '../chat/streaming-state';
import { isComposerRecoveryBlocked } from './composer-send';
import { getDefaultWorkAgentForMode } from '../agents/work-agent-registry';
import { syncWorkAgentDevFromActiveChat } from './work-agent-dev';
import { listComposerModes, listModes } from '../chat/modes/registry';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import {
  getActiveChat,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from '../state/sessions';
import { renderChatFromHistory } from './messages';
import { setStatus } from './status';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import { syncViewModeToggleFromActiveChat } from './view-mode-toggle';
import { refreshComposerRunTargetDisabled } from './composer-run-target';
import { createModeMaskIcon, syncModeIconInDom } from './mode-icons';

const MODE_STATUS_MS = 2200;

let modeSelectorRoot: HTMLElement | null = null;
let statusHideTimer: ReturnType<typeof setTimeout> | null = null;
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
  // Hub keeps labelled segments (horizontal scroll on the strip when tight).
  if (isHubComposerModeSelector(root)) {
    root.classList.remove('mode-segmented--compact');
    return;
  }

  if (shouldModeSelectorBeCompact(root)) {
    root.classList.add('mode-segmented--compact');
  } else {
    root.classList.remove('mode-segmented--compact');
  }
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

/**
 * Super Plan is not on the strip, but a Super Plan chat is still in the plan
 * family — keep Plan lit rather than showing four unselected segments.
 */
function isPlanFamilyMode(modeId: ModeId | string | null | undefined): boolean {
  const normalized = normalizeModeId(modeId ?? undefined);
  return normalized === 'plan' || normalized === 'super-plan';
}

/** Apply active chat mode to segment buttons. */
export function syncModeSelectorFromActiveChat(): void {
  const root = getModeSelectorEl();
  if (!root || !sessionState) return;

  const chat = getActiveChat();
  root.hidden = isBoardManagedChat(chat);
  if (root.hidden) return;

  const activeId = normalizeModeId(chat.modeId);
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-mode-id]');
  let index = 0;
  let selectedIndex = 0;

  buttons.forEach((btn) => {
    const segmentModeId = btn.dataset.modeId as ModeId;
    const isSelected =
      segmentModeId === 'plan' ? isPlanFamilyMode(activeId) : segmentModeId === activeId;

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

/** Build segments and wire handlers (idempotent). */
export function initModeSelector(): void {
  const root = getModeSelectorEl();
  if (!root || root.dataset.initialized === 'true') return;

  root.innerHTML = '';
  root.setAttribute('role', 'radiogroup');

  for (const mode of listComposerModes()) {
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
