import { getActiveChat } from '../state/sessions';
import { getChatTodos } from '../state/sessions';
import type { Chat, ChatTodo } from '../types';

export type TodoPanelItemView = {
  text: string;
  status: ChatTodo['status'];
  marker: 'completed' | 'in_progress' | 'pending';
};

export type TodoPanelView = {
  hidden: boolean;
  progressLabel: string;
  progressRatio: number;
  items: TodoPanelItemView[];
  defaultCollapsed: boolean;
};

/** Per-chat user collapse overrides survive syncTodoPanel re-renders. */
const collapsedOverrideByChatId = new Set<string>();

function markerForStatus(status: ChatTodo['status']): TodoPanelItemView['marker'] {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'pending';
}

/** Pure display helper for the checklist panel (unit-tested without DOM). */
export function deriveTodoPanelView(chat: Chat | null | undefined): TodoPanelView {
  const todos = chat ? (getChatTodos(chat) ?? []) : [];
  if (!todos.length) {
    return {
      hidden: true,
      progressLabel: '',
      progressRatio: 0,
      items: [],
      defaultCollapsed: true,
    };
  }

  const completed = todos.filter((t) => t.status === 'completed').length;
  const hasOpen = todos.some((t) => t.status === 'pending' || t.status === 'in_progress');
  const allComplete = completed === todos.length && todos.length > 0;
  const progressLabel = allComplete ? `${completed}/${todos.length} ✓` : `${completed}/${todos.length}`;
  const progressRatio = todos.length ? completed / todos.length : 0;

  return {
    hidden: false,
    progressLabel,
    progressRatio,
    items: todos.map((item) => ({
      text: item.text,
      status: item.status,
      marker: markerForStatus(item.status),
    })),
    defaultCollapsed: allComplete,
  };
}

function isPanelCollapsed(chatId: string, view: TodoPanelView): boolean {
  if (collapsedOverrideByChatId.has(chatId)) return true;
  return view.defaultCollapsed;
}

/** Show, hide, or refresh the collapsible checklist above the composer. */
export function syncTodoPanel(): void {
  if (typeof document === 'undefined') return;

  const chat = getActiveChat();
  const chatId = chat?.id ?? '';
  const view = deriveTodoPanelView(chat);

  let el = document.getElementById('composerTodoPanel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'composerTodoPanel';
    el.className = 'composer-todo-panel hidden';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Build progress checklist');
    const host = document.querySelector('.input-bar-composer');
    if (host) {
      host.insertBefore(el, host.firstChild);
    } else {
      document.body.appendChild(el);
    }
  }

  if (view.hidden || !chat) {
    el.classList.add('hidden');
    el.replaceChildren();
    return;
  }

  el.classList.remove('hidden');
  const collapsed = isPanelCollapsed(chatId, view);

  el.replaceChildren();

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'composer-todo-panel__header';
  header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

  const title = document.createElement('span');
  title.className = 'composer-todo-panel__title';
  title.textContent = `Checklist ${view.progressLabel}`;

  const bar = document.createElement('span');
  bar.className = 'composer-todo-panel__progress';
  bar.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('span');
  fill.className = 'composer-todo-panel__progress-fill';
  fill.style.width = `${Math.round(view.progressRatio * 100)}%`;
  bar.appendChild(fill);

  header.appendChild(title);
  header.appendChild(bar);

  header.addEventListener('click', () => {
    if (collapsedOverrideByChatId.has(chatId)) {
      collapsedOverrideByChatId.delete(chatId);
    } else {
      collapsedOverrideByChatId.add(chatId);
    }
    syncTodoPanel();
  });

  el.appendChild(header);

  if (!collapsed) {
    const list = document.createElement('ul');
    list.className = 'composer-todo-panel__list';

    for (const item of view.items) {
      const row = document.createElement('li');
      row.className = `composer-todo-panel__item composer-todo-panel__item--${item.marker}`;
      row.title = item.text;

      const glyph = document.createElement('span');
      glyph.className = 'composer-todo-panel__glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent =
        item.marker === 'completed' ? '✓' : item.marker === 'in_progress' ? '●' : '○';

      const text = document.createElement('span');
      text.className = 'composer-todo-panel__text';
      text.textContent = item.text;

      row.appendChild(glyph);
      row.appendChild(text);
      list.appendChild(row);
    }

    el.appendChild(list);
  }
}

/** Test helper — read collapse override state for a chat. */
export function isTodoPanelCollapsedOverride(chatId: string): boolean {
  return collapsedOverrideByChatId.has(chatId);
}

/** Test helper — reset module collapse overrides. */
export function resetTodoPanelCollapseOverridesForTests(): void {
  collapsedOverrideByChatId.clear();
}
