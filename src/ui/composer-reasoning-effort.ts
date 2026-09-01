/**
 * Composer reasoning effort dropdown — low / medium / high / max beside the brain toggle.
 * Off/on-only models use the brain toggle alone (see composer-thinking.ts).
 * Always-on models (GLM-5.3) hide the brain and keep the level dropdown visible.
 */

import { resolveThinkingMode } from '../agents/resolve-thinking';
import { isActiveChatStreaming } from '../chat/streaming-state';
import {
  formatReasoningEffortLabel,
  getComposerReasoningLevelOptions,
  isComposerReasoningLevel,
  modelUsesAlwaysOnReasoning,
  modelUsesComposerReasoningLevelDropdown,
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
import { syncComposerCodeMapFromActiveChat } from './composer-code-map';
import { syncComposerBrainNotesFromActiveChat } from './composer-brain-notes';
import { syncComposerContextDocumentsFromActiveChat } from './composer-context-documents';
import { isComposerRecoveryBlocked } from './composer-send';

let selectEl: HTMLSelectElement | null = null;
let wrapEl: HTMLElement | null = null;
let segmentsEl: HTMLElement | null = null;

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

function getLevelOptions(): EffortOption[] {
  return getComposerReasoningLevelOptions(getAllowedOptions());
}

/** Drop saved effort when the active model no longer allows it. */
function validateAndClearInvalidEffort(): void {
  const chat = getActiveChat();
  if (!chat.reasoningEffort) return;
  const caps = effectiveCapabilities();
  const levels = getLevelOptions();
  // Always-on models (GLM-5.3) cannot persist Off or Medium from a previous model.
  if (chat.reasoningEffort === 'off' && !modelUsesAlwaysOnReasoning(caps)) return;
  if (isComposerReasoningLevel(chat.reasoningEffort) && levels.includes(chat.reasoningEffort)) {
    return;
  }
  delete chat.reasoningEffort;
  touchChat(chat);
  scheduleSaveSessions();
}

function resolveDisplayEffort(levels: EffortOption[]): EffortOption | undefined {
  if (levels.length === 0) return undefined;
  const chat = getActiveChat();
  if (chat.reasoningEffort && levels.includes(chat.reasoningEffort)) {
    return chat.reasoningEffort;
  }
  const caps = effectiveCapabilities();
  const agent = resolveActiveWorkAgent(chat);
  const resolved = resolveThinkingMode({
    kind: 'work-agent',
    agentKey: agent?.id ?? null,
    chatThinkingMode: chat.thinkingMode,
  });
  const effort = resolveEffectiveReasoningEffort(chat, caps, resolved.mode);
  if (effort && levels.includes(effort)) return effort;
  return levels.includes('medium') ? 'medium' : levels[0];
}

function populateSelect(options: EffortOption[], display: EffortOption | undefined): void {
  if (!selectEl) return;
  selectEl.replaceChildren();
  for (const option of options) {
    const el = document.createElement('option');
    el.value = option;
    el.textContent = formatReasoningEffortLabel(option);
    selectEl.appendChild(el);
  }
  if (display) selectEl.value = display;
}

/** Compact overflow uses a segmented control; the native select stays for the wide row. */
function populateSegments(options: EffortOption[], display: EffortOption | undefined): void {
  if (!segmentsEl) return;
  segmentsEl.replaceChildren();
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'composer-reasoning-effort-segment';
    button.dataset.value = option;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', display === option ? 'true' : 'false');
    button.textContent = formatReasoningEffortLabel(option);
    segmentsEl.appendChild(button);
  }
}

function onSegmentClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  if (!target.classList.contains('composer-reasoning-effort-segment')) return;
  if (!selectEl || selectEl.disabled) return;
  const value = target.dataset.value as EffortOption | undefined;
  if (!value) return;
  selectEl.value = value;
  selectEl.dispatchEvent(new Event('change'));
}

function onSelectChange(): void {
  if (!selectEl || selectEl.disabled) return;
  const levels = getLevelOptions();
  const value = selectEl.value as EffortOption;
  if (!levels.includes(value)) return;

  const chat = getActiveChat();
  chat.reasoningEffort = value;
  touchChat(chat);
  scheduleSaveSessions();
  syncThinkingControlFromActiveChat();
  void syncComposerCodeMapFromActiveChat();
  void syncComposerBrainNotesFromActiveChat();
  void syncComposerContextDocumentsFromActiveChat();
}

function isLevelDropdownVisible(): boolean {
  const caps = effectiveCapabilities();
  if (!modelUsesComposerReasoningLevelDropdown(caps)) return false;
  // Always-on models have no Off — keep Low/High/Max visible.
  if (modelUsesAlwaysOnReasoning(caps)) return true;
  return getActiveChat().reasoningEffort !== 'off';
}

/** Wire composer reasoning effort select. */
export function initComposerReasoningEffort(): void {
  selectEl = document.getElementById('composerReasoningEffortSelect') as HTMLSelectElement | null;
  wrapEl = document.getElementById('composerReasoningEffortWrap');
  segmentsEl = document.getElementById('composerReasoningEffortSegments');
  selectEl?.addEventListener('change', onSelectChange);
  segmentsEl?.addEventListener('click', onSegmentClick);
  syncComposerReasoningEffortFromActiveChat();
}

/** Refresh dropdown options, visibility, and disabled state. */
export function syncComposerReasoningEffortFromActiveChat(): void {
  validateAndClearInvalidEffort();

  const caps = effectiveCapabilities();
  const visible = isLevelDropdownVisible();
  const disabled = isActiveChatStreaming() || isComposerRecoveryBlocked();

  if (wrapEl) wrapEl.classList.toggle('hidden', !visible);
  if (selectEl) {
    selectEl.disabled = !visible || disabled;
    if (visible) {
      const levels = getLevelOptions();
      const display = resolveDisplayEffort(levels);
      populateSelect(levels, display);
      populateSegments(levels, display);
    }
  }
  if (segmentsEl) {
    for (const button of segmentsEl.querySelectorAll<HTMLButtonElement>('.composer-reasoning-effort-segment')) {
      button.disabled = !visible || disabled;
    }
  }

  syncThinkingControlFromActiveChat();
  void syncComposerCodeMapFromActiveChat();
  void syncComposerBrainNotesFromActiveChat();
  void syncComposerContextDocumentsFromActiveChat();
}

/** Re-run sync when streaming / recovery gates change (loop.ts). */
export function refreshComposerReasoningEffortDisabled(): void {
  syncComposerReasoningEffortFromActiveChat();
}

