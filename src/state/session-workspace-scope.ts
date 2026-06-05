/**
 * Pure workspace-scoped session helpers (no sessions.ts / UI imports).
 * Used by sessions.ts and unit tests.
 */

import { PLACEHOLDER_CHAT_NAME } from '../constants';
import { DEFAULT_MODE_ID, normalizeModeId } from '../chat/modes/types';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { Chat, SessionState } from '../types';

/** Expert threads and legacy Expert Lab chats stay out of the main sidebar. */
export function isSidebarVisibleChat(chat: Chat): boolean {
  return chat.kind !== 'expert-lab' && chat.kind !== 'expert';
}

/** Sidebar / prune ordering: last committed message, else legacy `updatedAt`. */
export function getChatLastMessageAt(chat: Chat): number {
  const last = chat.lastMessageAt;
  if (typeof last === 'number' && Number.isFinite(last) && last > 0) return last;
  const updated = chat.updatedAt;
  return typeof updated === 'number' && Number.isFinite(updated) ? updated : 0;
}

/** Raw session JSON from disk or API (may be schema v1 or v2). */
export type RawSessionJson = {
  version?: number;
  activeId?: string | null;
  sidebarCollapsed?: boolean;
  chats?: unknown[];
  lastActiveChatIdByWorkspace?: Record<string, string>;
};

function ensureLastActiveMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === 'string' && typeof value === 'string' && value.trim()) {
      out[normalizeWorkspacePath(key)] = value.trim();
    }
  }
  return out;
}

/** Upgrade v1/v2 session JSON to canonical schema v3 in memory. */
export function migrateSessionStateV1ToV2(
  parsed: RawSessionJson,
  coerceChat: (raw: unknown) => Chat,
  seedEmptyChat: () => Chat,
): SessionState {
  const chats = Array.isArray(parsed.chats)
    ? parsed.chats.map((c) => coerceChat(c)).filter(Boolean)
    : [];
  const state: SessionState = {
    version: 5,
    activeId: typeof parsed.activeId === 'string' ? parsed.activeId : '',
    sidebarCollapsed: !!parsed.sidebarCollapsed,
    lastActiveChatIdByWorkspace: ensureLastActiveMap(parsed.lastActiveChatIdByWorkspace),
    chats: chats.length ? chats : [seedEmptyChat()],
  };
  if (!state.chats.some((c) => c.id === state.activeId)) {
    state.activeId = state.chats[0].id;
  }
  return state;
}

/** Chats for the given workspace (newest first); empty workspace key returns none. */
export function getChatsForWorkspace(workspacePath: string, state: SessionState): Chat[] {
  const key = normalizeWorkspacePath(workspacePath);
  if (!key) return [];
  return [...state.chats]
    .filter(
      (c) =>
        isSidebarVisibleChat(c) &&
        normalizeWorkspacePath(c.workspacePath ?? '') === key,
    )
    .sort((a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a));
}

/** Legacy or unscoped chats (`workspacePath === ''`), newest first. */
export function getUnassignedChats(state: SessionState): Chat[] {
  return [...state.chats]
    .filter(
      (c) =>
        isSidebarVisibleChat(c) &&
        normalizeWorkspacePath(c.workspacePath ?? '') === '',
    )
    .sort((a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a));
}

/**
 * Pick the active chat id for a workspace: remembered id, else newest scoped chat,
 * else create a new empty chat bound to that workspace.
 */
export function resolveActiveChatIdForWorkspace(
  workspacePath: string,
  state: SessionState,
  fallbackModelId: string,
  createScopedEmptyChat: (modelId: string, workspaceKey: string) => Chat,
): string {
  const key = normalizeWorkspacePath(workspacePath);
  const map = state.lastActiveChatIdByWorkspace ?? {};
  const remembered = map[key];
  if (remembered) {
    const chat = state.chats.find(
      (c) =>
        c.id === remembered &&
        isSidebarVisibleChat(c) &&
        normalizeWorkspacePath(c.workspacePath ?? '') === key,
    );
    if (chat) return chat.id;
  }

  const scoped = getChatsForWorkspace(key, state);
  if (scoped.length) return scoped[0].id;

  const fresh = createScopedEmptyChat(fallbackModelId, key);
  state.chats.unshift(fresh);
  const now = Date.now();
  fresh.updatedAt = now;
  fresh.lastMessageAt = now;
  return fresh.id;
}

/** Minimal chat coerce for migration unit tests (workspacePath only). */
export function coerceChatWorkspaceFields(raw: unknown): Chat {
  if (!raw || typeof raw !== 'object') {
    return {
      id: 'test-id',
      name: PLACEHOLDER_CHAT_NAME,
      workspacePath: '',
      modelId: '',
      modeId: DEFAULT_MODE_ID,
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: Date.now(),
    };
  }
  const row = raw as Partial<Chat>;
  return {
    id: typeof row.id === 'string' && row.id ? row.id : 'test-id',
    name:
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : PLACEHOLDER_CHAT_NAME,
    workspacePath:
      typeof row.workspacePath === 'string'
        ? normalizeWorkspacePath(row.workspacePath)
        : '',
    modelId: typeof row.modelId === 'string' ? row.modelId : '',
    modeId: normalizeModeId(row.modeId),
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
    lastMessageAt:
      typeof row.lastMessageAt === 'number'
        ? row.lastMessageAt
        : typeof row.updatedAt === 'number'
          ? row.updatedAt
          : Date.now(),
  };
}
