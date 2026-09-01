/**
 * Sub-agent status cards in the parent chat (live updates via events + persisted replay).
 */

import { normalizeModeId } from '../chat/modes/types';
import { listActiveSubAgentRuns, getSubAgentRun, hydrateSubAgentRunsForParentChat, listSubAgentRunsForParentChat } from '../agents/orchestrator';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentRun } from '../agents/types';
import { initSubAgentCompletionPush } from '../agents/sub-agent-completion-push';
import { initSubAgentSessionPersistence } from '../state/sub-agent-session-sync';
import { getActiveChat } from '../state/sessions';
import { legacyOutcomeFromSummary } from '../agents/sub-agent-structured-outcome';
import type { Chat, PersistedSubAgentRun } from '../types';
import { getActiveChatMountElement } from './chat-mount';
import { isBoardChatEmbedOpenForChat } from './orchestrate-board-chat-state';
import { isHubMounted } from './hub';
import { isMainColumnOverlaySuppressingChatDom } from './main-column-overlay';
import { isOrchestrateHubMounted } from './orchestrate-hub';
import { scrollBottom } from './input';
import { initSubAgentDrawerLiveUpdates, openSubAgentDrawer } from './sub-agent-drawer';
import {
  subAgentLiveBadgeLabel,
  subAgentLiveStatusLine,
} from './sub-agent-live-status';

/** Maps run id to the card element for the current chat render. */
const cards = new Map<string, HTMLElement>();

let liveSubscriptionBound = false;

/** Empty-chat landing pages (Vibe / Orchestrate hub) — not the transcript. */
function isEmptyChatLandingMounted(): boolean {
  return isHubMounted() || isOrchestrateHubMounted();
}

/** Clears the card registry when the chat DOM is rebuilt from history. */
export function clearSubAgentCardDomRegistry(): void {
  cards.clear();
}

function statusLabel(run: SubAgentRun | PersistedSubAgentRun, live: boolean): string {
  return subAgentLiveBadgeLabel(run, live);
}

function taskPreview(task: string): string {
  const t = task.trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

/** Fills the card DOM from a live or persisted run row. */
function fillCard(
  el: HTMLElement,
  run: SubAgentRun | PersistedSubAgentRun,
  live: boolean,
): void {
  el.classList.toggle(
    'sub-agent-card--active',
    run.status === 'running' || run.status === 'queued',
  );
  el.dataset.status = run.status;
  el.replaceChildren();

  const head = document.createElement('div');
  head.className = 'sub-agent-card__head';

  const type = document.createElement('span');
  type.className = 'sub-agent-card__type';
  type.textContent = run.type;

  const badge = document.createElement('span');
  badge.className = 'sub-agent-card__badge';
  badge.textContent = statusLabel(run, live);

  head.appendChild(type);
  head.appendChild(badge);

  const task = document.createElement('div');
  task.className = 'sub-agent-card__task';
  task.textContent = taskPreview(run.task);

  const subtitle = document.createElement('div');
  subtitle.className = 'sub-agent-card__subtitle';
  const liveLine = live ? subAgentLiveStatusLine(run, true) : '';
  const activeRun = run as SubAgentRun;
  if (live && activeRun.startError) {
    // Consecutive start failures are a counter, not one toast per tick (P9-A).
    subtitle.className = 'sub-agent-card__subtitle sub-agent-card__error';
    subtitle.textContent = `${activeRun.startError.message} (${activeRun.startError.consecutive})`;
  } else if (liveLine) {
    subtitle.textContent = liveLine;
  } else {
    const outcome =
      run.structuredOutcome ??
      (run.summary?.trim() ? legacyOutcomeFromSummary(run.summary) : null);
    if (outcome?.findings?.[0]?.title) {
      subtitle.textContent = outcome.findings[0].title;
    } else if (outcome?.summary?.trim()) {
      const s = outcome.summary.trim();
      subtitle.textContent = s.length > 100 ? `${s.slice(0, 100)}…` : s;
    }
  }

  const hint = document.createElement('div');
  hint.className = 'sub-agent-card__hint';
  hint.textContent = 'Click to view details';

  const nested =
    activeRun.liveNestedToolCalls != null && activeRun.liveNestedToolCalls > 0
      ? `${activeRun.liveNestedToolCalls} nested tool call(s)`
      : run.toolTurns > 0
        ? `${run.toolTurns} tool round(s)`
        : '';

  el.appendChild(head);
  el.appendChild(task);
  if (subtitle.textContent) el.appendChild(subtitle);
  if (nested) {
    const meta = document.createElement('div');
    meta.className = 'sub-agent-card__meta';
    meta.textContent = nested;
    el.appendChild(meta);
  }
  el.appendChild(hint);
}

/**
 * Escape for a double-quoted attribute selector value.
 *
 * Not `CSS.escape` — that is an identifier escaper, and it is missing from
 * some DOM shims the tests run against (same helper as `tool-wrap-dom.ts`).
 */
function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Parent `spawn_sub_agent` tool-call id used to sit the card under that row. */
function parentToolCallAnchorId(
  run: SubAgentRun | PersistedSubAgentRun,
): string | null {
  if (!('parentToolCallId' in run) || !run.parentToolCallId) return null;
  const trimmed = run.parentToolCallId.trim();
  return trimmed || null;
}

/**
 * The spawn tool row in this transcript, if it is mounted.
 *
 * Prefer `.tool-call-msg` so a stray dataset elsewhere cannot steal the card.
 */
function findSpawnToolAnchor(area: HTMLElement, anchorId: string): HTMLElement | null {
  const selector = `[data-tool-call-id="${escapeAttributeValue(anchorId)}"]`;
  return (
    area.querySelector<HTMLElement>(`.tool-call-msg${selector}`) ??
    area.querySelector<HTMLElement>(selector)
  );
}

/**
 * Sit the card directly under the spawn tool row.
 *
 * Placement used to be creation-only (`if (!el)`). After `renderChatFromHistory`
 * the registry element is detached (or still in the map while the transcript
 * was rebuilt), so a later upsert left the card at the bottom. Re-anchor on
 * every upsert when the node is detached or the anchor exists and the card
 * is not already the next sibling (P10-K / MIN-776).
 */
function placeSubAgentCard(
  el: HTMLElement,
  area: HTMLElement,
  run: SubAgentRun | PersistedSubAgentRun,
  persisted?: SubAgentRun | PersistedSubAgentRun,
): void {
  // Live overlay can omit parentToolCallId while the session row still has it.
  const anchorId =
    parentToolCallAnchorId(run) ?? (persisted ? parentToolCallAnchorId(persisted) : null);
  const anchor = anchorId ? findSpawnToolAnchor(area, anchorId) : null;
  const inThisTranscript = area.contains(el);
  const alreadyAdjacent =
    inThisTranscript && anchor != null && el.previousElementSibling === anchor;

  if (alreadyAdjacent) return;

  if (anchor?.parentNode) {
    anchor.insertAdjacentElement('afterend', el);
    return;
  }

  // No tool row yet: append only when the card is not already in this
  // transcript. A later live upsert re-anchors once the row exists.
  if (!inThisTranscript) {
    area.appendChild(el);
  }
}

/**
 * Creates or updates the card for this run when it belongs to the active chat.
 */
export function upsertSubAgentCardForRun(
  run: SubAgentRun | PersistedSubAgentRun,
  chatId: string,
): HTMLElement | null {
  const active = getActiveChat();
  if (active.id !== chatId) return null;
  const orchestratorRun = getSubAgentRun(run.runId);
  const isLive =
    run.status === 'running' ||
    run.status === 'queued' ||
    orchestratorRun?.status === 'running' ||
    orchestratorRun?.status === 'queued';
  if (
    normalizeModeId(active.modeId) === 'orchestrate' &&
    active.viewMode === 'board'
  ) {
    return null;
  }
  if (!isBoardChatEmbedOpenForChat(chatId) && isMainColumnOverlaySuppressingChatDom()) {
    return null;
  }
  // Background sub-agents still run, but cards belong in the transcript — not on hub.
  if (isEmptyChatLandingMounted()) return null;

  const area = getActiveChatMountElement();

  let el = cards.get(run.runId);
  if (!el) {
    el = document.createElement('div');
    el.className = 'sub-agent-card';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.dataset.runId = run.runId;
    el.dataset.chatId = chatId;
    cards.set(run.runId, el);

    const open = (): void => {
      openSubAgentDrawer(run.runId, chatId);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
  }

  const displayRun = orchestratorRun ?? run;
  // Re-anchor on every upsert, not only on first create (P10-K).
  placeSubAgentCard(el, area, displayRun, run);
  el.setAttribute(
    'aria-label',
    `Sub-agent ${displayRun.type}, ${displayRun.status}. ${taskPreview(displayRun.task)}`,
  );
  fillCard(el, displayRun, isLive);
  scrollBottom();
  return el;
}

/** Re-mount persisted and in-flight cards after `renderChatFromHistory` rebuilds the transcript. */
export function renderPersistedSubAgentCardsForChat(chat: Chat): void {
  for (const row of chat.subAgentRuns ?? []) {
    upsertSubAgentCardForRun(row, chat.id);
  }
  for (const run of listActiveSubAgentRuns()) {
    if (run.parentChatId === chat.id) {
      upsertSubAgentCardForRun(run, chat.id);
    }
  }
  // Reload source of truth: fold state from the server, including runs that
  // completed while this chat was not painted.
  void hydrateSubAgentRunsForParentChat(chat.id).then(() => {
    for (const run of listSubAgentRunsForParentChat(chat.id)) {
      upsertSubAgentCardForRun(run, chat.id);
    }
  });
}

/**
 * One-time init: persist settled runs to the session blob and subscribe for live cards.
 */
export function initSubAgentUi(): void {
  initSubAgentSessionPersistence();
  initSubAgentCompletionPush();
  initSubAgentDrawerLiveUpdates();
  try {
    const chat = getActiveChat();
    if (chat?.id) void hydrateSubAgentRunsForParentChat(chat.id);
  } catch {
    // Boot can run before a session exists.
  }
  if (liveSubscriptionBound) return;
  liveSubscriptionBound = true;
  subscribeSubAgentRuns((run) => {
    const chatId = run.parentChatId;
    if (!chatId) return;
    upsertSubAgentCardForRun(run, chatId);
  });
}
