/**
 * Composer Brain notes (memory retrieve) injection toggle — tri-state like code map.
 */

import { nextThinkingTriStateOnClick } from './composer-thinking';
import {
  fetchMemoryInjectionEnabled,
  resolveBrainNotesInjectionEnabled,
  resolveBrainNotesInjectionTriState,
} from '../memory/config';
import { fetchMemoryEnabled } from '../memory/client';
import { isActiveChatStreaming } from '../chat/streaming-state';
import {
  ensureSessionsReady,
  getActiveChat,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from '../state/sessions';
import type { ThinkingTriState } from '../agents/thinking-types';
import { createIcon } from './icon';
import { isComposerRecoveryBlocked } from './composer-send';
import { refreshContextUsageRing } from './context-usage-ring';

let rootEl: HTMLElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;
let cachedGlobalDefault: boolean | null = null;

function formatBrainNotesTitle(
  tri: ThinkingTriState,
  resolvedOn: boolean,
  globalDefault: boolean,
): string {
  if (tri === 'inherit') {
    const inherited = globalDefault ? 'on' : 'off';
    return `Brain notes: Inherit (${inherited}) — click to set ${resolvedOn ? 'off' : 'on'}`;
  }
  if (tri === 'on') {
    return 'Brain notes: On (chat override) — click to turn off';
  }
  return 'Brain notes: Off (chat override) — click to reset to inherit';
}

function applyChatBrainNotesInjection(mode: ThinkingTriState): void {
  const chat = getActiveChat();
  if (mode === 'inherit') {
    delete chat.brainNotesInjection;
  } else {
    chat.brainNotesInjection = mode;
  }
  touchChat(chat);
  scheduleSaveSessions();
  void syncComposerBrainNotesFromActiveChat();
  refreshContextUsageRing();
}

async function onToggleClick(): Promise<void> {
  if (toggleBtn?.disabled) return;
  const globalDefault =
    cachedGlobalDefault ?? (await fetchMemoryInjectionEnabled());
  cachedGlobalDefault = globalDefault;
  const chat = getActiveChat();
  const tri = resolveBrainNotesInjectionTriState(chat);
  const resolvedOn = resolveBrainNotesInjectionEnabled(chat, globalDefault);
  const resolvedMode = resolvedOn ? 'on' : 'off';
  applyChatBrainNotesInjection(nextThinkingTriStateOnClick(tri, resolvedMode));
}

/** Mount Brain notes toggle into #composerBrainNotesControl. */
export function initBrainNotesInjectionControl(): void {
  rootEl = document.getElementById('composerBrainNotesControl');
  if (!rootEl) return;

  rootEl.innerHTML = '';
  rootEl.className = 'brain-notes-toggle-host';

  toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'brain-notes-toggle-btn thinking-toggle-btn';
  toggleBtn.setAttribute('aria-label', 'Brain notes injection');
  toggleBtn.addEventListener('click', () => {
    void onToggleClick();
  });

  const icon = createIcon('brainMemories', { className: 'thinking-toggle-icon' });
  toggleBtn.appendChild(icon);
  rootEl.appendChild(toggleBtn);
  void ensureSessionsReady().then(() => syncComposerBrainNotesFromActiveChat());
}

/** Sync Brain notes toggle visibility and pressed state from active chat. */
export async function syncComposerBrainNotesFromActiveChat(): Promise<void> {
  if (!sessionState) return;

  const wrap = document.getElementById('composerBrainNotesWrap');
  const storeEnabled = await fetchMemoryEnabled();
  const show = storeEnabled;

  if (wrap) {
    wrap.classList.toggle('hidden', !show);
  }
  if (rootEl) {
    rootEl.classList.toggle('hidden', !show);
  }
  if (!toggleBtn || !show) return;

  const globalDefault = await fetchMemoryInjectionEnabled();
  cachedGlobalDefault = globalDefault;

  const chat = getActiveChat();
  const tri = resolveBrainNotesInjectionTriState(chat);
  const resolvedOn = resolveBrainNotesInjectionEnabled(chat, globalDefault);
  const disabled = isActiveChatStreaming() || isComposerRecoveryBlocked();

  toggleBtn.setAttribute('aria-pressed', resolvedOn ? 'true' : 'false');
  toggleBtn.dataset.inherit = tri === 'inherit' ? 'true' : 'false';
  toggleBtn.dataset.brainNotesTri = tri;
  toggleBtn.disabled = disabled;
  toggleBtn.title = formatBrainNotesTitle(tri, resolvedOn, globalDefault);
}

export function refreshBrainNotesControlDisabled(): void {
  void syncComposerBrainNotesFromActiveChat();
}
