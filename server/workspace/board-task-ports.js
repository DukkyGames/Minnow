/**
 * Resolve per-task dev/API ports for board worktree chats and build spawn env.
 *
 * Hot path (no injectedState): indexed SQLite lookup via resolveBoardTaskPorts.
 * Injected state keeps the in-memory validate+scan path for unit tests.
 */

import path from 'node:path';
import {
  resolveBoardTaskPorts,
  useJsonSessionsStore,
} from '../config/sessions-repo.js';
import { readConfigJson } from '../config/store.js';
import { validateSessionState } from '../config/validators.js';
import { resolveChatCwd } from './chat-cwd.js';

/** @typedef {import('../config/validators.js').SessionState} SessionState */

const API_PORT_OFFSET = 100;

function normalizeComparablePath(p) {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * Env merged into execute_command / start_background_command for board worktrees.
 * @param {number} devPort Vite client port
 * @param {number} apiPort Express/API port
 * @returns {Record<string, string>}
 */
export function buildBoardTaskSpawnEnv(devPort, apiPort) {
  return {
    PORT: String(apiPort),
    VITE_PORT: String(devPort),
    MINNOW_API_PORT: String(apiPort),
    MINNOW_CLIENT_PORT: String(devPort),
    HOST: '127.0.0.1',
    VITE_DEV_SERVER_HOST: '127.0.0.1',
  };
}

/**
 * @param {SessionState} state
 * @param {string} cwd
 * @returns {{ devPort: number, apiPort: number } | undefined}
 */
function resolvePortsByWorktreeCwd(state, cwd) {
  const target = normalizeComparablePath(cwd);
  if (!Array.isArray(state.groups)) return undefined;

  for (const group of state.groups) {
    const board = group.orchestrateBoard;
    if (!board) continue;
    for (const task of board.tasks) {
      const wt = task.worktreePath?.trim();
      if (!wt) continue;
      if (normalizeComparablePath(wt) !== target) continue;
      if (typeof task.devPort !== 'number' || !Number.isFinite(task.devPort)) continue;
      const apiPort =
        typeof task.apiPort === 'number' && Number.isFinite(task.apiPort)
          ? task.apiPort
          : task.devPort + API_PORT_OFFSET;
      return { devPort: task.devPort, apiPort };
    }
  }
  return undefined;
}

/**
 * In-memory port resolution from a SessionState blob (tests + JSON rollback).
 * @param {{ chatId?: string, cwd?: string }} params
 * @param {SessionState} state
 * @returns {Promise<Record<string, string> | undefined>}
 */
async function resolveFromSessionBlob({ chatId, cwd }, state) {
  const trimmedChatId = typeof chatId === 'string' ? chatId.trim() : '';
  let resolvedCwd = typeof cwd === 'string' && cwd.trim() ? path.resolve(cwd.trim()) : '';

  if (trimmedChatId) {
    const fromChat = await resolveChatCwd(trimmedChatId, state);
    if (fromChat) resolvedCwd = path.resolve(fromChat);
  }

  if (!resolvedCwd) return undefined;

  const chat = trimmedChatId
    ? state.chats.find((c) => c.id === trimmedChatId)
    : undefined;
  const taskId = chat?.boardTaskId?.trim();
  const groupId = chat?.boardGroupId?.trim();

  if (taskId && groupId && Array.isArray(state.groups)) {
    const group = state.groups.find((g) => g.id === groupId);
    const task = group?.orchestrateBoard?.tasks.find((t) => t.id === taskId);
    const wt = task?.worktreePath?.trim();
    if (
      task &&
      wt &&
      normalizeComparablePath(wt) === normalizeComparablePath(resolvedCwd) &&
      typeof task.devPort === 'number' &&
      Number.isFinite(task.devPort)
    ) {
      const apiPort =
        typeof task.apiPort === 'number' && Number.isFinite(task.apiPort)
          ? task.apiPort
          : task.devPort + API_PORT_OFFSET;
      return buildBoardTaskSpawnEnv(task.devPort, apiPort);
    }
  }

  const byCwd = resolvePortsByWorktreeCwd(state, resolvedCwd);
  if (!byCwd) return undefined;
  return buildBoardTaskSpawnEnv(byCwd.devPort, byCwd.apiPort);
}

/**
 * Board-task port env for a command when cwd resolves to an isolated worktree.
 * @param {{ chatId?: string, cwd?: string }} params
 * @param {SessionState | null | undefined} [injectedState]
 * @returns {Promise<Record<string, string> | undefined>}
 */
export async function resolveBoardTaskSpawnEnvForCommand(
  { chatId, cwd },
  injectedState,
) {
  // Injected blob — keep in-memory path so existing unit tests stay green.
  let state = injectedState;
  if (!state) {
    // Hot path: point lookup + by-cwd variant over board_tasks indexes.
    if (!useJsonSessionsStore()) {
      const ports = resolveBoardTaskPorts({ chatId, cwd });
      if (!ports) return undefined;
      return buildBoardTaskSpawnEnv(ports.devPort, ports.apiPort);
    }
    // JSON rollback: whole-blob read from state.json.
    const raw = (await readConfigJson('sessions/state.json')) ?? {
      version: 5,
      chats: [],
    };
    try {
      state = validateSessionState(raw);
    } catch {
      return undefined;
    }
  }

  return resolveFromSessionBlob({ chatId, cwd }, state);
}
