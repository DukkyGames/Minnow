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
 * @param {string} chatId
 * @param {SessionState | null | undefined} [injectedState]
 * @returns {Promise<{ worktreeRoot: string | undefined; groupId: string | undefined }>}
 */
export async function resolveChatContext(chatId, injectedState) {
  const trimmedId = typeof chatId === 'string' ? chatId.trim() : '';
  if (!trimmedId) return { worktreeRoot: undefined, groupId: undefined };

  let raw = injectedState;
  if (raw == null) {
    if (!useJsonSessionsStore()) {
      return resolveChatWorktreeContext(trimmedId);
    }
    raw = (await readConfigJson('sessions/state.json')) ?? {
      version: 5,
      chats: [],
    };
  }

  return resolveFromSessionBlob(trimmedId, raw);
}

/**
 * @param {string} chatId
 * @param {SessionState | null | undefined} [injectedState]
 * @returns {Promise<string | undefined>}
 */
export async function resolveChatCwd(chatId, injectedState) {
  const { worktreeRoot } = await resolveChatContext(chatId, injectedState);
  return worktreeRoot;
}
