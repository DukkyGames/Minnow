/**
 * Composer reasoning effort dropdown — shown when the model exposes level options
 * (low / medium / high). Binary off/on models use the brain toggle instead.
 */

import { resolveThinkingMode } from '../agents/resolve-thinking';
import { isActiveChatStreaming } from '../chat/streaming-state';
import {
  formatReasoningEffortLabel,
  modelUsesComposerReasoningDropdown,
  normalizeReasoningAllowedOptions,
  resolveEffectiveReasoningEffort,
} from '../lib/reasoning-effort';
import { resolveSendCapabilities } from '../providers/model-capabilities';
import { resolveActiveWorkAgent } from '../agents/resolve-work-agent';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type { ReasoningEffortOption as EffortOption } from '../types';
import { syncThinkingControlFromActiveChat } from './composer-thinking';
import { isComposerRecoveryBlocked } from './composer-send';

let selectEl: HTMLSelectElement | null = null;
let wrapEl: HTMLElement | null = null;

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

function populateSelect(allowed: EffortOption[]): void {
  if (!selectEl) return;
  const display = resolveDisplayEffort(allowed);
  selectEl.replaceChildren();
  for (const option of allowed) {
    const el = document.createElement('option');
    el.value = option;
    el.textContent = formatReasoningEffortLabel(option);
    selectEl.appendChild(el);
  }
  if (display) selectEl.value = display;
}

function onSelectChange(): void {
  if (!selectEl || selectEl.disabled) return;
  const allowed = getAllowedOptions();
  const value = selectEl.value as EffortOption;
  if (!allowed.includes(value)) return;

  const chat = getActiveChat();
  chat.reasoningEffort = value;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Wire composer reasoning effort select. */
export function initComposerReasoningEffort(): void {
  selectEl = document.getElementById('composerReasoningEffortSelect') as HTMLSelectElement | null;
  wrapEl = document.getElementById('composerReasoningEffortWrap');
  selectEl?.addEventListener('change', onSelectChange);
  syncComposerReasoningEffortFromActiveChat();
}

/** Refresh dropdown options, visibility, and disabled state. */
export function syncComposerReasoningEffortFromActiveChat(): void {
  validateAndClearInvalidEffort();

  const caps = effectiveCapabilities();
  const visible = modelUsesComposerReasoningDropdown(caps);
  const disabled = isActiveChatStreaming() || isComposerRecoveryBlocked();
  const allowed = getAllowedOptions();

  if (wrapEl) wrapEl.classList.toggle('hidden', !visible);
  if (selectEl) {
    selectEl.disabled = !visible || disabled;
    if (visible) populateSelect(allowed);
  }

  syncThinkingControlFromActiveChat();
}

/** Re-run sync when streaming / recovery gates change (loop.ts). */
export function refreshComposerReasoningEffortDisabled(): void {
  syncComposerReasoningEffortFromActiveChat();
}
