/**
 * Slide-over panel showing a sub-agent transcript (read-only) with optional cancel.
 */

import { buildSubAgentStatusPayload, cancelSubAgent, getSubAgentRun } from '../agents/orchestrator';
import type { SubAgentRun } from '../agents/types';
import { findChatById } from '../state/sessions';
import type { PersistedSubAgentRun, ToolImageAttachment } from '../types';
import { renderToolCall, renderToolResult } from './tool-messages';

let openLayer: { backdrop: HTMLElement; onKey: (e: KeyboardEvent) => void } | null = null;

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

/** Parse stored tool `arguments` JSON for display (mirrors messages.ts). */
function parseToolArgsForDisplay(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
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

export function closeSubAgentDrawer(): void {
  if (!openLayer) return;
  document.removeEventListener('keydown', openLayer.onKey);
  openLayer.backdrop.remove();
  openLayer = null;
}

function renderTranscript(body: HTMLElement, messages: unknown[]): void {
  body.innerHTML = '';
  const toolResultMap = new Map<
    string,
    { content: string; attachments?: ToolImageAttachment[] }
  >();

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as Record<string, unknown>;
    if (msg.role === 'tool' && typeof msg.tool_call_id === 'string') {
      const attachments = Array.isArray(msg.attachments)
        ? (msg.attachments as ToolImageAttachment[])
        : undefined;
      toolResultMap.set(msg.tool_call_id, {
        content: String(msg.content ?? ''),
        ...(attachments?.length ? { attachments } : {}),
      });
    }
  }

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as Record<string, unknown>;
    const role = msg.role;
    if (role === 'system') {
      const row = document.createElement('div');
      row.className = 'sub-agent-drawer__system';
      row.textContent =
        typeof msg.content === 'string' ? msg.content : '[system prompt omitted]';
      body.appendChild(row);
      continue;
    }
    if (role === 'user') {
      const row = document.createElement('div');
      row.className = 'sub-agent-drawer__user';
      row.textContent =
        typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
      body.appendChild(row);
      continue;
    }
    if (role === 'assistant') {
      const toolCalls = msg.tool_calls;
      const prose =
        msg.content != null && typeof msg.content === 'string'
          ? msg.content.trim()
          : '';
      if (prose) {
        const row = document.createElement('div');
        row.className = 'sub-agent-drawer__assistant';
        row.textContent = prose;
        body.appendChild(row);
      }
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        for (const tc of toolCalls as Array<{
          id: string;
          function: { name: string; arguments: string };
        }>) {
          const argsObj = parseToolArgsForDisplay(tc.function.arguments);
          const wrap = renderToolCall(tc.function.name, argsObj);
          body.appendChild(wrap);
          const stored = toolResultMap.get(tc.id);
          if (stored) {
            renderToolResult(wrap, stored.content, stored.attachments, argsObj);
          }
        }
      }
      if (!prose && (!Array.isArray(toolCalls) || toolCalls.length === 0)) {
        const row = document.createElement('div');
        row.className = 'sub-agent-drawer__assistant';
        row.textContent = '(empty assistant message)';
        body.appendChild(row);
      }
      continue;
    }
    if (role === 'tool') {
      continue;
    }
  }
}

/**
 * Opens the drawer for one sub-agent run (live or persisted on the given chat).
 */
export function openSubAgentDrawer(runId: string, chatId: string): void {
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

  const summaryBox = document.createElement('div');
  summaryBox.className = 'sub-agent-drawer__summary';
  const summaryText = live
    ? (() => {
        const snap = buildSubAgentStatusPayload(run as SubAgentRun);
        return typeof snap.summary === 'string' && snap.summary.trim()
          ? String(snap.summary)
          : run.status === 'running' || run.status === 'queued'
            ? 'Run in progress…'
            : '';
      })()
    : typeof run.summary === 'string' && run.summary.trim()
      ? run.summary
      : '';
  summaryBox.textContent = summaryText;

  const body = document.createElement('div');
  body.className = 'sub-agent-drawer__body';
  renderTranscript(body, run.messages as unknown[]);

  scroll.appendChild(summaryBox);
  scroll.appendChild(body);

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

  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) closeSubAgentDrawer();
  });

  closeBtn.focus();
}
