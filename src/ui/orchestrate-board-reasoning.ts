/**
 * Orchestrate board header reasoning controls (brain toggle + effort level).
 * Mirrors composer reasoning UX, scoped to per-board overrides.
 */

import { resolveThinkingMode } from '../agents/resolve-thinking.ts';
import {
  formatThinkingInheritedLabel,
  modelAllowsThinkingMode,
  modelSupportsThinkingControl,
} from '../agents/thinking-capabilities.ts';
import {
  normalizeThinkingTriState,
  type ThinkingTriState,
} from '../agents/thinking-types.ts';
import { resolveBoardModelBinding } from '../chat/orchestrate/board-model-binding.ts';
import {
  defaultComposerReasoningLevel,
  formatReasoningEffortLabel,
  getComposerReasoningLevelOptions,
  modelShowsComposerBrainToggle,
  modelUsesComposerReasoningDropdown,
  modelUsesComposerThinkingToggle,
  normalizeReasoningAllowedOptions,
  resolveEffectiveReasoningEffort,
} from '../lib/reasoning-effort.ts';
import { resolveSendCapabilities } from '../providers/model-capabilities.ts';
import { setBoardReasoning } from '../state/orchestrate-board-actions.ts';
import { isBoardRunning } from '../state/orchestrate-board-store.ts';
import type { Chat, ChatGroup, ReasoningEffortOption } from '../types.ts';
import { nextThinkingTriStateOnClick } from './composer-thinking.ts';
import { createIcon } from './icon.ts';

type BoardState = NonNullable<ChatGroup['orchestrateBoard']>;

interface BoardReasoningContext {
  group: ChatGroup;
  board: BoardState;
  plannerChat: Chat;
  onChanged: () => void;
}

let boardReasoningContext: BoardReasoningContext | null = null;
let wrapEl: HTMLElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;
let selectEl: HTMLSelectElement | null = null;
let selectWrapEl: HTMLElement | null = null;

function effectiveCapabilities(): ReturnType<typeof resolveSendCapabilities> | undefined {
  if (!boardReasoningContext) return undefined;
  const { board, plannerChat } = boardReasoningContext;
  const binding = resolveBoardModelBinding(plannerChat, board);
  if (!binding.modelId || !binding.providerId) return undefined;
  return resolveSendCapabilities(binding.providerId, binding.modelId);
}

function getLevelOptions(): ReasoningEffortOption[] {
  const caps = effectiveCapabilities();
  return getComposerReasoningLevelOptions(
    normalizeReasoningAllowedOptions(caps?.reasoningAllowedOptions ?? []),
  );
}

function controlsDisabled(): boolean {
  if (!boardReasoningContext) return true;
  return isBoardRunning(boardReasoningContext.group);
}

function resolveDisplayEffort(levels: ReasoningEffortOption[]): ReasoningEffortOption | undefined {
  if (!boardReasoningContext || levels.length === 0) return undefined;
  const { board, plannerChat } = boardReasoningContext;
  const caps = effectiveCapabilities();

  if (board.reasoningEffort && levels.includes(board.reasoningEffort)) {
    return board.reasoningEffort;
  }

  const resolved = resolveThinkingMode({
    kind: 'work-agent',
    agentKey: null,
    chatThinkingMode: board.thinkingMode ?? plannerChat.thinkingMode,
  });
  const effort = resolveEffectiveReasoningEffort(
    { reasoningEffort: board.reasoningEffort ?? plannerChat.reasoningEffort },
    caps,
    resolved.mode,
  );
  if (effort && levels.includes(effort)) return effort;
  return levels.includes('medium') ? 'medium' : levels[0];
}

function isDropdownReasoningActive(
  caps: ReturnType<typeof resolveSendCapabilities>,
): boolean {
  if (!boardReasoningContext) return false;
  const { board } = boardReasoningContext;
  if (board.reasoningEffort === 'off') return false;
  if (
    board.reasoningEffort === 'low' ||
    board.reasoningEffort === 'medium' ||
    board.reasoningEffort === 'high'
  ) {
    return true;
  }
  const resolved = resolveThinkingMode({
    kind: 'work-agent',
    agentKey: null,
    chatThinkingMode: board.thinkingMode,
  });
  const effort = resolveEffectiveReasoningEffort(board, caps, resolved.mode);
  return effort !== 'off' && effort !== undefined;
}

function persistAndRefresh(patch: Parameters<typeof setBoardReasoning>[2]): void {
  if (!boardReasoningContext) return;
  const { group, plannerChat, onChanged } = boardReasoningContext;
  setBoardReasoning(group, plannerChat, patch);
  syncBoardHeaderReasoning();
  onChanged();
}

function onSelectChange(): void {
  if (!selectEl || selectEl.disabled || !boardReasoningContext) return;
  const levels = getLevelOptions();
  const value = selectEl.value as ReasoningEffortOption;
  if (!levels.includes(value)) return;
  persistAndRefresh({
    reasoningEffort: value,
    clearThinkingMode: true,
  });
}

function applyDropdownModeBrainToggle(): void {
  const caps = effectiveCapabilities();
  if (!boardReasoningContext) return;
  if (boardReasoningContext.board.reasoningEffort === 'off') {
    const level = defaultComposerReasoningLevel(caps);
    persistAndRefresh({
      reasoningEffort: level ?? 'medium',
      clearThinkingMode: true,
    });
    return;
  }
  persistAndRefresh({
    reasoningEffort: 'off',
    clearThinkingMode: true,
  });
}

function applyThinkingTriState(mode: ThinkingTriState): void {
  if (mode === 'inherit') {
    persistAndRefresh({
      clearReasoningEffort: true,
      clearThinkingMode: true,
    });
    return;
  }
  persistAndRefresh({
    thinkingMode: mode,
    clearReasoningEffort: true,
  });
}

function onToggleClick(): void {
  if (!toggleBtn || toggleBtn.disabled || !boardReasoningContext) return;
  const caps = effectiveCapabilities();
  if (modelUsesComposerReasoningDropdown(caps)) {
    applyDropdownModeBrainToggle();
    return;
  }

  const { board } = boardReasoningContext;
  const tri = normalizeThinkingTriState(board.thinkingMode, 'inherit');
  const resolved = resolveThinkingMode({
    kind: 'work-agent',
    agentKey: null,
    chatThinkingMode: board.thinkingMode,
  });
  applyThinkingTriState(nextThinkingTriStateOnClick(tri, resolved.mode));
}

function populateSelect(
  options: ReasoningEffortOption[],
  display: ReasoningEffortOption | undefined,
): void {
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

/** Mount reasoning controls beside the board model chip. */
export function wireBoardHeaderReasoning(
  controls: HTMLElement,
  group: ChatGroup,
  board: BoardState,
  plannerChat: Chat,
  onChanged: () => void,
): void {
  const existing = controls.querySelector('.board-header__reasoning');
  existing?.remove();

  boardReasoningContext = { group, board, plannerChat, onChanged };
  wrapEl = null;
  toggleBtn = null;
  selectEl = null;
  selectWrapEl = null;

  wrapEl = document.createElement('div');
  wrapEl.className = 'board-header__reasoning board-reasoning-control-wrap hidden';
  wrapEl.setAttribute('role', 'group');
  wrapEl.setAttribute('aria-label', 'Board reasoning');

  const toggleHost = document.createElement('div');
  toggleHost.className = 'thinking-toggle-host board-reasoning-toggle-host';

  toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'thinking-toggle-btn board-reasoning-toggle-btn';
  toggleBtn.setAttribute('aria-label', 'Board reasoning');
  toggleBtn.appendChild(createIcon('reasoning', { className: 'thinking-toggle-icon' }));
  toggleBtn.addEventListener('click', onToggleClick);
  toggleHost.appendChild(toggleBtn);

  selectWrapEl = document.createElement('div');
  selectWrapEl.className = 'board-reasoning-effort-wrap hidden';

  selectEl = document.createElement('select');
  selectEl.className = 'composer-reasoning-effort-select board-reasoning-effort-select';
  selectEl.setAttribute('aria-label', 'Board reasoning effort');
  selectEl.addEventListener('change', onSelectChange);
  selectWrapEl.appendChild(selectEl);

  wrapEl.appendChild(toggleHost);
  wrapEl.appendChild(selectWrapEl);

  const modelSlot = controls.querySelector('.board-header__model-slot');
  if (modelSlot?.nextSibling) {
    controls.insertBefore(wrapEl, modelSlot.nextSibling);
  } else {
    controls.appendChild(wrapEl);
  }

  syncBoardHeaderReasoning();
}

/** Keep board reasoning controls aligned after header refresh or model change. */
export function syncBoardHeaderReasoning(
  group?: ChatGroup,
  board?: BoardState,
  plannerChat?: Chat,
): void {
  if (group && board && plannerChat && boardReasoningContext) {
    boardReasoningContext = {
      ...boardReasoningContext,
      group,
      board,
      plannerChat,
    };
  }
  if (!wrapEl || !toggleBtn) return;

  const caps = effectiveCapabilities();
  const showBrain = modelShowsComposerBrainToggle(caps);
  const dropdownMode = modelUsesComposerReasoningDropdown(caps);
  const toggleMode = modelUsesComposerThinkingToggle(caps);
  const disabled = controlsDisabled();

  wrapEl.classList.toggle('hidden', !showBrain);
  toggleBtn.classList.toggle('hidden', !showBrain);

  if (!showBrain) {
    if (selectWrapEl) selectWrapEl.classList.add('hidden');
    return;
  }

  if (dropdownMode) {
    const effectiveOn = isDropdownReasoningActive(caps);
    toggleBtn.setAttribute('aria-pressed', effectiveOn ? 'true' : 'false');
    toggleBtn.dataset.inherit = 'false';
    toggleBtn.dataset.thinkingTri = effectiveOn ? 'on' : 'off';
    toggleBtn.disabled = disabled;
    toggleBtn.title = effectiveOn
      ? 'Board reasoning on — click to turn off'
      : 'Board reasoning off — click to turn on';

    const showLevel = effectiveOn;
    if (selectWrapEl) selectWrapEl.classList.toggle('hidden', !showLevel);
    if (selectEl) {
      selectEl.disabled = disabled || !showLevel;
      if (showLevel) {
        const levels = getLevelOptions();
        populateSelect(levels, resolveDisplayEffort(levels));
      }
    }
    return;
  }

  if (!toggleMode) {
    toggleBtn.disabled = true;
    if (selectWrapEl) selectWrapEl.classList.add('hidden');
    return;
  }

  const boardState = boardReasoningContext?.board;
  const tri = normalizeThinkingTriState(boardState?.thinkingMode, 'inherit');
  const resolved = resolveThinkingMode({
    kind: 'work-agent',
    agentKey: null,
    chatThinkingMode: boardState?.thinkingMode,
  });
  const supports = modelSupportsThinkingControl(caps);
  const effectiveOn = resolved.mode === 'on';
  const allowed = supports && modelAllowsThinkingMode(caps, resolved.mode);

  toggleBtn.setAttribute('aria-pressed', effectiveOn ? 'true' : 'false');
  toggleBtn.dataset.inherit = tri === 'inherit' ? 'true' : 'false';
  toggleBtn.dataset.thinkingTri = tri;
  toggleBtn.disabled = !allowed || disabled;

  if (!supports) {
    toggleBtn.title = 'Board model does not advertise reasoning support';
  } else if (!allowed) {
    toggleBtn.title = `Board model does not support reasoning ${resolved.mode}`;
  } else if (tri === 'inherit') {
    toggleBtn.title = formatThinkingInheritedLabel(tri, resolved.mode, resolved.sourceLabel);
  } else {
    toggleBtn.title = effectiveOn
      ? 'Board reasoning on (override)'
      : 'Board reasoning off (override)';
  }

  if (selectWrapEl) selectWrapEl.classList.add('hidden');
}

/** Tear down board reasoning controls when leaving board view. */
export function teardownBoardHeaderReasoning(): void {
  wrapEl = null;
  toggleBtn = null;
  selectEl = null;
  selectWrapEl = null;
  boardReasoningContext = null;
}
