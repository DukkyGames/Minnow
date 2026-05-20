/**
 * Orchestrate board tools: board_init, board_update_task, board_get_state.
 */

import { normalizeModeId } from '../chat/modes/types.ts';
import {
  getBoardState,
  initBoard,
  updateTask,
} from '../state/orchestrate-board-store.ts';
import { findChatById } from '../state/sessions.ts';
import type { BoardCategory, BoardTaskStatus, Chat } from '../types.ts';

export interface BoardExecutorContext {
  chatId: string;
}

let executorContext: BoardExecutorContext | null = null;

/** Set parent chat context for board_* tools (from tool loop). */
export function setBoardExecutorContext(ctx: BoardExecutorContext | null): void {
  executorContext = ctx;
}

/** Current board executor context (tests / diagnostics). */
export function getBoardExecutorContext(): BoardExecutorContext | null {
  return executorContext;
}

const BOARD_TASK_STATUSES = new Set<BoardTaskStatus>([
  'planned',
  'in_progress',
  'testing',
  'complete',
  'failed',
  'blocked',
]);

const BOARD_CATEGORIES = new Set<BoardCategory>(['build', 'fix', 'test', 'research']);

function resolveOrchestrateChat(): Chat | null {
  const chatId = executorContext?.chatId?.trim();
  if (!chatId) return null;
  const chat = findChatById(chatId);
  if (!chat || normalizeModeId(chat.modeId) !== 'orchestrate') return null;
  return chat;
}

function parseWaveId(raw: unknown): number | string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

export type BoardInitArgs = {
  plan_path: string;
  tasks: Array<{
    id: string;
    title: string;
    wave: number | string;
    category: BoardCategory;
  }>;
  waves: Array<{ id: number | string }>;
};

export type ValidateBoardInitResult =
  | { ok: true; args: BoardInitArgs }
  | { ok: false; error: string };

/** Validate board_init arguments (exported for tests). */
export function validateBoardInitArgs(
  args: Record<string, unknown>,
  chat: Chat | null,
): ValidateBoardInitResult {
  const plan_path = typeof args.plan_path === 'string' ? args.plan_path.trim() : '';
  if (!plan_path) return { ok: false, error: 'Error: board_init requires "plan_path"' };

  if (chat?.orchestratePlanPath && chat.orchestratePlanPath !== plan_path) {
    return {
      ok: false,
      error: `Error: plan_path must match selected plan (${chat.orchestratePlanPath})`,
    };
  }

  if (!Array.isArray(args.tasks) || !args.tasks.length) {
    return { ok: false, error: 'Error: board_init requires non-empty "tasks"' };
  }
  if (!Array.isArray(args.waves) || !args.waves.length) {
    return { ok: false, error: 'Error: board_init requires non-empty "waves"' };
  }

  const waveIds = new Set<number | string>();
  const parsedWaves: Array<{ id: number | string }> = [];
  for (const w of args.waves) {
    if (!w || typeof w !== 'object') {
      return { ok: false, error: 'Error: each wave must have an "id"' };
    }
    const id = parseWaveId((w as Record<string, unknown>).id);
    if (id === null) return { ok: false, error: 'Error: each wave must have an "id"' };
    if (waveIds.has(id)) return { ok: false, error: 'Error: duplicate wave id' };
    waveIds.add(id);
    parsedWaves.push({ id });
  }

  const taskIds = new Set<string>();
  const parsedTasks: BoardInitArgs['tasks'] = [];
  for (const item of args.tasks) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Error: each task must have id, title, wave, category' };
    }
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const wave = parseWaveId(r.wave);
    const category =
      typeof r.category === 'string' && BOARD_CATEGORIES.has(r.category as BoardCategory)
        ? (r.category as BoardCategory)
        : null;
    if (!id || !title || wave === null || !category) {
      return { ok: false, error: 'Error: each task must have id, title, wave, category' };
    }
    if (taskIds.has(id)) return { ok: false, error: 'Error: duplicate task id' };
    if (!waveIds.has(wave)) {
      return { ok: false, error: `Error: task "${id}" references unknown wave "${wave}"` };
    }
    taskIds.add(id);
    parsedTasks.push({ id, title, wave, category });
  }

  return {
    ok: true,
    args: { plan_path, tasks: parsedTasks, waves: parsedWaves },
  };
}

export type BoardUpdateTaskArgs = {
  task_id: string;
  status: BoardTaskStatus;
  run_id?: string;
  files_changed?: number;
  notes?: string;
  error?: string;
};

export type ValidateBoardUpdateTaskResult =
  | { ok: true; args: BoardUpdateTaskArgs }
  | { ok: false; error: string };

/** Validate board_update_task arguments (exported for tests). */
export function validateBoardUpdateTaskArgs(
  args: Record<string, unknown>,
): ValidateBoardUpdateTaskResult {
  const task_id = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  if (!task_id) return { ok: false, error: 'Error: board_update_task requires "task_id"' };

  const statusRaw = typeof args.status === 'string' ? args.status.trim() : '';
  if (!BOARD_TASK_STATUSES.has(statusRaw as BoardTaskStatus)) {
    return { ok: false, error: 'Error: board_update_task requires valid "status"' };
  }
  const status = statusRaw as BoardTaskStatus;

  const run_id =
    typeof args.run_id === 'string' && args.run_id.trim() ? args.run_id.trim() : undefined;
  const files_changed =
    typeof args.files_changed === 'number' && Number.isFinite(args.files_changed)
      ? args.files_changed
      : undefined;
  const notes = typeof args.notes === 'string' ? args.notes : undefined;
  const error = typeof args.error === 'string' ? args.error : undefined;

  return {
    ok: true,
    args: {
      task_id,
      status,
      ...(run_id ? { run_id } : {}),
      ...(files_changed !== undefined ? { files_changed } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(error !== undefined ? { error } : {}),
    },
  };
}

/** Execute board_* tools; returns JSON string or Error: prefix. */
export async function executeBoardTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const chat = resolveOrchestrateChat();
  if (!chat) {
    return 'Error: board tools require an active Orchestrate chat';
  }

  if (name === 'board_init') {
    const validated = validateBoardInitArgs(args, chat);
    if (validated.ok === false) return validated.error;
    const board = initBoard(chat, {
      planPath: validated.args.plan_path,
      tasks: validated.args.tasks,
      waves: validated.args.waves,
    });
    return JSON.stringify(board, null, 2);
  }

  if (name === 'board_update_task') {
    const validated = validateBoardUpdateTaskArgs(args);
    if (validated.ok === false) return validated.error;
    if (!chat.orchestrateBoard) {
      return 'Error: orchestrate board is not initialized';
    }
    try {
      const patch: Parameters<typeof updateTask>[2] = { status: validated.args.status };
      if (validated.args.run_id) patch.assignedRunId = validated.args.run_id;
      if (validated.args.files_changed !== undefined) {
        patch.filesChanged = validated.args.files_changed;
      }
      if (validated.args.notes !== undefined) patch.notes = validated.args.notes;
      if (validated.args.error !== undefined) patch.error = validated.args.error;
      const task = updateTask(chat, validated.args.task_id, patch);
      return JSON.stringify(task, null, 2);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return message.startsWith('Error:') ? message : `Error: ${message}`;
    }
  }

  if (name === 'board_get_state') {
    const board = getBoardState(chat);
    if (!board) return 'Error: orchestrate board is not initialized';
    return JSON.stringify(board, null, 2);
  }

  return `Error: unknown board tool "${name}"`;
}
