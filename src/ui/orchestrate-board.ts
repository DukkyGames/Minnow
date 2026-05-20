/**
 * Orchestrate Board View: Kanban, agent grid, plan panel, controls.
 */

import { streaming } from '../app-state';
import { stopGeneration } from '../chat/stop-generation';
import {
  cancelAllForParentTurn,
  cancelSubAgent,
  listActiveSubAgentRuns,
} from '../agents/orchestrator';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentRun } from '../agents/types';
import { getBoardProgressPercent } from '../state/orchestrate-board-store';
import { subscribeBoardChanges } from '../state/orchestrate-board-events';
import { getActiveChat, scheduleSaveSessions, touchChat } from '../state/sessions';
import type { BoardTask, BoardTaskStatus, Chat } from '../types';
import { executeTool } from '../tools/client';
import { setAssistantBubbleContent } from '../markdown/renderer';
import { isOrchestrateBoardViewActive } from './view-mode-toggle';

const RESUME_MESSAGE =
  "Resume the plan. Call board_get_state and continue from the first task whose status is not 'complete'.";

interface BoardSession {
  chatId: string;
  unsubBoard: () => void;
  unsubAgents: () => void;
}

let currentSession: BoardSession | null = null;

function disposeBoardSession(): void {
  if (!currentSession) return;
  currentSession.unsubBoard();
  currentSession.unsubAgents();
  currentSession = null;
}

function shortPlanName(planPath: string): string {
  return planPath.replace(/^documentation\/plans\//, '');
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function buildTaskCard(task: BoardTask): HTMLElement {
  const card = document.createElement('article');
  card.className = 'board-task-card';
  if (task.status === 'failed' || task.status === 'blocked') {
    card.classList.add('board-task-card--alert');
  }
  const id = document.createElement('span');
  id.className = 'board-task-card__id';
  id.textContent = task.id;
  const title = document.createElement('p');
  title.className = 'board-task-card__title';
  title.textContent = task.title;
  const chip = document.createElement('span');
  chip.className = `board-task-card__cat bt--${task.category}`;
  chip.textContent = task.category;
  card.appendChild(id);
  card.appendChild(title);
  card.appendChild(chip);
  if (task.assignedRunId) {
    const run = document.createElement('span');
    run.className = 'board-task-card__run';
    run.textContent = `Run ${task.assignedRunId.slice(0, 8)}…`;
    card.appendChild(run);
  }
  if (typeof task.filesChanged === 'number' && task.filesChanged > 0) {
    const fc = document.createElement('span');
    fc.className = 'board-task-card__files';
    fc.textContent = `${task.filesChanged} file(s)`;
    card.appendChild(fc);
  }
  if (task.error) {
    const err = document.createElement('p');
    err.className = 'board-task-card__error';
    err.textContent = task.error;
    card.appendChild(err);
  }
  return card;
}

function buildAgentCard(run: SubAgentRun, onStop: () => void): HTMLElement {
  const card = document.createElement('article');
  card.className = `board-agent-card bt--${run.category ?? 'build'}`;
  const head = document.createElement('div');
  head.className = 'board-agent-card__head';
  const type = document.createElement('span');
  type.className = 'board-agent-card__type';
  type.textContent = run.type;
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'board-agent-card__stop';
  stop.setAttribute('aria-label', 'Stop sub-agent');
  stop.textContent = '×';
  stop.addEventListener('click', (e) => {
    e.stopPropagation();
    onStop();
  });
  head.appendChild(type);
  head.appendChild(stop);
  const task = document.createElement('p');
  task.className = 'board-agent-card__task';
  task.textContent = run.task.slice(0, 120);
  card.appendChild(head);
  card.appendChild(task);
  return card;
}

function renderKanban(board: NonNullable<Chat['orchestrateBoard']>): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'kanban-grid';
  const columns: Array<{ key: string; label: string; statuses: BoardTaskStatus[] }> = [
    { key: 'planned', label: 'Planned', statuses: ['planned', 'blocked'] },
    { key: 'in_progress', label: 'In Progress', statuses: ['in_progress'] },
    { key: 'testing', label: 'Testing', statuses: ['testing'] },
    { key: 'complete', label: 'Complete', statuses: ['complete', 'failed'] },
  ];
  for (const col of columns) {
    const column = document.createElement('section');
    column.className = 'kanban-column';
    const h = document.createElement('h3');
    h.textContent = col.label;
    column.appendChild(h);
    const list = document.createElement('div');
    list.className = 'kanban-column__list';
    for (const task of board.tasks) {
      if (!col.statuses.includes(task.status)) continue;
      list.appendChild(buildTaskCard(task));
    }
    column.appendChild(list);
    grid.appendChild(column);
  }
  return grid;
}

async function loadPlanPanel(planPath: string, container: HTMLElement): Promise<void> {
  container.innerHTML = '<p class="board-plan-panel__loading">Loading plan…</p>';
  try {
    const out = await executeTool('read_file', { path: planPath });
    const body = document.createElement('div');
    body.className = 'board-plan-panel__body';
    setAssistantBubbleContent(body, out.content, { streaming: false });
    container.replaceChildren(body);
  } catch {
    container.innerHTML =
      '<p class="board-plan-panel__error">Could not load plan (start npm start for file tools).</p>';
  }
}

function sendBoardMessage(text: string): void {
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  void import('../chat/messaging').then((m) => m.sendMessage());
}

/** Render Orchestrate board into #chatArea. */
export function renderBoardView(chat: Chat): void {
  disposeBoardSession();
  const area = document.getElementById('chatArea');
  if (!area) return;
  area.innerHTML = '';

  const root = document.createElement('section');
  root.className = 'board-root';

  const header = document.createElement('header');
  header.className = 'board-header';

  const board = chat.orchestrateBoard;
  const planPath = chat.orchestratePlanPath ?? board?.planPath ?? '';

  if (!board) {
    const empty = document.createElement('div');
    empty.className = 'board-empty';
    empty.innerHTML =
      '<p>Run the orchestrator to initialize the board (<code>board_init</code>).</p>' +
      '<button type="button" class="board-empty__chat">Switch to Chat</button>';
    empty.querySelector('button')?.addEventListener('click', () => {
      chat.viewMode = 'chat';
      touchChat(chat);
      scheduleSaveSessions();
      void import('./view-mode-toggle').then((m) => m.syncViewModeToggleFromActiveChat());
      void import('./messages').then((m) => m.renderChatFromHistory(chat));
    });
    root.appendChild(empty);
    area.appendChild(root);
    return;
  }

  const activeRuns = listActiveSubAgentRuns().filter(
    (r) => r.parentChatId === chat.id && (r.status === 'queued' || r.status === 'running'),
  );
  const progress = getBoardProgressPercent(board);
  const wavesComplete = board.waves.filter((w) => w.status === 'complete').length;
  const elapsed = formatElapsed(Date.now() - board.startedAt);

  const title = document.createElement('h2');
  title.className = 'board-header__title';
  title.textContent = shortPlanName(planPath);

  const stats = document.createElement('p');
  stats.className = 'board-header__stats';
  const done = board.tasks.filter((t) => t.status === 'complete').length;
  stats.textContent = `${done}/${board.tasks.length} tasks · ${wavesComplete}/${board.waves.length} waves · ${activeRuns.length} active · ${elapsed}`;

  const bar = document.createElement('div');
  bar.className = 'board-header__progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuenow', String(progress));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('div');
  fill.className = 'board-header__progress-fill';
  fill.style.width = `${progress}%`;
  bar.appendChild(fill);

  const controls = document.createElement('div');
  controls.className = 'board-header__controls';

  const stopOrch = document.createElement('button');
  stopOrch.type = 'button';
  stopOrch.className = 'board-btn board-btn--danger';
  stopOrch.textContent = 'Stop orchestrator';
  stopOrch.disabled =
    !streaming || !board.activeParentTurnId;
  stopOrch.addEventListener('click', () => {
    stopGeneration();
    if (board.activeParentTurnId) {
      cancelAllForParentTurn(board.activeParentTurnId);
    }
  });

  const resume = document.createElement('button');
  resume.type = 'button';
  resume.className = 'board-btn';
  resume.textContent = 'Resume';
  resume.disabled = streaming;
  resume.addEventListener('click', () => sendBoardMessage(RESUME_MESSAGE));

  controls.appendChild(stopOrch);
  controls.appendChild(resume);
  header.appendChild(title);
  header.appendChild(stats);
  header.appendChild(bar);
  header.appendChild(controls);

  const main = document.createElement('div');
  main.className = 'board-main';
  main.appendChild(renderKanban(board));

  const planPanel = document.createElement('details');
  planPanel.className = 'board-plan-panel';
  planPanel.open = false;
  const summary = document.createElement('summary');
  summary.textContent = 'Plan';
  const planBody = document.createElement('div');
  planBody.className = 'board-plan-panel__content';
  planPanel.appendChild(summary);
  planPanel.appendChild(planBody);
  main.appendChild(planPanel);
  void loadPlanPanel(planPath, planBody);

  const agentSection = document.createElement('section');
  agentSection.className = 'board-agents';
  const agentTitle = document.createElement('h3');
  agentTitle.textContent = 'Active agents';
  const agentGrid = document.createElement('div');
  agentGrid.className = 'board-agent-grid';
  agentSection.appendChild(agentTitle);
  agentSection.appendChild(agentGrid);

  const composer = document.createElement('div');
  composer.className = 'board-composer';
  const textarea = document.createElement('textarea');
  textarea.className = 'board-composer__input';
  textarea.rows = 2;
  textarea.placeholder = 'Message orchestrator…';
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'board-btn';
  send.textContent = 'Send';
  send.disabled = streaming;
  send.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    sendBoardMessage(text);
  });
  composer.appendChild(textarea);
  composer.appendChild(send);

  root.appendChild(header);
  root.appendChild(main);
  root.appendChild(agentSection);
  root.appendChild(composer);
  area.appendChild(root);

  const rerender = (): void => {
    if (!isOrchestrateBoardViewActive()) return;
    renderBoardView(getActiveChat());
  };

  for (const run of activeRuns) {
    agentGrid.appendChild(
      buildAgentCard(run, () => {
        cancelSubAgent(run.runId, 'user');
      }),
    );
  }

  currentSession = {
    chatId: chat.id,
    unsubBoard: subscribeBoardChanges(chat.id, rerender),
    unsubAgents: subscribeSubAgentRuns(() => rerender()),
  };
}
