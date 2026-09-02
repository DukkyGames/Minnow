import {
  clearChatTodos,
  findChatById,
  getChatTodos,
  setChatTodos,
} from '../state/sessions';
import type { Chat, ChatTodo } from '../types';
import { syncTodoPanel } from '../ui/todo-panel';

const MAX_TODO_ITEMS = 20;
const MAX_TODO_TEXT_CHARS = 140;

export type TodoWriteArgs = {
  todos: ChatTodo[];
};

export type ValidateTodoWriteResult =
  | { ok: true; args: TodoWriteArgs }
  | { ok: false; error: string };

/** Coerce JSON array fields some models stringify or wrap in tool arguments. */
function coerceToolArrayField(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object' && parsed !== null) return [parsed];
      return null;
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('item' in obj) return coerceToolArrayField(obj.item);
    if ('items' in obj) return coerceToolArrayField(obj.items);
  }
  return null;
}

/** Normalize status synonyms from smaller models (tolerant, never rejects). */
export function normalizeTodoStatus(raw: unknown): ChatTodo['status'] {
  if (typeof raw !== 'string') return 'pending';
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!v) return 'pending';
  if (/^(done|complete|completed|finished|finish)$/.test(v)) return 'completed';
  if (/^(active|current|doing|in_progress|inprogress|working|progress)$/.test(v)) {
    return 'in_progress';
  }
  if (/^(todo|open|not_started|notstarted|pending|waiting)$/.test(v)) return 'pending';
  if (v === 'completed' || v === 'in_progress' || v === 'pending') {
    return v as ChatTodo['status'];
  }
  return 'pending';
}

/** Normalize todo_write payload shape before validation. */
export function normalizeTodoWriteArgs(args: Record<string, unknown>): Record<string, unknown> {
  const todos = coerceToolArrayField(args.todos);
  return {
    ...args,
    ...(todos ? { todos } : {}),
  };
}

/** Validate and sanitize todo_write arguments (exported for tests). */
export function validateTodoWriteArgs(args: Record<string, unknown>): ValidateTodoWriteResult {
  const normalized = normalizeTodoWriteArgs(args);
  const rawTodos = normalized.todos;

  if (rawTodos === undefined) {
    return { ok: false, error: 'Error: todo_write requires "todos" array' };
  }
  if (!Array.isArray(rawTodos)) {
    return { ok: false, error: 'Error: todo_write requires "todos" array' };
  }

  const parsed: ChatTodo[] = [];
  for (const item of rawTodos.slice(0, MAX_TODO_ITEMS)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const textRaw = typeof row.text === 'string' ? row.text : String(row.text ?? '');
    const text = textRaw.trim().slice(0, MAX_TODO_TEXT_CHARS);
    if (!text) continue;
    parsed.push({
      text,
      status: normalizeTodoStatus(row.status),
    });
  }

  let sawInProgress = false;
  const todos: ChatTodo[] = parsed.map((item) => {
    if (item.status !== 'in_progress') return item;
    if (!sawInProgress) {
      sawInProgress = true;
      return item;
    }
    return { ...item, status: 'pending' as const };
  });

  return { ok: true, args: { todos } };
}

export type TodoWriteExecutorContext = {
  chatId?: string;
};

function formatTodoProgress(todos: ChatTodo[]): string {
  const completed = todos.filter((t) => t.status === 'completed').length;
  return `${completed}/${todos.length}`;
}

/** Execute todo_write — writes to the active chat and refreshes the checklist UI. */
export function executeTodoWrite(
  args: Record<string, unknown>,
  context: TodoWriteExecutorContext = {},
): string {
  const validated = validateTodoWriteArgs(args);
  if (validated.ok === false) return validated.error;

  const chatId = context.chatId?.trim();
  if (!chatId) {
    return 'Error: todo_write requires an active chat context';
  }

  const chat = findChatById(chatId);
  if (!chat) {
    return 'Error: active chat not found';
  }

  const { todos } = validated.args;
  if (todos.length === 0) {
    clearChatTodos(chat);
  } else {
    setChatTodos(chat, todos);
  }

  syncTodoPanel();

  return JSON.stringify({
    progress: formatTodoProgress(getChatTodos(chat) ?? []),
    todos: getChatTodos(chat) ?? [],
  });
}

/** Defense helper for tests — whether todo_write may run on this chat. */
export function isTodoWriteAllowedForChat(chat: Chat | null | undefined): boolean {
  return Boolean(chat);
}
