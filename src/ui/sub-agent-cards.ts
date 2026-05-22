/**
 * Sub-agent status cards in the parent chat (live updates via events + persisted replay).
 */

import { normalizeModeId } from '../chat/modes/types';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentRun } from '../agents/types';
import { initSubAgentSessionPersistence } from '../state/sub-agent-session-sync';
import { getActiveChat } from '../state/sessions';
import type { Chat, PersistedSubAgentRun } from '../types';
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

  const hint = document.createElement('div');
  hint.className = 'sub-agent-card__hint';
  hint.textContent = 'Click to view transcript';

  const live = run as SubAgentRun;
  const nested =
    live.liveNestedToolCalls != null && live.liveNestedToolCalls > 0
      ? `${live.liveNestedToolCalls} nested tool call(s)`
      : run.toolTurns > 0
        ? `${run.toolTurns} tool round(s)`
        : '';

  el.appendChild(head);
  el.appendChild(task);
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

  const area = document.getElementById('chatArea');
  if (!area) return null;

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

/** Re-mount persisted cards after `renderChatFromHistory` rebuilds `#chatArea`. */
export function renderPersistedSubAgentCardsForChat(chat: Chat): void {
  if (!chat.subAgentRuns?.length) return;
  for (const row of chat.subAgentRuns) {
    upsertSubAgentCardForRun(row, chat.id);
  }
}

/**
 * One-time init: persist settled runs to the session blob and subscribe for live cards.
 */
export function initSubAgentUi(): void {
  initSubAgentSessionPersistence();
  initSubAgentDrawerLiveUpdates();
  if (liveSubscriptionBound) return;
  liveSubscriptionBound = true;
  subscribeSubAgentRuns((run) => {
    const chatId = run.parentChatId;
    if (!chatId) return;
    upsertSubAgentCardForRun(run, chatId);
  });
}
