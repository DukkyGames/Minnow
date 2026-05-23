/**
 * Operating mode segmented control (Build / Plan / Orchestrate / Research).
 */

import { isActiveChatStreaming } from '../chat/streaming-state';
import { isComposerRecoveryBlocked } from './composer-send';
import { getDefaultWorkAgentForMode } from '../agents/work-agent-registry';
import { syncReefWidgetSettingsFromActiveChat } from './reef-widget-settings';
import { syncWorkAgentDevFromActiveChat } from './work-agent-dev';
import { listModes } from '../chat/modes/registry';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { unmountReefWidgetsInChat } from '../chat/reef';
import { renderChatFromHistory } from './messages';
import { setStatus } from './status';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import { syncViewModeToggleFromActiveChat } from './view-mode-toggle';

const MODE_STATUS_MS = 2200;

let modeSelectorRoot: HTMLElement | null = null;
let statusHideTimer: ReturnType<typeof setTimeout> | null = null;

function getModeSelectorEl(): HTMLElement | null {
  if (!modeSelectorRoot) {
    modeSelectorRoot = document.getElementById('modeSelector');
  }
  return modeSelectorRoot;
}

/** Apply active chat mode to segment buttons. */
export function syncModeSelectorFromActiveChat(): void {
  const root = getModeSelectorEl();
  if (!root) return;

  const activeId = getActiveChat().modeId ?? 'build';
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-mode-id]');
  let index = 0;
  let selectedIndex = 0;

  buttons.forEach((btn) => {
    const modeId = btn.dataset.modeId as ModeId;
    const isSelected = modeId === activeId;
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
}

/** Disable segments while the model is streaming. */
export function refreshModeSelectorDisabled(): void {
  const root = getModeSelectorEl();
  if (!root) return;
  const disabled = isActiveChatStreaming() || isComposerRecoveryBlocked();
  root.querySelectorAll<HTMLButtonElement>('[data-mode-id]').forEach((btn) => {
    btn.disabled = disabled;
  });
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

  chat.modeId = normalized;
  if (normalizeModeId(normalized) === 'orchestrate' && !chat.orchestrateBoard) {
    chat.viewMode = 'board';
  }
  if (normalizeModeId(normalized) === 'debug') {
    chat.viewMode = 'board';
  }
  if (chat.workAgentAuto !== false) {
    const agent = getDefaultWorkAgentForMode(normalized);
    chat.workAgentId = agent?.id ?? null;
  }
  touchChat(chat);
  scheduleSaveSessions();
  unmountReefWidgetsInChat();
  renderChatFromHistory(getActiveChat());
  syncModeSelectorFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();

  const mode = listModes().find((m) => m.id === normalized);
  if (mode) showModeStatusPill(mode.label);
  return { ok: true, modeId: normalized, label: mode?.label };
}

function selectMode(modeId: ModeId): void {
  setChatMode(modeId);
}

function onSegmentKeydown(event: KeyboardEvent, modeId: ModeId): void {
  const root = getModeSelectorEl();
  if (!root || isActiveChatStreaming()) return;

  const modes = listModes();
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

  for (const mode of listModes()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-segment';
    btn.dataset.modeId = mode.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.textContent = mode.label;
    btn.title = mode.description;

    btn.addEventListener('click', () => selectMode(mode.id));
    btn.addEventListener('keydown', (e) => onSegmentKeydown(e, mode.id));

    root.appendChild(btn);
  }

  root.dataset.initialized = 'true';
  syncModeSelectorFromActiveChat();
}
