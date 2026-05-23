/**
 * Bug tracker Kanban — global All bugs page only (MIN-16).
 */

import {
  runBugInvestigate,
  runBugPlanFix,
  runBugStartFix,
} from '../chat/bug-board/pipeline.ts';
import {
  collectGlobalBugs,
  formatGlobalBugWorkspaceLabel,
  type CollectGlobalBugsOptions,
  type GlobalBugEntry,
} from '../state/global-bugs.ts';
import { subscribeBugsChanges } from '../state/bug-board-events.ts';
import {
  addBug,
  isBugSeverity,
  type AddBugInput,
} from '../state/bug-board-store.ts';
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
let bugsChangeUnsub: (() => void) | null = null;

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
  bugsChangeUnsub?.();
  bugsChangeUnsub = null;
}

function ensureBugSubscriptions(): void {
  if (bugsChangeUnsub) return;
  bugsChangeUnsub = subscribeBugsChanges(() => {
    if (isGlobalBugsPageOpen()) refreshGlobalBugKanban();
  });
}

function setBugBoardStatus(message: string, kind: 'ok' | 'err' | 'idle'): void {
  void import('./status').then((m) => {
    if (kind === 'idle') m.setStatus('idle', '');
    else m.setStatus(kind === 'ok' ? 'ok' : 'err', message);
  });
}

function columnActions(bug: BugCard): Array<{ label: string; action: () => void }> {
  const actions: Array<{ label: string; action: () => void }> = [];

  if (bug.column === 'reported' || bug.column === 'investigating') {
    actions.push({
      label: 'Investigate',
      action: () => {
        void runBugInvestigate(bug.id).then((r) => {
          if (!r.ok) setBugBoardStatus(r.error ?? 'Investigate failed', 'err');
          else {
            setBugBoardStatus('Investigation chat opened', 'ok');
            if (r.chatId) {
              void import('./global-bugs-page').then((m) => m.openGlobalBugInChat(r.chatId!));
            }
          }
          refreshGlobalBugKanban();
        });
      },
    });
  }
  if (bug.column === 'investigating' || (bug.column === 'reported' && bug.notes)) {
    actions.push({
      label: 'Plan fix',
      action: () => {
        void runBugPlanFix(bug.id).then((r) => {
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
        void runBugStartFix(bug.id, sendBoardMessage).then((r) => {
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
  const { bug, chatName } = entry;
  const card = document.createElement('article');
  card.className = 'board-task-card bug-task-card';
  if (bug.chatId) {
    card.classList.add('board-task-card--clickable');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.title = `Open chat: ${chatName}`;
    card.addEventListener('click', () => {
      void import('./global-bugs-page').then((m) => m.openGlobalBugInChat(bug.chatId!));
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void import('./global-bugs-page').then((m) => m.openGlobalBugInChat(bug.chatId!));
      }
    });
  }

  const title = document.createElement('h4');
  title.className = 'board-task-card__title';
  title.textContent = bug.title;

  const meta = document.createElement('div');
  meta.className = 'board-task-card__meta';
  const ws = formatGlobalBugWorkspaceLabel(bug);
  meta.textContent = `${bug.severity} · ${ws}${bug.chatId ? ` · ${chatName}` : ''}`;

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

function renderAddBugForm(container: HTMLElement): void {
  container.innerHTML = '';
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
  severitySelect.setAttribute('aria-label', 'Severity');
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
    if (!title || !isBugSeverity(severityRaw)) return;

    const input: AddBugInput = {
      title,
      description,
      severity: severityRaw,
      workspacePath: getWorkspacePath(),
    };
    const bugId = `bug-${Date.now().toString(36)}`;
    addBug(input, bugId);
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

  const kanban = root.querySelector('.kanban-grid');
  if (!kanban) return;
  kanban.innerHTML = '';

  for (const col of COLUMNS) {
    const columnEl = document.createElement('section');
    columnEl.className = 'kanban-column';
    columnEl.dataset.column = col.id;

    const head = document.createElement('h3');
    head.textContent = `${col.label} (${counts[col.id]})`;
    columnEl.appendChild(head);

    const list = document.createElement('div');
    list.className = 'kanban-column__list';

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
  if (!kanbanMount) return;
  ensureBugSubscriptions();
  const entries = collectGlobalBugs(collectOptions);
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

  const main = document.createElement('div');
  main.className = 'board-main';
  const kanban = document.createElement('div');
  kanban.className = 'kanban-grid bug-board-kanban';
  main.appendChild(kanban);
  root.appendChild(main);

  mount.appendChild(empty);
  mount.appendChild(root);

  refreshGlobalBugKanban();
}

/** Tear down global kanban listeners. */
export function unmountGlobalBugKanban(): void {
  disposeBugSubscriptions();
  kanbanMount = null;
}
