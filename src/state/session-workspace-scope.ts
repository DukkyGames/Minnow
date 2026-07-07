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

/** MinnowOS Chat app id stored in `lastActiveChatIdByApp`. */
export const CHAT_APP_ID = 'chat';

/** Raw session JSON from disk or API (may be schema v1 or v2). */
export type RawSessionJson = {
  version?: number;
  activeId?: string | null;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  chats?: unknown[];
  lastActiveChatIdByWorkspace?: Record<string, string>;
  lastActiveChatIdByApp?: Record<string, string>;
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

function ensureLastActiveAppMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === 'string' && key.trim() && typeof value === 'string' && value.trim()) {
      out[key.trim()] = value.trim();
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
    lastActiveChatIdByApp: ensureLastActiveAppMap(parsed.lastActiveChatIdByApp),
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

/** True when the chat belongs to the MinnowOS Chat app (chats workspace sandbox). */
export function isAssistantChat(chat: Chat, chatsWorkspacePath: string): boolean {
  const key = normalizeWorkspacePath(chatsWorkspacePath);
  if (!key) return false;
  return normalizeWorkspacePath(chat.workspacePath ?? '') === key;
}

/** Chats bound to the chats workspace (newest first). */
export function getChatsForChatsWorkspace(
  state: SessionState,
  chatsWorkspacePath: string,
): Chat[] {
  const key = normalizeWorkspacePath(chatsWorkspacePath);
  if (!key) return [];
  return [...state.chats]
    .filter((c) => normalizeWorkspacePath(c.workspacePath ?? '') === key)
    .sort((a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a));
}

/** Sidebar-visible assistant chats for the chats workspace (newest first). */
export function getAssistantChats(state: SessionState, chatsWorkspacePath: string): Chat[] {
  return getChatsForChatsWorkspace(state, chatsWorkspacePath).filter(isSidebarVisibleChat);
}

/** Remember the last active chat for a MinnowOS app (e.g. Chat). */
export function rememberActiveChatForApp(
  state: SessionState,
  appId: string,
  chatId: string,
): void {
  const id = appId.trim();
  const chat = chatId.trim();
  if (!id || !chat) return;
  if (!state.lastActiveChatIdByApp) {
    state.lastActiveChatIdByApp = {};
  }
  state.lastActiveChatIdByApp[id] = chat;
}

/** Read the remembered active chat id for a MinnowOS app. */
export function getLastActiveChatIdForApp(state: SessionState, appId: string): string | undefined {
  const id = appId.trim();
  if (!id) return undefined;
  return state.lastActiveChatIdByApp?.[id];
}

/** New assistant chat defaults for the Chat app (general mode, chats workspace). */
export function createAssistantChat(
  chatsWorkspacePath: string,
  chatId: string,
  modelId = '',
): Chat {
  const now = Date.now();
  return {
    id: chatId,
    name: PLACEHOLDER_CHAT_NAME,
    workspacePath: normalizeWorkspacePath(chatsWorkspacePath),
    modelId: modelId || '',
    modeId: 'general',
    workAgentAuto: true,
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: now,
    lastMessageAt: now,
  };
}

/** New desktop chat defaults (desktop mode, desktop workspace sandbox). */
export function createDesktopChat(
  desktopWorkspacePath: string,
  chatId: string,
  modelId = '',
): Chat {
  const now = Date.now();
  return {
    id: chatId,
    name: PLACEHOLDER_CHAT_NAME,
    workspacePath: normalizeWorkspacePath(desktopWorkspacePath),
    modelId: modelId || '',
    modeId: 'desktop',
    workAgentAuto: true,
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: now,
    lastMessageAt: now,
  };
}

/**
 * Pick the active assistant chat: remembered app id, else newest assistant chat,
 * else create a new assistant chat bound to the chats workspace.
 */
export function resolveActiveAssistantChatId(
  chatsWorkspacePath: string,
  state: SessionState,
  createScopedAssistantChat: (chatsWorkspacePath: string) => Chat,
): string {
  const key = normalizeWorkspacePath(chatsWorkspacePath);
  if (!key) {
    const fresh = createScopedAssistantChat('');
    state.chats.unshift(fresh);
    const now = Date.now();
    fresh.updatedAt = now;
    fresh.lastMessageAt = now;
    return fresh.id;
  }

  const remembered = getLastActiveChatIdForApp(state, CHAT_APP_ID);
  if (remembered) {
    const chat = state.chats.find(
      (c) => c.id === remembered && isAssistantChat(c, key),
    );
    if (chat) return chat.id;
  }

  const scoped = getAssistantChats(state, key);
  if (scoped.length) return scoped[0].id;

  const fresh = createScopedAssistantChat(key);
  state.chats.unshift(fresh);
  const now = Date.now();
  fresh.updatedAt = now;
  fresh.lastMessageAt = now;
  return fresh.id;
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
