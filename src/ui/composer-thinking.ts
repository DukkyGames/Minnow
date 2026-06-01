/**
 * Composer thinking toggle — brain icon (on / off) with inherit default + user override.
 */

import { resolveThinkingMode } from '../agents/resolve-thinking';
import {
  formatThinkingInheritedLabel,
  modelAllowsThinkingMode,
  modelSupportsThinkingControl,
} from '../agents/thinking-capabilities';
import {
  normalizeThinkingTriState,
  type ThinkingResolvedMode,
  type ThinkingTriState,
} from '../agents/thinking-types';
import { isActiveChatStreaming } from '../chat/streaming-state';
import { modelCache } from '../app-state';
import { encodeModelSelectKey } from '../lib/model-select-key';
import { catalogCapabilitiesFromRow } from '../providers/model-capabilities';
import { resolveActiveWorkAgent } from '../agents/resolve-work-agent';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { isComposerRecoveryBlocked } from './composer-send';

let rootEl: HTMLElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;

/** Next tri-state after a composer click: inherit → opposite of resolved → toggle → inherit. */
export function nextThinkingTriStateOnClick(
  tri: ThinkingTriState,
  resolved: ThinkingResolvedMode,
): ThinkingTriState {
  if (tri === 'inherit') return resolved === 'on' ? 'off' : 'on';
  if (tri === 'on') return 'off';
  return 'inherit';
}

function effectiveCapabilities(): ReturnType<typeof catalogCapabilitiesFromRow> | undefined {
  const chat = getActiveChat();
  const modelId = chat.modelId?.trim();
  const providerId = chat.providerId?.trim();
  if (!modelId || !providerId) return undefined;
  const row = modelCache.get(encodeModelSelectKey(providerId, modelId));
  return row?.capabilities ?? (row ? catalogCapabilitiesFromRow(row) : undefined);
}

function applyChatThinkingMode(mode: ThinkingTriState): void {
  const chat = getActiveChat();
  if (mode === 'inherit') {
    delete chat.thinkingMode;
  } else {
    chat.thinkingMode = mode;
  }
  touchChat(chat);
  scheduleSaveSessions();
  syncThinkingControlFromActiveChat();
}

function onToggleClick(): void {
  if (toggleBtn?.disabled) return;
  const chat = getActiveChat();
  const tri = normalizeThinkingTriState(chat.thinkingMode, 'inherit');
  const agent = resolveActiveWorkAgent(chat);
  const resolved = resolveThinkingMode({
    kind: 'work-agent',
    agentKey: agent?.id ?? null,
    chatThinkingMode: chat.thinkingMode,
  });
  applyChatThinkingMode(nextThinkingTriStateOnClick(tri, resolved.mode));
}

/** Mount brain thinking toggle into #composerThinkingControl. */
export function initThinkingControl(): void {
  rootEl = document.getElementById('composerThinkingControl');
  if (!rootEl) return;

  rootEl.innerHTML = '';
  rootEl.className = 'thinking-toggle-host';

  toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'thinking-toggle-btn';
  toggleBtn.setAttribute('aria-label', 'Thinking mode');
  toggleBtn.addEventListener('click', onToggleClick);

  const icon = document.createElement('span');
  icon.className = 'thinking-toggle-icon';
  icon.setAttribute('aria-hidden', 'true');

  toggleBtn.appendChild(icon);
  rootEl.appendChild(toggleBtn);
  syncThinkingControlFromActiveChat();
}

/** Sync brain toggle from active chat, inheritance, and model capabilities. */
export function syncThinkingControlFromActiveChat(): void {
  if (!toggleBtn) return;
  const chat = getActiveChat();
  const tri = normalizeThinkingTriState(chat.thinkingMode, 'inherit');
  const agent = resolveActiveWorkAgent(chat);
  const resolved = resolveThinkingMode({
    kind: 'work-agent',
    agentKey: agent?.id ?? null,
    chatThinkingMode: chat.thinkingMode,
  });
  const caps = effectiveCapabilities();
  const supports = modelSupportsThinkingControl(caps);
  const effectiveOn = resolved.mode === 'on';
  const allowed = supports && modelAllowsThinkingMode(caps, resolved.mode);

  toggleBtn.setAttribute('aria-pressed', effectiveOn ? 'true' : 'false');
  toggleBtn.dataset.inherit = tri === 'inherit' ? 'true' : 'false';
  toggleBtn.dataset.thinkingTri = tri;
  toggleBtn.disabled =
    !allowed ||
    isActiveChatStreaming() ||
    isComposerRecoveryBlocked();

  if (!supports) {
    toggleBtn.title = 'Effective model does not advertise reasoning support';
  } else if (!allowed) {
    toggleBtn.title = `Model does not support thinking ${resolved.mode}`;
  } else if (tri === 'inherit') {
    toggleBtn.title = formatThinkingInheritedLabel(tri, resolved.mode, resolved.sourceLabel);
  } else {
    toggleBtn.title = effectiveOn ? 'Thinking on (chat override)' : 'Thinking off (chat override)';
  }
}

export function refreshThinkingControlDisabled(): void {
  syncThinkingControlFromActiveChat();
}
