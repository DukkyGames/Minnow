import { MAX_CHATS, PLACEHOLDER_CHAT_NAME, SAVE_DEBOUNCE_MS, STORAGE_KEY } from '../constants';
import { abortChatTitleGeneration } from '../chat/titles/inflight';
import { setSaveTimer, saveTimer } from '../app-state';
import { getSessions, putSessions } from '../config/api-client';
import { defaultSessionState } from '../config/defaults';
import { isServerStorageMode } from '../config/storage-mode';
import { DEFAULT_MODE_ID, normalizeModeId } from '../chat/modes/types';
import { setStatus } from '../ui/status';
import type {
  AssistantMessage,
  AssistantToolCallMessage,
  Chat,
  ExpertSelection,
  Message,
  SessionState,
  TerminalRunRecord,
  ToolCall,
  ToolResultMessage,
} from '../types';

/** Default expert picker when missing on older chats. */
export function defaultExpertSelection(): ExpertSelection {
  return { mode: 'auto', expertId: null };
}

function ensureExpertSelection(raw: unknown): ExpertSelection {
  if (!raw || typeof raw !== 'object') return defaultExpertSelection();
  const row = raw as Partial<ExpertSelection>;
  const mode = row.mode === 'manual' ? 'manual' : 'auto';
  const expertId =
    mode === 'manual' && typeof row.expertId === 'string' && row.expertId.trim()
      ? row.expertId.trim()
      : null;
  return { mode, expertId };
}

/** In-memory session blob mirrored to ~/.speedchat or localStorage fallback. */
export let sessionState: SessionState | null = null;

/** Replace in-memory session blob (unit tests). */
export function setSessionStateForTests(state: SessionState | null): void {
  sessionState = state;
}

export type SaveSessionsResult = 'ok' | 'quota_exceeded';

export interface RemoveChatResult {
  ok: boolean;
  removed?: Chat;
  /** True when the main column should reload the active chat. */
  activeChanged: boolean;
  activeChat: Chat;
}

function requireSessionState(): SessionState {
  if (!sessionState) {
    throw new Error('sessionState is not initialized; call loadSessionsFromStorage() first');
  }
  return sessionState;
}

export function newChatId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function createEmptyChatObject(modelId: string): Chat {
  return {
    id: newChatId(),
    name: PLACEHOLDER_CHAT_NAME,
    modelId: modelId || '',
    modeId: DEFAULT_MODE_ID,
    workAgentId: null,
    workAgentAuto: true,
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: Date.now(),
  };
}

function ensureToolCall(raw: unknown): ToolCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const fn = row.function;
  if (!id || !fn || typeof fn !== 'object') return null;
  const func = fn as Record<string, unknown>;
  const name = typeof func.name === 'string' ? func.name : '';
  if (!name) return null;
  const args = typeof func.arguments === 'string' ? func.arguments : '';
  return { id, type: 'function', function: { name, arguments: args } };
}

function ensureToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(ensureToolCall).filter((tc): tc is ToolCall => Boolean(tc));
}

function ensureMessageEntry(m: Partial<Message> | null | undefined): Message | null {
  if (!m || !m.role) return null;

  if (m.role === 'tool') {
    const toolMsg = m as Partial<ToolResultMessage>;
    const toolCallId =
      typeof toolMsg.tool_call_id === 'string' ? toolMsg.tool_call_id.trim() : '';
    if (!toolCallId) return null;
    const content = toolMsg.content != null ? String(toolMsg.content) : '';
    return { role: 'tool', tool_call_id: toolCallId, content };
  }

  if (m.role === 'user') {
    const content = m.content != null ? String(m.content) : '';
    return { role: 'user', content };
  }

  if (m.role !== 'assistant') return null;

  const toolCalls = ensureToolCalls((m as Partial<AssistantToolCallMessage>).tool_calls);
  if (toolCalls.length) {
    const withTools: AssistantToolCallMessage = {
      role: 'assistant',
      content: m.content == null ? null : String(m.content),
      tool_calls: toolCalls,
    };
    if (m.stats && typeof m.stats === 'object') withTools.stats = m.stats;
    if (m.usage && typeof m.usage === 'object') withTools.usage = m.usage;
    return withTools;
  }

  const assistant: AssistantMessage = {
    role: 'assistant',
    content: m.content != null ? String(m.content) : '',
  };
  if (m.stats && typeof m.stats === 'object') assistant.stats = m.stats;
  if (m.usage && typeof m.usage === 'object') assistant.usage = m.usage;
  return assistant;
}

function ensureTerminalHistory(raw: unknown): TerminalRunRecord[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const row = r as Partial<TerminalRunRecord>;
      if (typeof row.id !== 'string' || typeof row.command !== 'string') return null;
      return {
        id: row.id,
        command: row.command,
        cwd: typeof row.cwd === 'string' ? row.cwd : '.',
        source: row.source === 'user' ? 'user' : 'agent',
        ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
        startedAt: typeof row.startedAt === 'number' ? row.startedAt : 0,
        finishedAt: typeof row.finishedAt === 'number' ? row.finishedAt : 0,
        exitCode: typeof row.exitCode === 'number' ? row.exitCode : null,
        timedOut: row.timedOut === true,
        logPath: typeof row.logPath === 'string' ? row.logPath : '',
      } satisfies TerminalRunRecord;
    })
    .filter((x): x is TerminalRunRecord => Boolean(x));
  return rows.length ? rows : undefined;
}

export function ensureChatShape(raw: Partial<Chat> | null | undefined): Chat {
  if (!raw || typeof raw !== 'object') return createEmptyChatObject('');
  const history = Array.isArray(raw.history)
    ? raw.history.map(ensureMessageEntry).filter((x): x is Message => Boolean(x))
    : [];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newChatId(),
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : PLACEHOLDER_CHAT_NAME,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : '',
    modeId: normalizeModeId(raw.modeId),
    expertSelection: ensureExpertSelection(raw.expertSelection),
    lastResolvedExpertId:
      typeof raw.lastResolvedExpertId === 'string' ? raw.lastResolvedExpertId : null,
    workAgentId:
      typeof raw.workAgentId === 'string' && raw.workAgentId.trim()
        ? raw.workAgentId.trim()
        : null,
    workAgentAuto: raw.workAgentAuto !== false,
    terminalHistory: ensureTerminalHistory(raw.terminalHistory),
    history,
    lastStats: raw.lastStats && typeof raw.lastStats === 'object' ? raw.lastStats : null,
    modelInfo: raw.modelInfo && typeof raw.modelInfo === 'object' ? raw.modelInfo : {},
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

/** Read expert selection for a chat (defaults to Auto). */
export function getExpertSelection(chat: Chat): ExpertSelection {
  return chat.expertSelection ?? defaultExpertSelection();
}

function parseSessionStateFromJson(parsed: Partial<SessionState> | null): SessionState {
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.chats)) {
    return defaultSessionState();
  }
  const chats = parsed.chats.map(ensureChatShape).filter(Boolean);
  const state: SessionState = {
    version: 1,
    activeId: typeof parsed.activeId === 'string' ? parsed.activeId : '',
    sidebarCollapsed: !!parsed.sidebarCollapsed,
    chats: chats.length ? chats : [createEmptyChatObject('')],
  };
  if (!state.chats.some((c) => c.id === state.activeId)) {
    state.activeId = state.chats[0].id;
  }
  return state;
}

/** Load sessions from API or localStorage (after detectConfigServer). */
export async function loadSessionsFromStorage(): Promise<void> {
  if (isServerStorageMode()) {
    try {
      const remote = await getSessions();
      sessionState = parseSessionStateFromJson(remote);
      return;
    } catch {
      setStatus('err', 'Could not load sessions from ~/.speedchat');
    }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      sessionState = defaultSessionState();
      return;
    }
    sessionState = parseSessionStateFromJson(JSON.parse(raw) as Partial<SessionState>);
  } catch {
    sessionState = defaultSessionState();
  }
}

export function findChatById(chatId: string): Chat | undefined {
  return requireSessionState().chats.find((c) => c.id === chatId);
}

/** Chats ordered newest-first for sidebar display. */
export function getChatsSortedByUpdatedDesc(): Chat[] {
  return [...requireSessionState().chats].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getActiveChat(): Chat {
  const state = requireSessionState();
  const c = state.chats.find((x) => x.id === state.activeId);
  return c || state.chats[0];
}

export function touchChat(chat: Chat): void {
  chat.updatedAt = Date.now();
}

function trimChatsIfNeeded(): void {
  const state = sessionState;
  if (!state || state.chats.length <= MAX_CHATS) return;
  const activeId = state.activeId;
  const sortedOldestFirst = [...state.chats].sort((a, b) => a.updatedAt - b.updatedAt);
  let toDrop = state.chats.length - MAX_CHATS;
  for (const c of sortedOldestFirst) {
    if (toDrop <= 0) break;
    if (c.id === activeId) continue;
    state.chats = state.chats.filter((x) => x.id !== c.id);
    toDrop -= 1;
  }
}

export function saveSessionsNow(): SaveSessionsResult {
  trimChatsIfNeeded();
  if (!sessionState) return 'ok';

  if (isServerStorageMode()) {
    void putSessions(sessionState).catch(() => {
      setStatus('err', 'Could not save sessions to ~/.speedchat');
    });
    return 'ok';
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));
    return 'ok';
  } catch (e) {
    const err = e as { name?: string };
    if (err && err.name === 'QuotaExceededError') {
      return 'quota_exceeded';
    }
    return 'ok';
  }
}

export function scheduleSaveSessions(): void {
  if (saveTimer) clearTimeout(saveTimer);
  setSaveTimer(
    setTimeout(() => {
      setSaveTimer(null);
      saveSessionsNow();
    }, SAVE_DEBOUNCE_MS)
  );
}

/** Create a chat, make it active, and persist (debounced). */
export function createAndActivateChat(modelId: string): Chat {
  const state = requireSessionState();
  const chat = createEmptyChatObject(modelId);
  state.chats.unshift(chat);
  state.activeId = chat.id;
  touchChat(chat);
  scheduleSaveSessions();
  return chat;
}

/**
 * Switch active chat by id. Returns the chat when switched, or null if id is missing / already active.
 */
export function switchActiveChat(id: string): Chat | null {
  const state = requireSessionState();
  if (id === state.activeId) return null;
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return null;
  state.activeId = id;
  scheduleSaveSessions();
  return chat;
}

/** Update display title after rename UI commits. */
export function renameChatTitle(chatId: string, name: string): boolean {
  const chat = findChatById(chatId);
  if (!chat) return false;
  const trimmed = name.trim();
  if (trimmed) chat.name = trimmed;
  touchChat(chat);
  scheduleSaveSessions();
  return true;
}

/** Sync model id on the active chat (e.g. when the top-bar model select changes). */
export function setActiveChatModelId(modelId: string): void {
  const chat = getActiveChat();
  chat.modelId = modelId || '';
  touchChat(chat);
  scheduleSaveSessions();
}

export function toggleSidebarCollapsedState(): boolean {
  const state = requireSessionState();
  state.sidebarCollapsed = !state.sidebarCollapsed;
  scheduleSaveSessions();
  return state.sidebarCollapsed;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  const state = requireSessionState();
  state.sidebarCollapsed = collapsed;
  scheduleSaveSessions();
}

/**
 * Remove a chat by id. If the list becomes empty, inserts a new empty chat using fallbackModelId.
 * Does not show confirm dialogs — callers in UI handle that.
 */
export function removeChatById(chatId: string, fallbackModelId: string): RemoveChatResult {
  const state = requireSessionState();
  const idx = state.chats.findIndex((c) => c.id === chatId);
  if (idx < 0) {
    return { ok: false, activeChanged: false, activeChat: getActiveChat() };
  }

  const victim = state.chats[idx];
  abortChatTitleGeneration(chatId);
  const wasActive = state.activeId === chatId;
  state.chats.splice(idx, 1);

  let activeChanged = wasActive;
  if (state.chats.length === 0) {
    const fresh = createEmptyChatObject(fallbackModelId);
    state.chats.push(fresh);
    state.activeId = fresh.id;
    touchChat(fresh);
    activeChanged = true;
  } else if (wasActive) {
    state.activeId = [...state.chats].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    activeChanged = true;
  }

  scheduleSaveSessions();
  return {
    ok: true,
    removed: victim,
    activeChanged,
    activeChat: getActiveChat(),
  };
}

/**
 * Apply a model-generated title when the chat still uses the placeholder name.
 * Returns false if the chat is missing or was renamed.
 */
export function applyGeneratedChatTitle(chatId: string, title: string): boolean {
  const chat = findChatById(chatId);
  if (!chat || chat.name !== PLACEHOLDER_CHAT_NAME) return false;
  const trimmed = title.trim();
  if (!trimmed) return false;
  chat.name = trimmed;
  return true;
}
