/**
 * Orchestrate board tools: board_init, board_update_task, board_get_state, delegate_tasks, board_set_autonomy.
 */

import { getSubAgentRun } from '../agents/orchestrator.ts';
import {
  isMaxToolTurnSummary,
  isSubAgentRunSuccessful,
} from '../agents/sub-agent-outcome.ts';
import { normalizeModeId } from '../chat/modes/types.ts';
import {
  getBoardGroupForChat,
  getOrCreateBoardGroup,
  getPlannerChatForGroup,
} from '../state/chat-groups.ts';
import {
  isTaskReadyForAuto,
} from '../state/orchestrate-board-store.ts';
import {
  getBoardStateForPlanner,
  initBoard,
  updateTask,
} from '../state/orchestrate-board-store.ts';
import {
  requestPendingAfk,
  moveTaskStatus,
  setBoardExecutionMode,
  startBoardAutoRun,
} from '../state/orchestrate-board-actions.ts';
import { emitBoardChange } from '../state/orchestrate-board-events.ts';
import { findChatById, scheduleSaveSessions } from '../state/sessions.ts';
import type { BoardCategory, BoardTask, BoardTaskStatus, Chat, OrchestrateBoardState } from '../types.ts';

export interface BoardExecutorContext {
  chatId: string;
  groupId?: string;
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
  'merging',
  'complete',
  'failed',
  'blocked',
  'quarantined',
]);

const BOARD_CATEGORIES = new Set<BoardCategory>(['build', 'fix', 'test', 'research']);

export type BoardToolOptions = {
  /** Active chat from the tool loop or sub-agent parent (overrides module context). */
  chatId?: string;
};

function resolveActiveChatId(overrideChatId?: string): string | null {
  const id = overrideChatId?.trim() || executorContext?.chatId?.trim();
  return id || null;
}

/** Planner chat for board_init (must be Orchestrate mode on the calling chat). */
function resolveOrchestratePlannerChat(overrideChatId?: string): Chat | null {
  const chatId = resolveActiveChatId(overrideChatId);
  if (!chatId) return null;
  const chat = findChatById(chatId);
  if (!chat || normalizeModeId(chat.modeId) !== 'orchestrate') return null;
  return chat;
}

/**
 * Planner chat for board_get_state / board_update_task.
 * Accepts Orchestrate planner chats, board task chats, and sub-agent parents linked to a board folder.
 */
function resolveBoardPlannerChat(overrideChatId?: string): Chat | null {
  const chatId = resolveActiveChatId(overrideChatId);
  if (!chatId) return null;
  const chat = findChatById(chatId);
  if (!chat) return null;

  if (normalizeModeId(chat.modeId) === 'orchestrate') {
    return chat;
  }

  const group = getBoardGroupForChat(chat);
  if (!group?.orchestrateBoard) return null;

  return getPlannerChatForGroup(group) ?? null;
}

/** Board folder for any chat linked to an orchestrate board (planner, task, tester, final). */
function resolveBoardGroupFromChat(overrideChatId?: string): {
  group: NonNullable<ReturnType<typeof getBoardGroupForChat>>;
  board: OrchestrateBoardState;
} | null {
  const chatId = resolveActiveChatId(overrideChatId);
  if (!chatId) return null;
  const chat = findChatById(chatId);
  if (!chat) return null;
  const group = getBoardGroupForChat(chat);
  const board = group?.orchestrateBoard;
  if (!group || !board) return null;
  return { group, board };
}

function validateBoardTaskIds(
  board: OrchestrateBoardState,
  ids: string[],
): { ok: true; ids: string[] } | { ok: false; error: string } {
  const known = new Set(board.tasks.map((t) => t.id));
  const validated: string[] = [];
  const unknown: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    if (!known.has(id)) {
      unknown.push(id);
      continue;
    }
    if (!validated.includes(id)) validated.push(id);
  }
  if (unknown.length) {
    return {
      ok: false,
      error: `Error: unknown board task id(s): ${unknown.join(', ')}. Use board_get_state to list valid ids.`,
    };
  }
  return { ok: true, ids: validated };
}

/**
 * Resolve a loosely-specified task id against the board.
 * Handles the common ways a model mangles the id: a trailing
 * `— title` / `: title` suffix and casing. Returns the canonical id, or
 * the trimmed input unchanged when no match is found (caller validates).
 */
function resolveLooseTaskId(board: OrchestrateBoardState, raw: string): string {
  const input = raw.trim();
  if (!input) return input;
  const known = board.tasks.map((t) => t.id);
  if (known.includes(input)) return input;
  // Strip a "<id> — <title>" / "<id>: <title>" suffix the model may have appended.
  const head = input.split(/\s*[—:-]\s+/)[0]?.trim() ?? input;
  const lowerHead = head.toLowerCase();
  const ci = known.find((id) => id.toLowerCase() === lowerHead);
  if (ci) return ci;
  const lowerInput = input.toLowerCase();
  const ciFull = known.find((id) => id.toLowerCase() === lowerInput);
  if (ciFull) return ciFull;
  return input;
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
    build?: string;
    test?: string;
    dependsOn?: string[];
  }>;
  waves: Array<{ id: number | string }>;
};

export type ValidateBoardInitResult =
  | { ok: true; args: BoardInitArgs }
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
      if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
      return null;
    } catch {
      // Bare task id string (not a JSON array literal).
      return [trimmed];
    }
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Some providers emit { item: "W1-A" } or { item: ["W1-A", "W1-B"] } instead of a JSON array.
    if ('item' in obj) return coerceToolArrayField(obj.item);
    if ('items' in obj) return coerceToolArrayField(obj.items);
  }
  return null;
}

/** Normalize board_init payload shape before validation. */
export function normalizeBoardInitArgs(args: Record<string, unknown>): Record<string, unknown> {
  const tasks = coerceToolArrayField(args.tasks);
  const waves = coerceToolArrayField(args.waves);
  return {
    ...args,
    ...(tasks ? { tasks } : {}),
    ...(waves ? { waves } : {}),
  };
}

/** Validate board_init arguments (exported for tests). */
export function validateBoardInitArgs(
  args: Record<string, unknown>,
  chat: Chat | null,
): ValidateBoardInitResult {
  const normalized = normalizeBoardInitArgs(args);
  const plan_path =
    typeof normalized.plan_path === 'string' ? normalized.plan_path.trim() : '';
  if (!plan_path) return { ok: false, error: 'Error: board_init requires "plan_path"' };

  if (chat?.orchestratePlanPath && chat.orchestratePlanPath !== plan_path) {
    return {
      ok: false,
      error: `Error: plan_path must match selected plan (${chat.orchestratePlanPath})`,
    };
  }

  if (!Array.isArray(normalized.tasks) || !normalized.tasks.length) {
    return { ok: false, error: 'Error: board_init requires non-empty "tasks"' };
  }
  if (!Array.isArray(normalized.waves) || !normalized.waves.length) {
    return { ok: false, error: 'Error: board_init requires non-empty "waves"' };
  }

  const waveIds = new Set<number | string>();
  const parsedWaves: Array<{ id: number | string }> = [];
  for (const w of normalized.waves) {
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
  for (const item of normalized.tasks) {
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
    const build = typeof r.build === 'string' ? r.build.trim() : '';
    const test = typeof r.test === 'string' ? r.test.trim() : '';
    const rawDepsInput = r.dependsOn ?? r.depends_on;
    const rawDeps = coerceToolArrayField(rawDepsInput);
    if (
      rawDepsInput != null &&
      rawDepsInput !== '' &&
      (!rawDeps || rawDeps.length === 0)
    ) {
      return {
        ok: false,
        error: `Error: task "${id}" has invalid dependsOn (expected array of task ids)`,
      };
    }
    const deps = rawDeps
      ? rawDeps.map((d) => (typeof d === 'string' ? d.trim() : '')).filter(Boolean)
      : [];
    taskIds.add(id);
    parsedTasks.push({
      id,
      title,
      wave,
      category,
      ...(build ? { build } : {}),
      ...(test ? { test } : {}),
      ...(deps.length ? { dependsOn: deps } : {}),
    });
  }

  // Reference + self-dep validation
  for (const task of parsedTasks) {
    for (const dep of task.dependsOn ?? []) {
      if (dep === task.id) {
        return { ok: false, error: `Error: task "${task.id}" depends on itself` };
      }
      if (!taskIds.has(dep)) {
        return {
          ok: false,
          error: `Error: task "${task.id}" depends on unknown task "${dep}"`,
        };
      }
    }
  }

  // Cycle detection (iterative DFS)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(parsedTasks.map((t) => [t.id, WHITE]));
  for (const start of parsedTasks) {
    if (color.get(start.id) !== WHITE) continue;
    const stack: Array<{ id: string; visited: boolean }> = [{ id: start.id, visited: false }];
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      if (!top.visited) {
        top.visited = true;
        color.set(top.id, GRAY);
        const node = parsedTasks.find((t) => t.id === top.id);
        for (const dep of node?.dependsOn ?? []) {
          const c = color.get(dep) ?? WHITE;
          if (c === GRAY) {
            return { ok: false, error: `Error: dependency cycle detected involving task "${dep}"` };
          }
          if (c === WHITE) stack.push({ id: dep, visited: false });
        }
      } else {
        stack.pop();
        color.set(top.id, BLACK);
      }
    }
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

export type BoardReportArgs = {
  task_id: string;
  outcome: 'pass' | 'fail' | 'env_blocked';
  summary: string;
  blockers?: string[];
  failing_tasks?: string[];
};

export type ValidateBoardReportResult =
  | { ok: true; args: BoardReportArgs }
  | { ok: false; error: string };

/**
 * Coerce a model-supplied outcome to pass | fail | env_blocked.
 * Tolerant of casing and common synonyms from smaller models.
 */
export function normalizeOutcome(raw: unknown): 'pass' | 'fail' | 'env_blocked' | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[.!]+$/, '');
  if (!v) return null;
  if (/^(pass|passed|passing|passes|success|succeeded|succeeds|ok|green)$/.test(v)) {
    return 'pass';
  }
  if (/^(fail|failed|failing|fails|failure|error|errored|broken|red)$/.test(v)) {
    return 'fail';
  }
  if (/^(env_blocked|env blocked|env-blocked|blocked_env|infra_blocked|infra)$/.test(v)) {
    return 'env_blocked';
  }
  return null;
}

/** Validate board_report arguments (exported for tests). */
export function validateBoardReportArgs(
  args: Record<string, unknown>,
): ValidateBoardReportResult {
  const task_id = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  if (!task_id) {
    return { ok: false, error: 'Error: board_report requires "task_id"' };
  }
  const outcomeRaw = normalizeOutcome(args.outcome);
  if (!outcomeRaw) {
    return {
      ok: false,
      error: 'Error: board_report requires outcome "pass", "fail", or "env_blocked"',
    };
  }
  const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
  if (!summary) {
    return { ok: false, error: 'Error: board_report requires non-empty "summary"' };
  }
  const blockersRaw = args.blockers;
  let blockers: string[] | undefined;
  if (blockersRaw !== undefined) {
    if (!Array.isArray(blockersRaw)) {
      return { ok: false, error: 'Error: blockers must be an array of strings' };
    }
    blockers = [];
    for (const item of blockersRaw) {
      if (typeof item === 'string' && item.trim()) blockers.push(item.trim());
    }
  }
  const failingRaw = args.failing_tasks ?? args.failingTasks;
  let failing_tasks: string[] | undefined;
  if (failingRaw !== undefined) {
    if (!Array.isArray(failingRaw)) {
      return { ok: false, error: 'Error: failing_tasks must be an array of task ids' };
    }
    failing_tasks = [];
    for (const item of failingRaw) {
      if (typeof item !== 'string' || !item.trim()) {
        return { ok: false, error: 'Error: each failing_tasks entry must be a non-empty string' };
      }
      const id = item.trim();
      if (!failing_tasks.includes(id)) failing_tasks.push(id);
    }
  }
  return {
    ok: true,
    args: {
      task_id,
      outcome: outcomeRaw,
      summary,
      ...(blockers?.length ? { blockers } : {}),
      ...(failing_tasks?.length ? { failing_tasks } : {}),
    },
  };
}

/**
 * Coerce a model-supplied verdict to the canonical 'pass' | 'fail'.
 * Tolerant of casing, trailing punctuation, and common synonyms because
 * smaller models rarely emit the exact literal. Returns null when unclear.
 */
export function normalizeVerdict(raw: unknown): 'pass' | 'fail' | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[.!]+$/, '');
  if (!v) return null;
  if (/^(pass|passed|passing|passes|success|succeeded|succeeds|ok|green)$/.test(v)) {
    return 'pass';
  }
  if (/^(fail|failed|failing|fails|failure|error|errored|broken|red)$/.test(v)) {
    return 'fail';
  }
  return null;
}

const BOARD_AUTONOMY_LEVELS = new Set(['manual', 'sequential', 'auto', 'afk']);

export type BoardSetAutonomyArgs = {
  level: 'manual' | 'sequential' | 'auto' | 'afk';
};

export type ValidateBoardSetAutonomyResult =
  | { ok: true; args: BoardSetAutonomyArgs }
  | { ok: false; error: string };

/** Validate board_set_autonomy arguments (exported for tests). */
export function validateBoardSetAutonomyArgs(
  args: Record<string, unknown>,
): ValidateBoardSetAutonomyResult {
  const raw =
    typeof args.level === 'string'
      ? args.level
      : typeof args.mode === 'string'
        ? args.mode
        : '';
  const level = raw.trim().toLowerCase();
  if (!level) {
    return { ok: false, error: 'Error: board_set_autonomy requires "level"' };
  }
  if (!BOARD_AUTONOMY_LEVELS.has(level)) {
    return {
      ok: false,
      error: 'Error: board_set_autonomy requires level manual, sequential, auto, or afk',
    };
  }
  return { ok: true, args: { level: level as BoardSetAutonomyArgs['level'] } };
}

/** Execute board_* tools; returns JSON string or Error: prefix. */
export async function executeBoardTool(
  name: string,
  args: Record<string, unknown>,
  options?: BoardToolOptions,
): Promise<string> {
  if (name === 'board_init') {
    const initChat = resolveOrchestratePlannerChat(options?.chatId);
    if (!initChat) {
      return 'Error: board tools require an active Orchestrate chat';
    }
    return executeBoardInit(initChat, args);
  }

  if (name === 'board_update_task') {
    const plannerChat = resolveOrchestratePlannerChat(options?.chatId);
    if (!plannerChat) {
      const callerId = resolveActiveChatId(options?.chatId);
      const caller = callerId ? findChatById(callerId) : null;
      if (caller?.boardTaskId?.trim()) {
        return (
          "Error: Builders/testers don't move cards — report completion via your output " +
          '(READY FOR VERIFICATION); the board advances the task.'
        );
      }
      return 'Error: board tools require an active Orchestrate chat';
    }
    return executeBoardUpdateTask(plannerChat, args);
  }

  if (name === 'board_set_autonomy') {
    const plannerChat = resolveOrchestratePlannerChat(options?.chatId);
    if (!plannerChat) {
      return 'Error: board tools require an active Orchestrate chat';
    }
    return executeBoardSetAutonomy(plannerChat, args);
  }

  const chat = resolveBoardPlannerChat(options?.chatId);
  if (!chat) {
    return 'Error: board tools require an active Orchestrate chat';
  }

  if (name === 'board_get_state') {
    const board = getBoardStateForPlanner(chat);
    if (!board) return 'Error: orchestrate board is not initialized';
    return JSON.stringify(board, null, 2);
  }

  if (name === 'delegate_tasks') {
    return executeDelegateTasks(chat, args);
  }

  if (name === 'board_report') {
    return executeBoardReport(args, options?.chatId);
  }

  return `Error: unknown board tool "${name}"`;
}

async function executeBoardInit(
  chat: Chat,
  args: Record<string, unknown>,
): Promise<string> {
  const validated = validateBoardInitArgs(args, chat);
  if (validated.ok === false) return validated.error;
  const group = getOrCreateBoardGroup(chat);
  const board = initBoard(
    group,
    chat,
    {
      planPath: validated.args.plan_path,
      tasks: validated.args.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        wave: t.wave,
        category: t.category,
        build: t.build,
        test: t.test,
        dependsOn: t.dependsOn,
      })),
      waves: validated.args.waves,
    },
  );
  executorContext = { chatId: chat.id, groupId: group.id };
  return JSON.stringify(board, null, 2);
}

async function executeBoardUpdateTask(
  chat: Chat,
  args: Record<string, unknown>,
): Promise<string> {
  const validated = validateBoardUpdateTaskArgs(args);
  if (validated.ok === false) return validated.error;
  const group = getOrCreateBoardGroup(chat);
  const board = group.orchestrateBoard;
  if (!board) {
    return 'Error: orchestrate board is not initialized';
  }
  try {
    if (validated.args.status === 'complete') {
      const task = board.tasks.find((t) => t.id === validated.args.task_id);
      if (task?.error && isMaxToolTurnSummary(task.error)) {
        return (
          'Error: cannot mark task complete — task failed with max tool turns. ' +
          'Restart or spawn a new sub-agent.'
        );
      }
      const linkedRunId =
        validated.args.run_id?.trim() || task?.assignedRunId?.trim() || '';
      if (linkedRunId) {
        const run = getSubAgentRun(linkedRunId);
        if (run && !isSubAgentRunSuccessful(run)) {
          return (
            'Error: cannot mark task complete — linked sub-agent run did not succeed ' +
            '(failed, cancelled, or hit max tool turns). Restart or spawn a new sub-agent.'
          );
        }
      }
    }

    const patch: Parameters<typeof updateTask>[2] = {};
    if (validated.args.run_id) patch.assignedRunId = validated.args.run_id;
    if (validated.args.files_changed !== undefined) {
      patch.filesChanged = validated.args.files_changed;
    }
    if (validated.args.notes !== undefined) patch.notes = validated.args.notes;
    if (validated.args.error !== undefined) patch.error = validated.args.error;
    if (Object.keys(patch).length > 0) {
      updateTask(group, validated.args.task_id, patch, chat);
    }
    moveTaskStatus(group, validated.args.task_id, validated.args.status, chat);
    const task = board.tasks.find((t) => t.id === validated.args.task_id);
    if (!task) {
      return `Error: unknown board task "${validated.args.task_id}"`;
    }
    return JSON.stringify(task, null, 2);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return message.startsWith('Error:') ? message : `Error: ${message}`;
  }
}

async function executeBoardSetAutonomy(
  chat: Chat,
  args: Record<string, unknown>,
): Promise<string> {
  const validated = validateBoardSetAutonomyArgs(args);
  if (validated.ok === false) return validated.error;
  const group = getOrCreateBoardGroup(chat);
  const board = group.orchestrateBoard;
  if (!board) {
    return 'Error: orchestrate board is not initialized';
  }

  const { level } = validated.args;
  if (level === 'manual') {
    setBoardExecutionMode(group, 'manual', chat);
  } else if (level === 'afk') {
    requestPendingAfk(group, chat);
    return JSON.stringify({
      level,
      executionMode: board.executionMode ?? 'manual',
      autoRunning: board.autoRunning === true,
      pendingAfk: true,
      message:
        'AFK is pending user confirmation and will not activate until the user accepts on the board.',
    });
  } else {
    setBoardExecutionMode(group, level, chat);
    startBoardAutoRun(group, chat);
  }

  const current = group.orchestrateBoard!;
  return JSON.stringify({
    level,
    executionMode: current.executionMode ?? 'manual',
    autoRunning: current.autoRunning === true,
    pendingAfk: current.pendingAfk === true,
  });
}

export type DelegateTasksArgs = {
  taskIds: string[];
};

export type ValidateDelegateTasksResult =
  | { ok: true; args: DelegateTasksArgs }
  | { ok: false; error: string };

/** Validate delegate_tasks arguments (exported for tests). */
export function validateDelegateTasksArgs(
  args: Record<string, unknown>,
): ValidateDelegateTasksResult {
  const raw = args.taskIds ?? args.task_ids;
  if (!Array.isArray(raw) || !raw.length) {
    return { ok: false, error: 'Error: delegate_tasks requires non-empty "taskIds"' };
  }
  const taskIds: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) {
      return { ok: false, error: 'Error: each taskIds entry must be a non-empty string' };
    }
    const id = item.trim();
    if (!taskIds.includes(id)) taskIds.push(id);
  }
  return { ok: true, args: { taskIds } };
}

async function executeDelegateTasks(
  chat: Chat,
  args: Record<string, unknown>,
): Promise<string> {
  if (normalizeModeId(chat.modeId) !== 'orchestrate') {
    return 'Error: delegate_tasks requires an Orchestrate planner chat';
  }
  const validated = validateDelegateTasksArgs(args);
  if (validated.ok === false) return validated.error;

  const group = getOrCreateBoardGroup(chat);
  const board = group.orchestrateBoard;
  if (!board) {
    return 'Error: orchestrate board is not initialized';
  }
  if (board.executionMode !== 'auto') {
    return (
      'Error: delegate_tasks requires Auto-pilot (executionMode auto). ' +
      'Enable Auto-pilot on the board or call board_get_state to confirm mode.'
    );
  }

  const started: string[] = [];
  const skipped: Array<{ taskId: string; reason: string }> = [];

  const { startTask: runBoardTask } = await import('../state/orchestrate-board-actions.ts');

  for (const taskId of validated.args.taskIds) {
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) {
      skipped.push({ taskId, reason: 'unknown task id' });
      continue;
    }
    if (task.status !== 'planned') {
      skipped.push({ taskId, reason: `status is ${task.status}, not planned` });
      continue;
    }
    if (!isTaskReadyForAuto(board, task)) {
      skipped.push({ taskId, reason: 'prior wave not complete' });
      continue;
    }
    await runBoardTask(group, taskId, chat);
    started.push(taskId);
  }

  return JSON.stringify({ started, skipped }, null, 2);
}

function outcomeToBuildOutcome(outcome: 'pass' | 'fail' | 'env_blocked'): string {
  if (outcome === 'pass') return 'ok';
  if (outcome === 'env_blocked') return 'env_blocked';
  return 'failed';
}

function outcomeToTestVerdict(outcome: 'pass' | 'fail' | 'env_blocked'): 'pass' | 'fail' {
  return outcome === 'pass' ? 'pass' : 'fail';
}

/** Resolve whether to mirror legacy builder or tester fields for this caller chat. */
function resolveBoardReportMirrorRole(
  callerChat: Chat | null,
  task: BoardTask,
  isFullBoard: boolean,
): 'test' | 'build' | 'fixer' {
  if (isFullBoard) return 'test';
  if (!callerChat) return 'build';
  const chatId = callerChat.id;
  if (task.testChatId?.trim() === chatId) return 'test';
  if (task.fixerChatId?.trim() === chatId) return 'fixer';
  if (task.chatId?.trim() === chatId) return 'build';
  if (callerChat.workAgentId === 'tester') return 'test';
  return 'build';
}

async function executeBoardReport(
  args: Record<string, unknown>,
  overrideChatId?: string,
): Promise<string> {
  const validated = validateBoardReportArgs(args);
  if (validated.ok === false) return validated.error;

  const ctx = resolveBoardGroupFromChat(overrideChatId);
  if (!ctx) {
    return 'Error: board_report requires a chat linked to an orchestrate board';
  }
  const { group, board } = ctx;
  const { task_id, outcome, summary, blockers, failing_tasks } = validated.args;
  const callerChatId = resolveActiveChatId(overrideChatId);
  const callerChat = callerChatId ? findChatById(callerChatId) : null;

  const boardReport = {
    outcome,
    summary,
    ...(blockers?.length ? { blockers } : {}),
  };

  if (task_id === 'FULL_BOARD') {
    let validatedFailing: string[] = [];
    if (failing_tasks?.length) {
      const check = validateBoardTaskIds(board, failing_tasks);
      if (check.ok === false) return check.error;
      validatedFailing = check.ids;
    }
    const priorFinal = board.finalTest;
    board.finalTest = {
      status: priorFinal?.status ?? 'in_progress',
      chatId: priorFinal?.chatId,
      attempts: priorFinal?.attempts,
      recordedVerdict: outcomeToTestVerdict(outcome),
      summary,
      failingTaskIds: validatedFailing,
    };
    board.lastUpdatedAt = Date.now();
    scheduleSaveSessions();
    emitBoardChange(group.id);
    return JSON.stringify(
      {
        task_id: 'FULL_BOARD',
        outcome,
        summary,
        failingTaskIds: validatedFailing,
      },
      null,
      2,
    );
  }

  const taskCheck = validateBoardTaskIds(board, [resolveLooseTaskId(board, task_id)]);
  if (taskCheck.ok === false) return taskCheck.error;
  const taskId = taskCheck.ids[0]!;
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) {
    return `Error: unknown board task "${taskId}"`;
  }
  const planner = getPlannerChatForGroup(group) ?? undefined;
  const mirrorRole = resolveBoardReportMirrorRole(callerChat, task, false);
  const patch: Record<string, unknown> = { boardReport };

  if (mirrorRole === 'test') {
    patch.testVerdict = outcomeToTestVerdict(outcome);
    patch.testSummary = summary;
  } else if (mirrorRole === 'build') {
    patch.buildOutcome = outcomeToBuildOutcome(outcome);
    if (blockers?.length) patch.buildBlockers = blockers;
  }

  const updated = updateTask(group, taskId, patch, planner);
  return JSON.stringify(
    { task_id: taskId, outcome, summary, task: updated },
    null,
    2,
  );
}
