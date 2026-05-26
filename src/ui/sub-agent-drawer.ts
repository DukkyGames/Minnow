/**
 * Slide-over panel showing a sub-agent transcript (read-only) with optional cancel.
 * Subscribes to orchestrator events while open so the transcript updates live.
 */

import {
  buildSubAgentStatusPayload,
  cancelSubAgent,
  getSubAgentRun,
} from '../agents/orchestrator';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentRun } from '../agents/types';
import { findChatById } from '../state/sessions';
import { legacyOutcomeFromSummary } from '../agents/sub-agent-structured-outcome';
import type { SubAgentStructuredOutcome } from '../agents/sub-agent-structured-outcome';
import type { PersistedSubAgentRun } from '../types';
import { renderTranscriptView } from './transcript-view.ts';

/** DOM refs for the open drawer so live run updates can refresh in place. */
interface OpenDrawerState {
  runId: string;
  chatId: string;
  scroll: HTMLElement;
  structuredRoot: HTMLElement;
  statusEl: HTMLElement;
  transcriptBody: HTMLElement;
}

let openLayer: { backdrop: HTMLElement; onKey: (e: KeyboardEvent) => void } | null =
  null;
let openDrawer: OpenDrawerState | null = null;
let drawerSubscriptionBound = false;

/** Human-readable terminal status for drawer header. */
function formatDrawerStatusLabel(status: string): string {
  if (status === 'completed') return 'Complete';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'running') return 'Running';
  if (status === 'queued') return 'Queued';
  return status;
}

/** Format ISO or epoch ended time for display. */
function formatEndedAt(endedAt: string | number | null | undefined): string | null {
  if (endedAt == null || endedAt === '') return null;
  const ms =
    typeof endedAt === 'number'
      ? endedAt
      : Date.parse(String(endedAt));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString();
}

/** Resolve a run from live orchestrator state or persisted chat snapshot. */
function resolveRunSnapshot(
  runId: string,
  chatId: string,
): { run: SubAgentRun | PersistedSubAgentRun; live: boolean } | null {
  const live = getSubAgentRun(runId);
  if (live && live.parentChatId === chatId) {
    return { run: live, live: true };
  }
  const chat = findChatById(chatId);
  const persisted = chat?.subAgentRuns?.find((r) => r.runId === runId);
  if (persisted) {
    return { run: persisted, live: false };
  }
  return null;
}

/** Resolve structured outcome for drawer (live status payload or persisted). */
function resolveDrawerOutcome(
  run: SubAgentRun | PersistedSubAgentRun,
  live: boolean,
): SubAgentStructuredOutcome | null {
  if (run.structuredOutcome) return run.structuredOutcome;
  if (live) {
    const snap = buildSubAgentStatusPayload(run as SubAgentRun);
    if (snap.outcome && typeof snap.outcome === 'object') {
      return snap.outcome as SubAgentStructuredOutcome;
    }
  }
  if (run.summary?.trim()) {
    return legacyOutcomeFromSummary(run.summary);
  }
  return null;
}

/** Live status line when structured outcome is not ready yet. */
function resolveDrawerLiveStatusLine(run: SubAgentRun): string {
  const snap = buildSubAgentStatusPayload(run);
  const preview =
    typeof snap.lastMessagePreview === 'string' ? snap.lastMessagePreview.trim() : '';
  if (preview) return preview;
  if (run.status === 'queued') return 'Queued — waiting for a concurrency slot…';
  if (run.status === 'running') return 'Generating…';
  return '';
}

function bindDrawerLiveSubscription(): void {
  if (drawerSubscriptionBound) return;
  drawerSubscriptionBound = true;
  subscribeSubAgentRuns((run) => {
    if (!openDrawer || openDrawer.runId !== run.runId) return;
    if (run.parentChatId !== openDrawer.chatId) return;
    refreshOpenSubAgentDrawer(run);
  });
}

/** Wire drawer refresh to orchestrator pub/sub (called from initSubAgentUi). */
export function initSubAgentDrawerLiveUpdates(): void {
  bindDrawerLiveSubscription();
}

/** Re-render header summary + transcript for the open drawer. */
function refreshOpenSubAgentDrawer(run: SubAgentRun): void {
  if (!openDrawer || openDrawer.runId !== run.runId) return;

  openDrawer.statusEl.textContent = formatDrawerStatusLabel(run.status);
  renderStructuredDrawerBlock(openDrawer.structuredRoot, run, true);
  renderTranscriptView(openDrawer.transcriptBody, run.messages as unknown[]);
  openDrawer.scroll.scrollTop = openDrawer.scroll.scrollHeight;
}

/** Structured summary / findings / artifacts above the transcript. */
function renderStructuredDrawerBlock(
  root: HTMLElement,
  run: SubAgentRun | PersistedSubAgentRun,
  live: boolean,
): void {
  root.replaceChildren();
  const outcome = resolveDrawerOutcome(run, live);
  if (!outcome) {
    const line = live ? resolveDrawerLiveStatusLine(run as SubAgentRun) : '';
    if (line) {
      const p = document.createElement('p');
      p.className = 'sub-agent-drawer__summary';
      p.textContent = line;
      root.appendChild(p);
    }
    return;
  }

  const summary = document.createElement('p');
  summary.className = 'sub-agent-drawer__summary';
  summary.textContent = outcome.summary;
  root.appendChild(summary);

  if (outcome.findings.length > 0) {
    const list = document.createElement('ul');
    list.className = 'sub-agent-drawer__findings';
    for (const f of outcome.findings) {
      const li = document.createElement('li');
      li.className = 'sub-agent-drawer__finding';
      const title = document.createElement('strong');
      title.textContent = f.title;
      li.appendChild(title);
      if (f.severity) {
        const sev = document.createElement('span');
        sev.className = `sub-agent-drawer__severity sub-agent-drawer__severity--${f.severity}`;
        sev.textContent = f.severity;
        li.appendChild(sev);
      }
      const detail = document.createElement('p');
      detail.textContent = f.detail;
      li.appendChild(detail);
      if (f.paths?.length) {
        const paths = document.createElement('p');
        paths.className = 'sub-agent-drawer__paths';
        paths.textContent = f.paths.join(', ');
        li.appendChild(paths);
      }
      list.appendChild(li);
    }
    root.appendChild(list);
  }

  if (outcome.artifacts.length > 0) {
    const chips = document.createElement('div');
    chips.className = 'sub-agent-drawer__artifacts';
    for (const a of outcome.artifacts) {
      const chip = document.createElement('span');
      chip.className = 'sub-agent-drawer__artifact';
      chip.textContent = `${a.kind}: ${a.label}`;
      chip.title = a.ref;
      chips.appendChild(chip);
    }
    root.appendChild(chips);
  }

  const liveRun = run as SubAgentRun;
  if (liveRun.budgetEvents?.length) {
    const budget = document.createElement('ul');
    budget.className = 'sub-agent-drawer__budget-events';
    for (const ev of liveRun.budgetEvents) {
      const li = document.createElement('li');
      li.textContent = ev.label;
      budget.appendChild(li);
    }
    root.appendChild(budget);
  }
}

export function closeSubAgentDrawer(): void {
  if (!openLayer) return;
  document.removeEventListener('keydown', openLayer.onKey);
  openLayer.backdrop.remove();
  openLayer = null;
  openDrawer = null;
}

/**
 * Opens the drawer for one sub-agent run (live or persisted on the given chat).
 */
export function openSubAgentDrawer(runId: string, chatId: string): void {
  bindDrawerLiveSubscription();
  closeSubAgentDrawer();
  const resolved = resolveRunSnapshot(runId, chatId);
  if (!resolved) return;

  const { run, live } = resolved;
  const main = document.getElementById('mainColumn');
  if (!main) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'sub-agent-drawer-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const panel = document.createElement('div');
  panel.className = 'sub-agent-drawer-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', `Sub-agent ${run.type}`);

  const header = document.createElement('header');
  header.className = 'sub-agent-drawer__header';

  const title = document.createElement('h2');
  title.className = 'sub-agent-drawer__title';
  title.textContent = `Sub-agent · ${run.type}`;

  const meta = document.createElement('div');
  meta.className = 'sub-agent-drawer__meta';
  const status = document.createElement('span');
  status.className = 'sub-agent-drawer__status';
  status.textContent = formatDrawerStatusLabel(run.status);
  const idSpan = document.createElement('span');
  idSpan.className = 'sub-agent-drawer__run-id';
  idSpan.textContent = run.runId;
  meta.appendChild(status);
  meta.appendChild(idSpan);
  const endedLabel = formatEndedAt(run.endedAt);
  if (endedLabel) {
    const ended = document.createElement('span');
    ended.className = 'sub-agent-drawer__ended';
    ended.textContent = `Ended ${endedLabel}`;
    meta.appendChild(ended);
  }

  const headerActions = document.createElement('div');
  headerActions.className = 'sub-agent-drawer__header-actions';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sub-agent-drawer__icon-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => closeSubAgentDrawer());

  headerActions.appendChild(closeBtn);

  if (live && (run.status === 'running' || run.status === 'queued')) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'sub-agent-drawer__cancel';
    cancelBtn.textContent = 'Cancel run';
    cancelBtn.addEventListener('click', () => {
      cancelSubAgent(runId, 'user_cancel');
      closeSubAgentDrawer();
    });
    headerActions.appendChild(cancelBtn);
  }

  header.appendChild(title);
  header.appendChild(meta);
  header.appendChild(headerActions);

  const scroll = document.createElement('div');
  scroll.className = 'sub-agent-drawer__scroll';

  const structuredRoot = document.createElement('div');
  structuredRoot.className = 'sub-agent-drawer__structured';
  renderStructuredDrawerBlock(structuredRoot, run, live);

  const transcriptDetails = document.createElement('details');
  transcriptDetails.className = 'sub-agent-drawer__transcript-details';
  const hasStructured = Boolean(resolveDrawerOutcome(run, live));
  transcriptDetails.open = !hasStructured;

  const transcriptSummary = document.createElement('summary');
  transcriptSummary.textContent = 'Transcript';
  transcriptDetails.appendChild(transcriptSummary);

  const transcriptBody = document.createElement('div');
  transcriptBody.className = 'sub-agent-drawer__body';
  renderTranscriptView(transcriptBody, run.messages as unknown[]);
  transcriptDetails.appendChild(transcriptBody);

  scroll.appendChild(structuredRoot);
  scroll.appendChild(transcriptDetails);

  panel.appendChild(header);
  panel.appendChild(scroll);

  backdrop.appendChild(panel);
  main.appendChild(backdrop);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSubAgentDrawer();
    }
  };
  document.addEventListener('keydown', onKey);
  openLayer = { backdrop, onKey };

  openDrawer = {
    runId,
    chatId,
    scroll,
    structuredRoot,
    statusEl: status,
    transcriptBody,
  };

  if (live) {
    const liveRun = getSubAgentRun(runId);
    if (liveRun) refreshOpenSubAgentDrawer(liveRun);
  }

  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) closeSubAgentDrawer();
  });

  closeBtn.focus();
}
