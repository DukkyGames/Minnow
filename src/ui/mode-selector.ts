/**
 * Operating mode segmented control (General / Build / Plan / Orchestrate / Reef / Debug).
 */

import { isActiveChatStreaming } from '../chat/streaming-state';
import { isComposerRecoveryBlocked } from './composer-send';
import { getDefaultWorkAgentForMode } from '../agents/work-agent-registry';
import { syncReefWidgetSettingsFromActiveChat } from './reef-widget-settings';
import { syncWorkAgentDevFromActiveChat } from './work-agent-dev';
import { listComposerModes, listModes } from '../chat/modes/registry';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import {
  getActiveChat,
  isExpertChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { unmountReefWidgetsInChat } from '../chat/reef';
import { renderChatFromHistory } from './messages';
import { setStatus } from './status';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import { syncViewModeToggleFromActiveChat } from './view-mode-toggle';
import { isOsShellEnabled } from '../os/page-bridge';

const MODE_STATUS_MS = 2200;

let modeSelectorRoot: HTMLElement | null = null;
let launcherRoot: HTMLElement | null = null;
let statusHideTimer: ReturnType<typeof setTimeout> | null = null;

function getModeSelectorEl(): HTMLElement | null {
  if (!modeSelectorRoot) {
    modeSelectorRoot = document.getElementById('modeSelector');
  }
  return modeSelectorRoot;
}

function getLauncherEl(): HTMLElement | null {
  if (!launcherRoot) {
    launcherRoot = document.getElementById('modeLauncher');
  }
  return launcherRoot;
}

async function launchSuperPlan(): Promise<void> {
  const { getActiveComposerSurface } = await import('./composer-surface');
  const seed =
    getActiveComposerSurface().inputEl?.value.trim() ||
    (document.getElementById('desktopInput') as HTMLTextAreaElement | null)?.value.trim() ||
    undefined;

  if (isOsShellEnabled()) {
    const { launchApp } = await import('../os/router');
    launchApp('code', { superPlan: true, seed });
    return;
  }

  const { openCodeSuperPlan } = await import('../os/superplan-code');
  await openCodeSuperPlan(seed);
}

/** Apply active chat mode to segment buttons. */
export function syncModeSelectorFromActiveChat(): void {
  const root = getModeSelectorEl();
  if (!root) return;

  const chat = getActiveChat();
  if (isExpertChat(chat) && chat.modeId !== 'general') {
    setChatMode('general');
  }

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
  refreshModeLauncherDisabled();
  syncModeLauncherVisibility();
}

/** Show Super Plan launcher when Plan mode is active. */
function syncModeLauncherVisibility(): void {
  const launcher = getLauncherEl();
  if (!launcher) {
    return;
  }
  const show = normalizeModeId(getActiveChat().modeId) === 'plan';
  launcher.hidden = !show;
  launcher.toggleAttribute('hidden', !show);
}

/** Disable panel launchers while the model is streaming. */
export function refreshModeLauncherDisabled(): void {
  const root = getLauncherEl();
  if (!root) return;
  const disabled = isActiveChatStreaming() || isComposerRecoveryBlocked();
  root.querySelectorAll<HTMLButtonElement>('[data-mode-launcher]').forEach((btn) => {
    btn.disabled = disabled;
  });
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
  if (isExpertChat(chat)) {
    if (modeId !== 'general') {
      return { ok: false, error: 'Expert chats use General mode' };
    }
  }

  const normalized = modeId;
  if (chat.modeId === normalized) {
    const mode = listModes().find((m) => m.id === normalized);
    return { ok: true, modeId: normalized, label: mode?.label };
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
  unmountReefWidgetsInChat();
  renderChatFromHistory(getActiveChat());
  syncModeSelectorFromActiveChat();
  refreshModeLauncherDisabled();
  void syncOrchestratePlanStripFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();

  if (normalized === 'plan') {
    void import('../superplan/plan-intake').then((m) => m.onPlanModeActivated(chat));
  }

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
    btn.textContent = mode.label;
    btn.title = mode.description;

    btn.addEventListener('click', () => selectMode(mode.id));
    btn.addEventListener('keydown', (e) => onSegmentKeydown(e, mode.id));

    root.appendChild(btn);
  }

  root.dataset.initialized = 'true';
  initModeLauncher();
  syncModeLauncherVisibility();
}

/** Panel launchers beside mode segments (not ModeIds). */
function initModeLauncher(): void {
  const toolbar = document.getElementById('composerControls');
  if (!toolbar || document.getElementById('modeLauncher')) {
    return;
  }

  const launcher = document.createElement('div');
  launcher.id = 'modeLauncher';
  launcher.className = 'mode-launcher';
  launcher.setAttribute('role', 'group');
  launcher.setAttribute('aria-label', 'Plan tools');

  const superPlanBtn = document.createElement('button');
  superPlanBtn.type = 'button';
  superPlanBtn.className = 'mode-launcher-btn';
  superPlanBtn.dataset.modeLauncher = 'superplan';
  superPlanBtn.textContent = 'Super Plan';
  superPlanBtn.title = 'Open Super Plan — intake, research, and multi-draft planning';
  superPlanBtn.addEventListener('click', () => {
    void launchSuperPlan();
  });

  launcher.appendChild(superPlanBtn);
  launcher.hidden = true;

  const thinkingWrap = document.getElementById('composerThinkingWrap');
  if (thinkingWrap) {
    toolbar.insertBefore(launcher, thinkingWrap);
  } else {
    toolbar.appendChild(launcher);
  }

  refreshModeLauncherDisabled();
}
