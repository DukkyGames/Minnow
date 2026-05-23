/**
 * Bug tracker Kanban — rendered only on the global All bugs page (MIN-16).
 */

import {
  runBugInvestigate,
  runBugPlanFix,
  runBugStartFix,
} from '../chat/bug-board/pipeline.ts';
import {
  collectGlobalBugs,
  type CollectGlobalBugsOptions,
  type GlobalBugEntry,
} from '../state/global-bugs.ts';
import { subscribeBugBoardChanges } from '../state/bug-board-events.ts';
import {
  addBug,
  isBugSeverity,
  type AddBugInput,
} from '../state/bug-board-store.ts';
import {
  findChatById,
  getActiveChat,
  getChatsForWorkspace,
  sessionState,
} from '../state/sessions.ts';
import { getWorkspacePath } from '../state/workspace.ts';
import type { BugCard, BugColumn } from '../types.ts';

const COLUMNS: Array<{ id: BugColumn; label: string }> = [
  { id: 'reported', label: 'Reported' },
  { id: 'investigating', label: 'Investigating' },
  { id: 'planned', label: 'Planned' },
  { id: 'fixing', label: 'Fixing' },
  { id: 'complete', label: 'Complete' },
];

let kanbanMount: HTMLElement | null = null;
let collectOptions: CollectGlobalBugsOptions = {};
const bugChangeUnsubs = new Map<string, () => void>();

function isGlobalBugsPageOpen(): boolean {
  return document.getElementById('globalBugsView')?.classList.contains('is-open') ?? false;
}

function sendBoardMessage(text: string): void {
  const input = document.getElementById('messageInput') as HTMLTextAreaElement | null;
  if (input) {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  void import('../chat/messaging').then((m) => m.sendMessage());
}

function disposeBugSubscriptions(): void {
  for (const fn of bugChangeUnsubs.values()) fn();
  bugChangeUnsubs.clear();
}

function ensureBugSubscriptions(): void {
  if (!sessionState) return;
  const needed = new Set<string>();
  for (const chat of sessionState.chats) {
    if (!chat.bugBoard?.bugs.length) continue;
    needed.add(chat.id);
    if (!bugChangeUnsubs.has(chat.id)) {
      const unsub = subscribeBugBoardChanges(chat.id, () => {
        if (isGlobalBugsPageOpen()) refreshGlobalBugKanban();
      });
      bugChangeUnsubs.set(chat.id, unsub);
    }
  }
  for (const [chatId, unsub] of bugChangeUnsubs) {
    if (!needed.has(chatId)) {
      unsub();
      bugChangeUnsubs.delete(chatId);
    }
  }
}

function setBugBoardStatus(message: string, kind: 'ok' | 'err' | 'idle'): void {
  void import('./status').then((m) => {
    if (kind === 'idle') m.setStatus('idle', '');
    else m.setStatus(kind === 'ok' ? 'ok' : 'err', message);
  });
}

function columnActions(
  chatId: string,
  bug: BugCard,
): Array<{ label: string; action: () => void }> {
  const actions: Array<{ label: string; action: () => void }> = [];

  if (bug.column === 'reported' || bug.column === 'investigating') {
    actions.push({
      label: 'Investigate',
      action: () => {
        void runBugInvestigate(chatId, bug.id).then((r) => {
          if (!r.ok) setBugBoardStatus(r.error ?? 'Investigate failed', 'err');
          else setBugBoardStatus('Investigation complete', 'ok');
          refreshGlobalBugKanban();
        });
      },
    });
  }
  if (bug.column === 'investigating' || (bug.column === 'reported' && bug.notes)) {
    actions.push({
      label: 'Plan fix',
      action: () => {
        void runBugPlanFix(chatId, bug.id).then((r) => {
          if (!r.ok) setBugBoardStatus(r.error ?? 'Plan failed', 'err');
          else setBugBoardStatus(`Plan: ${r.planPath}`, 'ok');
          refreshGlobalBugKanban();
        });
      },
    });
  }
  if (bug.column === 'planned' && bug.planPath) {
    actions.push({
      label: 'Start fix',
      action: () => {
        void import('./global-bugs-page').then((m) => m.closeGlobalBugs());
        void runBugStartFix(chatId, bug.id, sendBoardMessage).then((r) => {
          if (!r.ok) setBugBoardStatus(r.error ?? 'Start fix failed', 'err');
          else setBugBoardStatus('Orchestrator started', 'ok');
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

function renderBugCard(entry: GlobalBugEntry): HTMLElement {
  const { bug, chatId, chatName } = entry;
  const card = document.createElement('article');
  card.className = 'board-task-card bug-task-card';
  card.dataset.bugId = bug.id;
  card.dataset.chatId = chatId;

  const title = document.createElement('h4');
  title.className = 'board-task-card__title';
  title.textContent = bug.title;

  const meta = document.createElement('div');
  meta.className = 'board-task-card__meta';
  meta.textContent = `${bug.severity} · ${chatName}`;

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
  for (const { label, action } of columnActions(chatId, bug)) {
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

function chatsForAddBugForm(): Chat[] {
  if (!sessionState) return [];
  const workspace = getWorkspacePath();
  const scoped = getChatsForWorkspace(workspace, sessionState);
  return scoped.length ? scoped : sessionState.chats.slice(0, 20);
}

function renderAddBugForm(container: HTMLElement): void {
  container.innerHTML = '';
  const form = document.createElement('form');
  form.className = 'bug-add-form';
  form.setAttribute('aria-label', 'Add bug');

  const chatSelect = document.createElement('select');
  chatSelect.name = 'chat';
  chatSelect.className = 'bug-add-form__input';
  chatSelect.setAttribute('aria-label', 'Target chat');
  const chats = chatsForAddBugForm();
  const activeId = getActiveChat().id;
  for (const chat of chats) {
    const opt = document.createElement('option');
    opt.value = chat.id;
    opt.textContent = chat.name;
    if (chat.id === activeId) opt.selected = true;
    chatSelect.appendChild(opt);
  }

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

  form.append(chatSelect, titleInput, descInput, severitySelect, submit);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const chat = findChatById(chatSelect.value);
    if (!chat) return;
    const title = titleInput.value.trim();
    const description = descInput.value.trim();
    const severityRaw = severitySelect.value;
    if (!title || !isBugSeverity(severityRaw)) return;

    const input: AddBugInput = { title, description, severity: severityRaw };
    const bugId = `bug-${Date.now().toString(36)}`;
    addBug(chat, input, bugId);
    titleInput.value = '';
    descInput.value = '';
    refreshGlobalBugKanban();
    void import('./global-bugs-page').then((m) => m.refreshGlobalBugsSidebarBadge());
  });

  container.appendChild(form);
}

function countEntriesByColumn(entries: GlobalBugEntry[]): Record<BugColumn, number> {
  const counts: Record<BugColumn, number> = {
    reported: 0,
    investigating: 0,
    planned: 0,
    fixing: 0,
    complete: 0,
  };
  for (const entry of entries) {
    counts[entry.bug.column] += 1;
  }
  return counts;
}

function refreshKanbanDom(root: HTMLElement, entries: GlobalBugEntry[]): void {
  const counts = countEntriesByColumn(entries);
  const titleEl = root.querySelector('.board-header__title');
  if (titleEl) {
    titleEl.textContent = `Bug tracker · ${entries.length} shown`;
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

    for (const entry of entries.filter((e) => e.bug.column === col.id)) {
      list.appendChild(renderBugCard(entry));
    }

    columnEl.appendChild(list);
    kanban.appendChild(columnEl);
  }
}

/** Update filter options used for the global kanban. */
export function setGlobalBugKanbanOptions(options: CollectGlobalBugsOptions): void {
  collectOptions = { ...options };
}

/** Re-render global kanban when filters or bugs change. */
export function refreshGlobalBugKanban(): void {
  if (!kanbanMount || !sessionState) return;
  ensureBugSubscriptions();
  const entries = collectGlobalBugs(sessionState.chats, collectOptions);
  const root = kanbanMount.querySelector('.board-root.bug-board-root');
  if (!root) return;
  refreshKanbanDom(root as HTMLElement, entries);

  const empty = kanbanMount.querySelector('.global-bugs-empty');
  if (empty) {
    empty.classList.toggle('hidden', entries.length > 0);
  }
}

/** Mount aggregated bug Kanban into the global bugs page. */
export function mountGlobalBugKanban(mount: HTMLElement): void {
  kanbanMount = mount;
  mount.innerHTML = '';

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
  toolbar.appendChild(leading);
  header.appendChild(toolbar);
  root.appendChild(header);

  const addSection = document.createElement('div');
  addSection.className = 'bug-add-section';
  renderAddBugForm(addSection);
  root.appendChild(addSection);

  const empty = document.createElement('p');
  empty.className = 'global-bugs-empty';
  empty.textContent =
    'No bugs match these filters. Add one above or widen the workspace filter.';

  const kanban = document.createElement('div');
  kanban.className = 'board-kanban bug-board-kanban';
  root.appendChild(kanban);

  mount.appendChild(empty);
  mount.appendChild(root);

  refreshGlobalBugKanban();
}

/** Tear down global kanban listeners. */
export function unmountGlobalBugKanban(): void {
  disposeBugSubscriptions();
  kanbanMount = null;
}
