/**
 * Header reasoning effort dropdown — top bar + OS menubar mirrors.
 * Shown when the active model exposes 2+ reasoning effort options.
 */

import { resolveThinkingMode } from '../agents/resolve-thinking';
import { isActiveChatStreaming } from '../chat/streaming-state';
import {
  formatReasoningEffortLabel,
  modelHasSelectableReasoningEffort,
  normalizeReasoningAllowedOptions,
  resolveEffectiveReasoningEffort,
} from '../lib/reasoning-effort';
import { catalogCapabilitiesFromRow, resolveSendCapabilities } from '../providers/model-capabilities';
import { resolveActiveWorkAgent } from '../agents/resolve-work-agent';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type { ReasoningEffortOption as EffortOption } from '../types';
import { syncThinkingControlFromActiveChat } from './composer-thinking';
import { isComposerRecoveryBlocked } from './composer-send';

let topSelect: HTMLSelectElement | null = null;
let menubarSelect: HTMLSelectElement | null = null;
let topWrap: HTMLElement | null = null;
let menubarWrap: HTMLElement | null = null;
let syncingSelects = false;

function effectiveCapabilities(): ReturnType<typeof resolveSendCapabilities> {
  const chat = getActiveChat();
  const modelId = chat.modelId?.trim();
  const providerId = chat.providerId?.trim();
  if (!modelId || !providerId) return undefined;
  return resolveSendCapabilities(providerId, modelId);
}

function getAllowedOptions(): EffortOption[] {
  const caps = effectiveCapabilities();
  return normalizeReasoningAllowedOptions(caps?.reasoningAllowedOptions ?? []);
}

/** Drop saved effort when the active model no longer allows it. */
function validateAndClearInvalidEffort(): void {
  const chat = getActiveChat();
  const allowed = getAllowedOptions();
  if (!chat.reasoningEffort) return;
  if (allowed.includes(chat.reasoningEffort)) return;
  delete chat.reasoningEffort;
  touchChat(chat);
  scheduleSaveSessions();
}

function resolveDisplayEffort(allowed: EffortOption[]): EffortOption | undefined {
  if (allowed.length === 0) return undefined;
  const chat = getActiveChat();
  if (chat.reasoningEffort && allowed.includes(chat.reasoningEffort)) {
    return chat.reasoningEffort;
  }
  const caps = effectiveCapabilities();
  const agent = resolveActiveWorkAgent(chat);
  const resolved = resolveThinkingMode({
    kind: 'work-agent',
    agentKey: agent?.id ?? null,
    chatThinkingMode: chat.thinkingMode,
  });
  return resolveEffectiveReasoningEffort(chat, caps, resolved.mode);
}

function populateSelect(select: HTMLSelectElement, allowed: EffortOption[]): void {
  const display = resolveDisplayEffort(allowed);
  select.replaceChildren();
  for (const option of allowed) {
    const el = document.createElement('option');
    el.value = option;
    el.textContent = formatReasoningEffortLabel(option);
    select.appendChild(el);
  }
  if (display) select.value = display;
}

function syncPeerSelect(source: HTMLSelectElement): void {
  const peer = source === topSelect ? menubarSelect : topSelect;
  if (!peer || peer === source) return;
  if (peer.value !== source.value) peer.value = source.value;
}

function setComposerThinkingWrapHidden(hidden: boolean): void {
  const wrap = document.getElementById('composerThinkingWrap');
  if (!wrap) return;
  wrap.classList.toggle('hidden', hidden);
}

function setWrapVisibility(visible: boolean): void {
  if (topWrap) topWrap.classList.toggle('hidden', !visible);
  if (menubarWrap) menubarWrap.classList.toggle('hidden', !visible);
  setComposerThinkingWrapHidden(visible);
  if (!visible) syncThinkingControlFromActiveChat();
}

function onSelectChange(source: HTMLSelectElement): void {
  if (source.disabled || syncingSelects) return;
  const allowed = getAllowedOptions();
  const value = source.value as EffortOption;
  if (!allowed.includes(value)) return;

  const chat = getActiveChat();
  chat.reasoningEffort = value;
  touchChat(chat);
  scheduleSaveSessions();

  syncingSelects = true;
  syncPeerSelect(source);
  syncingSelects = false;
}

function wireSelect(select: HTMLSelectElement | null): void {
  if (!select) return;
  select.addEventListener('change', () => onSelectChange(select));
}

/** Wire top-bar and menubar reasoning effort selects. */
export function initHeaderReasoningEffort(): void {
  topSelect = document.getElementById('reasoningEffortSelect') as HTMLSelectElement | null;
  topWrap = document.getElementById('reasoningEffortWrap');
  menubarSelect = document.getElementById('osReasoningEffortSelect') as HTMLSelectElement | null;
  menubarWrap = document.getElementById('osReasoningEffortWrap');

  wireSelect(topSelect);
  wireSelect(menubarSelect);
  syncHeaderReasoningEffortFromActiveChat();
}

/** Refresh options, visibility, disabled state, and menubar/top-bar sync. */
export function syncHeaderReasoningEffortFromActiveChat(): void {
  validateAndClearInvalidEffort();

  const caps = effectiveCapabilities();
  const visible = modelHasSelectableReasoningEffort(caps);
  setWrapVisibility(visible);

  const disabled = isActiveChatStreaming() || isComposerRecoveryBlocked();
  const allowed = getAllowedOptions();

  if (topSelect) {
    topSelect.disabled = !visible || disabled;
    if (visible) populateSelect(topSelect, allowed);
  }
  if (menubarSelect) {
    menubarSelect.disabled = !visible || disabled;
    if (visible) {
      populateSelect(menubarSelect, allowed);
      syncingSelects = true;
      if (topSelect?.value) menubarSelect.value = topSelect.value;
      syncingSelects = false;
    }
  }
}

/** Re-run sync when streaming / recovery gates change (loop.ts). */
export function refreshHeaderReasoningEffortDisabled(): void {
  syncHeaderReasoningEffortFromActiveChat();
}
