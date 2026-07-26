/**
 * Resolve the working directory for agent terminal runs from persisted session state.
 * Mirrors client {@link file://../../src/state/worktree-isolation.ts} resolveChatWorktreeRoot.
 *
 * Hot path (no injectedState): indexed SQLite lookup via resolveChatWorktreeContext.
 * Injected state keeps the in-memory validate+scan path for unit tests.
 */

import {
  resolveChatWorktreeContext,
  useJsonSessionsStore,
} from '../config/sessions-repo.js';
import { readConfigJson } from '../config/store.js';
import { validateSessionState } from '../config/validators.js';

/**
 * @typedef {import('../config/validators.js').SessionState} SessionState
 */

/**
 * Scan a validated SessionState for worktree root + board group id.
 * Used for injectedState tests and JSON-store rollback.
 * @param {string} trimmedId
 * @param {unknown} raw
 * @returns {{ worktreeRoot: string | undefined; groupId: string | undefined }}
 */
function resolveFromSessionBlob(trimmedId, raw) {
  let state;
  try {
    state = validateSessionState(raw);
  } catch {
    return { worktreeRoot: undefined, groupId: undefined };
  }

  const chat = state.chats.find((c) => c.id === trimmedId);
  if (!chat) return { worktreeRoot: undefined, groupId: undefined };

  const groupId = chat.boardGroupId?.trim() || undefined;

  const direct = chat.worktreeRoot?.trim();
  if (direct) return { worktreeRoot: direct, groupId };

  const taskId = chat.boardTaskId?.trim();
  const gId = chat.boardGroupId?.trim();
  if (!taskId || !gId || !Array.isArray(state.groups) || !state.groups.length) {
    return { worktreeRoot: undefined, groupId };
  }

  const group = state.groups.find((g) => g.id === gId);
  const task = group?.orchestrateBoard?.tasks.find((t) => t.id === taskId);
  return { worktreeRoot: task?.worktreePath?.trim() || undefined, groupId };
}

/**
 * Resolve both the worktree root and the board group id for a chat in one state read.
 * @param {string} chatId
 * @param {SessionState | null | undefined} [injectedState] Optional state for unit tests.
 * @returns {Promise<{ worktreeRoot: string | undefined; groupId: string | undefined }>}
 */
export async function resolveChatContext(chatId, injectedState) {
  const trimmedId = typeof chatId === 'string' ? chatId.trim() : '';
  if (!trimmedId) return { worktreeRoot: undefined, groupId: undefined };

  // Injected blob — keep in-memory path so existing unit tests stay green.
  let raw = injectedState;
  if (raw == null) {
    // Hot path: indexed chats + optional board_tasks.worktree_path lookup.
    if (!useJsonSessionsStore()) {
      return resolveChatWorktreeContext(trimmedId);
    }
    // JSON rollback: whole-blob read from state.json.
    raw = (await readConfigJson('sessions/state.json')) ?? {
      version: 5,
      chats: [],
    };
  }

  return resolveFromSessionBlob(trimmedId, raw);
}

/**
 * Resolve a chat's isolated worktree root from session state.
 * @param {string} chatId
 * @param {SessionState | null | undefined} [injectedState] Optional state for unit tests.
 * @returns {Promise<string | undefined>}
 */
export async function resolveChatCwd(chatId, injectedState) {
  const { worktreeRoot } = await resolveChatContext(chatId, injectedState);
  return worktreeRoot;
}
