/**
 * Bug tracker Board View: five-column Kanban (MIN-16).
 */

import {
  runBugInvestigate,
  runBugPlanFix,
  runBugStartFix,
} from '../chat/bug-board/pipeline.ts';
import { normalizeModeId } from '../chat/modes/types.ts';
import { subscribeBugBoardChanges } from '../state/bug-board-events.ts';
import {
  addBug,
  countBugsByColumn,
  isBugSeverity,
  type AddBugInput,
} from '../state/bug-board-store.ts';
import { getActiveChat, scheduleSaveSessions, touchChat } from '../state/sessions.ts';
import type { BugCard, BugColumn, Chat } from '../types.ts';
import {
  appendBoardChatViewToggle,
  syncViewModeToggleFromActiveChat,
} from './view-mode-toggle.ts';

const COLUMNS: Array<{ id: BugColumn; label: string }> = [
  { id: 'reported', label: 'Reported' },
  { id: 'investigating', label: 'Investigating' },
  { id: 'planned', label: 'Planned' },
  { id: 'fixing', label: 'Fixing' },
  { id: 'complete', label: 'Complete' },
];

let currentChatId: string | null = null;
let unsubBugBoard: (() => void) | null = null;

function sendBoardMessage(text: string): void {
  const input = document.getElementById('messageInput') as HTMLTextAreaElement | null;
  if (input) {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  void import('../chat/messaging').then((m) => m.sendMessage());
}

function disposeBugBoardSession(): void {
  unsubBugBoard?.();
  unsubBugBoard = null;
  currentChatId = null;
}

function ensureBugBoardSession(chatId: string): void {
  if (currentChatId === chatId) return;
  disposeBugBoardSession();
  currentChatId = chatId;
  unsubBugBoard = subscribeBugBoardChanges(chatId, () => {
    if (!isDebugBoardViewActive()) return;
    if (getActiveChat().id !== chatId) return;
    refreshActiveBugBoardIfMounted();
  });
}

/** True when debug mode should show the bug Kanban. */
export function isDebugBoardViewActive(): boolean {
  const chat = getActiveChat();
  return normalizeModeId(chat.modeId) === 'debug' && chat.viewMode === 'board';
}

function columnActions(bug: BugCard): Array<{ label: string; action: () => void }> {
  const chat = getActiveChat();
  const actions: Array<{ label: string; action: () => void }> = [];

  if (bug.column === 'reported' || bug.column === 'investigating') {
    actions.push({
      label: 'Investigate',
      action: () => {
        void runBugInvestigate(chat.id, bug.id).then((r) => {
          if (!r.ok) setBugBoardStatus(r.error ?? 'Investigate failed', 'err');
          else setBugBoardStatus('Investigation complete', 'ok');
          refreshActiveBugBoardIfMounted();
        });
      },
    });
  }
  if (bug.column === 'investigating' || (bug.column === 'reported' && bug.notes)) {
    actions.push({
      label: 'Plan fix',
      action: () => {
        void runBugPlanFix(chat.id, bug.id).then((r) => {
          if (!r.ok) setBugBoardStatus(r.error ?? 'Plan failed', 'err');
          else setBugBoardStatus(`Plan: ${r.planPath}`, 'ok');
          refreshActiveBugBoardIfMounted();
        });
      },
    });
  }
  if (bug.column === 'planned' && bug.planPath) {
    actions.push({
      label: 'Start fix',
      action: () => {
        void runBugStartFix(chat.id, bug.id, sendBoardMessage).then((r) => {
          if (!r.ok) setBugBoardStatus(r.error ?? 'Start fix failed', 'err');
          else setBugBoardStatus('Orchestrator started', 'ok');
          refreshActiveBugBoardIfMounted();
        });
      },
    });
  }
  if (bug.planPath) {
    actions.push({
      label: 'Open plan',
      action: () => {
        void import('./file-viewer').then((m) => m.openFileInViewer(bug.planPath!));
      },
    });
  }
  return actions;
}

function setBugBoardStatus(message: string, kind: 'ok' | 'err' | 'idle'): void {
  void import('./status').then((m) => {
    if (kind === 'idle') m.setStatus('idle', '');
    else m.setStatus(kind === 'ok' ? 'ok' : 'err', message);
  });
}

function renderBugCard(bug: BugCard, chat: Chat): HTMLElement {
  const card = document.createElement('article');
  card.className = 'board-task-card bug-task-card';
  card.dataset.bugId = bug.id;

  const title = document.createElement('h4');
  title.className = 'board-task-card__title';
  title.textContent = bug.title;

  const meta = document.createElement('div');
  meta.className = 'board-task-card__meta';
  meta.textContent = `${bug.severity} · ${bug.id}`;

  card.appendChild(title);
  card.appendChild(meta);

  if (bug.description) {
    const desc = document.createElement('p');
    desc.className = 'bug-task-card__description';
    desc.textContent =
      bug.description.length > 160
        ? `${bug.description.slice(0, 157)}…`
        : bug.description;
    card.appendChild(desc);
  }

  if (bug.notes) {
    const notes = document.createElement('p');
    notes.className = 'bug-task-card__notes';
    notes.textContent =
      bug.notes.length > 200 ? `${bug.notes.slice(0, 197)}…` : bug.notes;
    card.appendChild(notes);
  }

  const actionsRow = document.createElement('div');
  actionsRow.className = 'bug-task-card__actions';
  for (const { label, action } of columnActions(bug)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'board-btn board-btn--sm';
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setBugBoardStatus(`${label}…`, 'idle');
      action();
    });
    actionsRow.appendChild(btn);
  }
  if (actionsRow.childElementCount) card.appendChild(actionsRow);

  return card;
}

function renderAddBugForm(chat: Chat, container: HTMLElement): void {
  const form = document.createElement('form');
  form.className = 'bug-add-form';
  form.setAttribute('aria-label', 'Add bug');

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.name = 'title';
  titleInput.placeholder = 'Title';
  titleInput.required = true;
  titleInput.className = 'bug-add-form__input';

  const descInput = document.createElement('textarea');
  descInput.name = 'description';
  descInput.placeholder = 'Description';
  descInput.rows = 3;
  descInput.className = 'bug-add-form__input';

  const severitySelect = document.createElement('select');
  severitySelect.name = 'severity';
  severitySelect.className = 'bug-add-form__input';
  for (const sev of ['low', 'medium', 'high', 'critical'] as const) {
    const opt = document.createElement('option');
    opt.value = sev;
    opt.textContent = sev;
    if (sev === 'medium') opt.selected = true;
    severitySelect.appendChild(opt);
  }

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'board-btn';
  submit.textContent = 'Add bug';

  form.append(titleInput, descInput, severitySelect, submit);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    const description = descInput.value.trim();
    const severityRaw = severitySelect.value;
    if (!title) return;
    if (!isBugSeverity(severityRaw)) return;

    const input: AddBugInput = { title, description, severity: severityRaw };
    const bugId = `bug-${Date.now().toString(36)}`;
    addBug(chat, input, bugId);
    titleInput.value = '';
    descInput.value = '';
    refreshActiveBugBoardIfMounted();
  });

  container.appendChild(form);
}

function refreshBugBoardDom(root: HTMLElement, chat: Chat): void {
  const board = chat.bugBoard;
  if (!board) return;

  const counts = countBugsByColumn(board);
  const titleEl = root.querySelector('.board-header__title');
  if (titleEl) {
    titleEl.textContent = `Bug tracker · ${board.bugs.length} open`;
  }

  const kanban = root.querySelector('.board-kanban');
  if (!kanban) return;
  kanban.innerHTML = '';

  for (const col of COLUMNS) {
    const columnEl = document.createElement('div');
    columnEl.className = 'board-column';
    columnEl.dataset.column = col.id;

    const head = document.createElement('div');
    head.className = 'board-column__header';
    head.innerHTML = `<span class="board-column__title">${col.label}</span><span class="board-column__count">${counts[col.id]}</span>`;
    columnEl.appendChild(head);

    const list = document.createElement('div');
    list.className = 'board-column__tasks';

    for (const bug of board.bugs.filter((b) => b.column === col.id)) {
      list.appendChild(renderBugCard(bug, chat));
    }

    columnEl.appendChild(list);
    kanban.appendChild(columnEl);
  }
}

/** Re-render kanban in place when session is stable. */
export function refreshActiveBugBoardIfMounted(): void {
  const area = document.getElementById('chatArea');
  const root = area?.querySelector(':scope > .board-root.bug-board-root') as HTMLElement | null;
  if (!root) return;
  const chat = getActiveChat();
  refreshBugBoardDom(root, chat);
}

/** Mount or refresh bug board in #chatArea. */
export function renderBugBoardView(chat: Chat): void {
  const area = document.getElementById('chatArea');
  if (!area) return;

  const active = getActiveChat();
  const chatForRender = active.id === chat.id ? active : chat;
  const existingRoot = area.querySelector(
    ':scope > .board-root.bug-board-root',
  ) as HTMLElement | null;

  if (existingRoot && currentChatId === chatForRender.id) {
    refreshBugBoardDom(existingRoot, chatForRender);
    ensureBugBoardSession(chatForRender.id);
    syncViewModeToggleFromActiveChat();
    return;
  }

  disposeBugBoardSession();
  area.innerHTML = '';

  const root = document.createElement('section');
  root.className = 'board-root bug-board-root';

  const header = document.createElement('header');
  header.className = 'board-header';

  const toolbar = document.createElement('div');
  toolbar.className = 'board-header__toolbar';

  const leading = document.createElement('div');
  leading.className = 'board-header__leading';
  const title = document.createElement('h2');
  title.className = 'board-header__title';
  title.textContent = 'Bug tracker';
  leading.appendChild(title);

  const controls = document.createElement('div');
  controls.className = 'board-header__controls';
  appendBoardChatViewToggle(controls);

  toolbar.append(leading, controls);
  header.appendChild(toolbar);
  root.appendChild(header);

  const addSection = document.createElement('div');
  addSection.className = 'bug-add-section';
  renderAddBugForm(chatForRender, addSection);
  root.appendChild(addSection);

  const kanban = document.createElement('div');
  kanban.className = 'board-kanban bug-board-kanban';
  root.appendChild(kanban);

  area.appendChild(root);

  if (!chatForRender.bugBoard) {
    touchChat(chatForRender);
    scheduleSaveSessions();
  }

  refreshBugBoardDom(root, chatForRender);
  ensureBugBoardSession(chatForRender.id);
  syncViewModeToggleFromActiveChat();
}
