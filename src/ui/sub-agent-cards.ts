/**
 * Sub-agent status cards in the parent chat (live updates via events + persisted replay).
 */

import { normalizeModeId } from '../chat/modes/types';
import { listActiveSubAgentRuns } from '../agents/orchestrator';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentRun } from '../agents/types';
import { initSubAgentCompletionPush } from '../agents/sub-agent-completion-push';
import { initOrchestratorAutoReports } from '../agents/controller/report';
import { initSubAgentSessionPersistence } from '../state/sub-agent-session-sync';
import { getActiveChat } from '../state/sessions';
import { legacyOutcomeFromSummary } from '../agents/sub-agent-structured-outcome';
import type { Chat, PersistedSubAgentRun } from '../types';
import { getActiveChatMountElement } from './chat-mount';
import { isMainColumnOverlaySuppressingChatDom } from './main-column-overlay';
import { scrollBottom } from './input';
import { initSubAgentDrawerLiveUpdates, openSubAgentDrawer } from './sub-agent-drawer';

/** Maps run id to the card element for the current chat render. */
const cards = new Map<string, HTMLElement>();

let liveSubscriptionBound = false;

/** Clears the card registry when the chat DOM is rebuilt from history. */
export function clearSubAgentCardDomRegistry(): void {
  cards.clear();
}

function statusLabel(status: string): string {
  if (status === 'running' || status === 'queued') return 'Working';
  if (status === 'completed') return 'Done';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Stopped';
  return status;
}

function taskPreview(task: string): string {
  const t = task.trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

/** Fills the card DOM from a live or persisted run row. */
function fillCard(el: HTMLElement, run: SubAgentRun | PersistedSubAgentRun): void {
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
  badge.textContent = statusLabel(run.status);

  head.appendChild(type);
  head.appendChild(badge);

  const task = document.createElement('div');
  task.className = 'sub-agent-card__task';
  task.textContent = taskPreview(run.task);

  const subtitle = document.createElement('div');
  subtitle.className = 'sub-agent-card__subtitle';
  const outcome =
    run.structuredOutcome ??
    (run.summary?.trim() ? legacyOutcomeFromSummary(run.summary) : null);
  if (outcome?.findings?.[0]?.title) {
    subtitle.textContent = outcome.findings[0].title;
  } else if (outcome?.summary?.trim()) {
    const s = outcome.summary.trim();
    subtitle.textContent = s.length > 100 ? `${s.slice(0, 100)}…` : s;
  }

  const hint = document.createElement('div');
  hint.className = 'sub-agent-card__hint';
  hint.textContent = 'Click to view details';

  const live = run as SubAgentRun;
  const nested =
    live.liveNestedToolCalls != null && live.liveNestedToolCalls > 0
      ? `${live.liveNestedToolCalls} nested tool call(s)`
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
 * Creates or updates the card for this run when it belongs to the active chat.
 */
export function upsertSubAgentCardForRun(
  run: SubAgentRun | PersistedSubAgentRun,
  chatId: string,
): HTMLElement | null {
  const active = getActiveChat();
  if (active.id !== chatId) return null;
  if (
    normalizeModeId(active.modeId) === 'orchestrate' &&
    active.viewMode === 'board'
  ) {
    return null;
  }
  if (isMainColumnOverlaySuppressingChatDom()) return null;

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

    const anchorId =
      'parentToolCallId' in run && run.parentToolCallId && run.parentToolCallId.trim()
        ? run.parentToolCallId.trim()
        : null;
    let placed = false;
    if (anchorId) {
      const anchor = area.querySelector<HTMLElement>(
        `[data-tool-call-id="${anchorId}"]`,
      );
      if (anchor?.parentNode) {
        anchor.insertAdjacentElement('afterend', el);
        placed = true;
      }
    }
    if (!placed) {
      area.appendChild(el);
    }
  }

  el.setAttribute(
    'aria-label',
    `Sub-agent ${run.type}, ${run.status}. ${taskPreview(run.task)}`,
  );
  fillCard(el, run);
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
}

/**
 * One-time init: persist settled runs to the session blob and subscribe for live cards.
 */
export function initSubAgentUi(): void {
  initSubAgentSessionPersistence();
  initSubAgentCompletionPush();
  initOrchestratorAutoReports();
  initSubAgentDrawerLiveUpdates();
  if (liveSubscriptionBound) return;
  liveSubscriptionBound = true;
  subscribeSubAgentRuns((run) => {
    const chatId = run.parentChatId;
    if (!chatId) return;
    upsertSubAgentCardForRun(run, chatId);
  });
}
