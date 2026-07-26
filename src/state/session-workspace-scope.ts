/**
 * Pure workspace-scoped session helpers (no sessions.ts / UI imports).
 * Used by sessions.ts and unit tests.
 */

import { AUTO_TITLE_MAX_LEN, PLACEHOLDER_CHAT_NAME } from '../constants';
import { DEFAULT_MODE_ID, normalizeModeId } from '../chat/modes/types';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { Chat, SessionState } from '../types';

/** Legacy Expert Lab sessions stay out of the main sidebar; expert threads are listed normally. */
export function isSidebarVisibleChat(chat: Chat): boolean {
  return chat.kind !== 'expert-lab' && chat.appScope !== 'email';
}

/** True when the chat has unsent composer text persisted on the session row. */
export function hasComposerDraft(chat: Chat): boolean {
  return Boolean(chat.composerDraft?.trim());
}

/**
 * Whether a chat belongs in session rails (desktop / Code / Chat app).
 * Lazy-boot chats keep `history: []` until hydrate — use denormalized `messageCount`
 * so rails are not empty after restart.
 */
export function chatHasListableContent(chat: Chat): boolean {
  if (hasComposerDraft(chat)) return true;
  if (Array.isArray(chat.history) && chat.history.length > 0) return true;
  // C.2 summaries: unloaded rows still report server message count.
  if (chat.historyLoaded === false && (chat.messageCount ?? 0) > 0) return true;
  return false;
}

/** Empty chat with no committed history and no unsent draft (hidden from sidebar lists). */
export function isEphemeralEmptyChat(chat: Chat): boolean {
  return !chatHasListableContent(chat);
}

/**
 * Chats that belong in sidebar session rails: committed turns and/or an unsent draft.
 * Ephemeral empty chats stay out until the user types or sends.
 */
export function isSidebarListedChat(chat: Chat): boolean {
  return isSidebarVisibleChat(chat) && chatHasListableContent(chat);
}

/** Sidebar label for draft-only chats (first line of unsent text, capped). */
export function formatDraftChatSidebarName(chat: Chat): string {
  const draft = chat.composerDraft?.trim() ?? '';
  if (!draft) return 'Draft';
  const firstLine = draft.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const label = firstLine || 'Draft';
  if (label.length <= AUTO_TITLE_MAX_LEN) return label;
  return `${label.slice(0, AUTO_TITLE_MAX_LEN - 1)}…`;
}

/** Board planners and folder-linked chats stay even when still empty. */
function isProtectedFromEphemeralPrune(chat: Chat, state: SessionState): boolean {
  if (chat.boardGroupId?.trim() || chat.boardTaskId?.trim()) return true;
  for (const group of state.groups ?? []) {
    if (group.plannerChatId?.trim() === chat.id) return true;
  }
  return false;
}

/** Drop unused ephemeral rows while keeping the active chat and sidebar-listed chats. */
export function pruneEphemeralEmptyChats(state: SessionState, keepChatId: string): void {
  state.chats = state.chats.filter(
    (chat) =>
      chat.id === keepChatId ||
      isProtectedFromEphemeralPrune(chat, state) ||
      !isEphemeralEmptyChat(chat),
  );
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

/** MinnowOS desktop chat id stored in `lastActiveChatIdByApp` (separate from legacy Chat app). */
export const DESKTOP_APP_ID = 'desktop';

/** MinnowOS Email assistant id stored in `lastActiveChatIdByApp`. */
export const EMAIL_APP_ID = 'email';

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
    version: 6,
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

/** Sidebar session rows for a workspace (excludes ephemeral empty chats). */
export function getSidebarListedChatsForWorkspace(
  workspacePath: string,
  state: SessionState,
): Chat[] {
  return getChatsForWorkspace(workspacePath, state).filter(isSidebarListedChat);
}

/** True when the chat belongs to the MinnowOS Chat app (chats workspace sandbox). */
export function isAssistantChat(chat: Chat, chatsWorkspacePath: string): boolean {
  const key = normalizeWorkspacePath(chatsWorkspacePath);
  if (!key) return false;
  return chat.appScope == null && normalizeWorkspacePath(chat.workspacePath ?? '') === key;
}

/** Chats bound to the chats workspace (newest first). */
export function getChatsForChatsWorkspace(
  state: SessionState,
  chatsWorkspacePath: string,
): Chat[] {
  const key = normalizeWorkspacePath(chatsWorkspacePath);
  if (!key) return [];
  return [...state.chats]
    .filter(
      (c) =>
        c.appScope == null &&
        normalizeWorkspacePath(c.workspacePath ?? '') === key,
    )
    .sort((a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a));
}

/** Sidebar session rows for the chats workspace (excludes ephemeral empty chats). */
export function getSidebarListedAssistantChats(
  state: SessionState,
  chatsWorkspacePath: string,
): Chat[] {
  return getChatsForChatsWorkspace(state, chatsWorkspacePath).filter(isSidebarListedChat);
}

/** Sidebar-visible assistant chats for the chats workspace (newest first). */
export function getAssistantChats(state: SessionState, chatsWorkspacePath: string): Chat[] {
  return getSidebarListedAssistantChats(state, chatsWorkspacePath);
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

/** New Email assistant chat defaults for the chats workspace sandbox. */
export function createEmailAssistantChat(
  chatsWorkspacePath: string,
  chatId: string,
  modelId = '',
): Chat {
  const now = Date.now();
  return {
    id: chatId,
    name: PLACEHOLDER_CHAT_NAME,
    appScope: 'email',
    workspacePath: normalizeWorkspacePath(chatsWorkspacePath),
    modelId: modelId || '',
    modeId: 'email',
    workAgentAuto: true,
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: now,
    lastMessageAt: now,
  };
}

/** True when a chat belongs to the Email app and its workspace sandbox. */
export function isEmailAssistantChat(chat: Chat, chatsWorkspacePath: string): boolean {
  const key = normalizeWorkspacePath(chatsWorkspacePath);
  if (!key) return false;
  return (
    chat.appScope === 'email' &&
    normalizeWorkspacePath(chat.workspacePath ?? '') === key
  );
}

/** All Email-scoped chats in activity order, including the active empty chat. */
export function getEmailAssistantChats(
  state: SessionState,
  chatsWorkspacePath: string,
): Chat[] {
  return [...state.chats]
    .filter((chat) => isEmailAssistantChat(chat, chatsWorkspacePath))
    .sort((a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a));
}

/** Email history rows with committed turns or a persisted composer draft. */
export function getListedEmailAssistantChats(
  state: SessionState,
  chatsWorkspacePath: string,
): Chat[] {
  return getEmailAssistantChats(state, chatsWorkspacePath).filter(chatHasListableContent);
}

/** Restore the remembered Email chat, else the newest scoped chat, else create one. */
export function resolveActiveEmailAssistantChatId(
  chatsWorkspacePath: string,
  state: SessionState,
  createScopedEmailChat: (chatsWorkspacePath: string) => Chat,
): string {
  const key = normalizeWorkspacePath(chatsWorkspacePath);
  const remembered = getLastActiveChatIdForApp(state, EMAIL_APP_ID);
  if (remembered) {
    const chat = state.chats.find(
      (candidate) =>
        candidate.id === remembered && isEmailAssistantChat(candidate, key),
    );
    if (chat) return chat.id;
  }

  const scoped = getEmailAssistantChats(state, key);
  if (scoped.length) return scoped[0]!.id;

  const fresh = createScopedEmailChat(key);
  state.chats.unshift(fresh);
  return fresh.id;
}

/**
 * Pick the active assistant chat: remembered app id, else newest assistant chat,
 * else create a new assistant chat bound to the chats workspace.
 */
export function resolveActiveAssistantChatId(
  chatsWorkspacePath: string,
  state: SessionState,
  createScopedAssistantChat: (chatsWorkspacePath: string) => Chat,
  appId: string = CHAT_APP_ID,
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

  const remembered = getLastActiveChatIdForApp(state, appId);
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
        isSidebarListedChat(c) &&
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

  const scoped = getSidebarListedChatsForWorkspace(key, state);
  if (scoped.length) return scoped[0]!.id;

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
    ...(row.appScope === 'email' ? { appScope: 'email' as const } : {}),
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
