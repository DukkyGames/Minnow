/**
 * Composer tri-state thinking control (inherit / on / off).
 */

import { resolveThinkingMode } from '../agents/resolve-thinking';
import {
  formatThinkingInheritedLabel,
  modelAllowsThinkingMode,
  modelSupportsThinkingControl,
} from '../agents/thinking-capabilities';
import {
  normalizeThinkingTriState,
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

const MODES: ThinkingTriState[] = ['inherit', 'on', 'off'];
const LABELS: Record<ThinkingTriState, string> = {
  inherit: 'Inherit',
  on: 'On',
  off: 'Off',
};

let rootEl: HTMLElement | null = null;
let hintEl: HTMLElement | null = null;

function effectiveCapabilities(): ReturnType<typeof catalogCapabilitiesFromRow> | undefined {
  const chat = getActiveChat();
  const modelId = chat.modelId?.trim();
  const providerId = chat.providerId?.trim();
  if (!modelId || !providerId) return undefined;
  const row = modelCache.get(encodeModelSelectKey(providerId, modelId));
  return row?.capabilities ?? (row ? catalogCapabilitiesFromRow(row) : undefined);
}

function setChatThinkingMode(mode: ThinkingTriState): void {
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

/** Mount segmented thinking control into #composerThinkingControl. */
export function initThinkingControl(): void {
  rootEl = document.getElementById('composerThinkingControl');
  hintEl = document.getElementById('composerThinkingHint');
  if (!rootEl) return;

  rootEl.innerHTML = '';
  rootEl.className = 'composer-control thinking-control mode-segmented';
  rootEl.setAttribute('role', 'radiogroup');
  rootEl.setAttribute('aria-label', 'Thinking mode');

  const label = document.createElement('span');
  label.className = 'composer-control-label';
  label.textContent = 'Thinking';
  rootEl.appendChild(label);

  const group = document.createElement('div');
  group.className = 'thinking-control__segments';
  group.setAttribute('role', 'presentation');

  for (const mode of MODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-segmented__btn';
    btn.dataset.thinkingMode = mode;
    btn.textContent = LABELS[mode];
    btn.setAttribute('role', 'radio');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      setChatThinkingMode(mode);
    });
    group.appendChild(btn);
  }

  rootEl.appendChild(group);
  syncThinkingControlFromActiveChat();
}

/** Sync thinking segments from active chat and model capabilities. */
export function syncThinkingControlFromActiveChat(): void {
  if (!rootEl) return;
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

  const buttons = rootEl.querySelectorAll<HTMLButtonElement>('[data-thinking-mode]');
  buttons.forEach((btn) => {
    const mode = btn.dataset.thinkingMode as ThinkingTriState;
    const selected = mode === tri;
    btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    btn.tabIndex = selected ? 0 : -1;
    const targetResolved = mode === 'inherit' ? resolved.mode : mode;
    const allowed = supports && modelAllowsThinkingMode(caps, targetResolved);
    btn.disabled =
      !allowed ||
      isActiveChatStreaming() ||
      isComposerRecoveryBlocked();
    if (!supports) {
      btn.title = 'Effective model does not advertise reasoning support';
    } else if (!allowed) {
      btn.title = `Model does not support thinking ${targetResolved}`;
    } else if (mode === 'inherit') {
      btn.title = formatThinkingInheritedLabel(tri, resolved.mode, resolved.sourceLabel);
    } else {
      btn.title = '';
    }
  });

  if (hintEl) {
    const hint = formatThinkingInheritedLabel(tri, resolved.mode, resolved.sourceLabel);
    hintEl.textContent = hint;
    hintEl.classList.toggle('hidden', !hint);
  }
}

export function refreshThinkingControlDisabled(): void {
  syncThinkingControlFromActiveChat();
}
