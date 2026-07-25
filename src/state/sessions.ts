import { PLACEHOLDER_CHAT_NAME, SAVE_DEBOUNCE_MS, STORAGE_KEY } from '../constants';
import { abortChatTitleGeneration } from '../chat/titles/inflight';
import { cleanupChatWorktreeOnDelete } from './chat-worktree';
import { isPlaceholderChatName } from '../chat/titles/placeholder';
import { setSaveTimer, saveTimer } from '../app-state';
import { getSessions, putSessions, putSessionsKeepalive } from '../config/api-client';
import { defaultSessionState } from '../config/defaults';
import { randomUUID } from '../lib/random-id.ts';
import { isServerStorageMode } from '../config/storage-mode';
import { DEFAULT_MODE_ID, normalizeModeId } from '../chat/modes/types';
import { normalizeOrchestratePlanPath } from '../chat/orchestrate/plan-path';
import { syncOrchestratorPlannerChatTitle } from '../chat/orchestrate/planner-chat-title';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import { notifySessionCreated } from '../webhooks/client';
import { decodeModelSelectKey } from '../lib/model-select-key';
import {
  CHAT_APP_ID,
  DESKTOP_APP_ID,
  EMAIL_APP_ID,
  createAssistantChat,
  createDesktopChat,
  createEmailAssistantChat,
  getAssistantChats as filterAssistantChats,
  getChatsForChatsWorkspace as filterChatsForChatsWorkspace,
  getEmailAssistantChats as filterEmailAssistantChats,
  getListedEmailAssistantChats as filterListedEmailAssistantChats,
  getChatLastMessageAt,
  getChatsForWorkspace as filterChatsForWorkspace,
  getSidebarListedChatsForWorkspace as filterSidebarListedChatsForWorkspace,
  getLastActiveChatIdForApp,
  getUnassignedChats as filterUnassignedChats,
  isEphemeralEmptyChat,
  isSidebarListedChat,
  pruneEphemeralEmptyChats,
  formatDraftChatSidebarName,
  migrateSessionStateV1ToV2 as migrateSessionJsonToV2,
  rememberActiveChatForApp as rememberActiveChatForAppInState,
  resolveActiveAssistantChatId,
  resolveActiveEmailAssistantChatId,
  resolveActiveChatIdForWorkspace as pickActiveChatIdForWorkspace,
  type RawSessionJson,
} from './session-workspace-scope';
import { getForegroundAppId } from '../os/instances';
import { isChatAppForeground, shouldPaintDesktopChatSurface } from '../ui/chat-mount';
import { setStatus } from '../ui/status';
import { ensureTokenLedger } from '../usage/token-ledger';
import { getWorkspacePath } from './workspace';
import { MAX_GOAL_CONDITION_CHARS } from '../chat/goal/parse-command';
import {
  INITIAL_LOOP_AUTO_DELAY_MS,
  MAX_LOOP_PROMPT_CHARS,
  MIN_LOOP_INTERVAL_MS,
} from '../chat/loop/parse-command';
import { resolveActiveWorkAgent } from '../agents/resolve-work-agent';
import { cleanupChatArchiveOnDelete } from '../chat/archive/cleanup';
import { resolveChatWorktreeRoot } from './worktree-isolation';
import {
  ensureChatCodeChangeBackfillOnSwitch,
  runSessionCodeChangeBackfill,
} from '../usage/code-change-backfill';
import type { ExpertChatSeed } from '../chat/experts/runtime-profile';
import {
  normalizeChatRow,
  normalizeGroupRow,
} from './session-schema.mjs';
const GENERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Normalize persisted backend generation id (invalid values are dropped). */
function ensureCurrentGenerationId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim();
  return GENERATION_ID_RE.test(id) ? id : undefined;
}

/**
 * Drop generation ids that cannot still be in-flight (finished assistant already saved).
 */
export function clearStaleGenerationIdsOnLoad(chats: Chat[]): void {
  for (const chat of chats) {
    const id = ensureCurrentGenerationId(chat.currentGenerationId);
    if (!id) {
      if (chat.currentGenerationId != null) {
        delete chat.currentGenerationId;
      }
      continue;
    }
    chat.currentGenerationId = id;
    const last = chat.history[chat.history.length - 1];
    if (last?.role === 'assistant') {
      const text = typeof last.content === 'string' ? last.content.trim() : '';
      if (text.length > 0) {
        delete chat.currentGenerationId;
      }
    }
  }
}
import type {
  ActiveGoalState,
  ActiveLoopState,
  Chat,
  ChatGroup,
  ChatTodo,
  ExpertSelection,
  SessionState,
} from '../types';

const MAX_CHAT_TODO_ITEMS = 20;
const MAX_CHAT_TODO_TEXT_CHARS = 140;

function normalizeChatTodoStatus(raw: unknown): ChatTodo['status'] {
  if (raw === 'completed' || raw === 'in_progress' || raw === 'pending') return raw;
  return 'pending';
}


/** In-memory session blob mirrored to ~/.minnow or localStorage fallback. */
export let sessionState: SessionState | null = null;

/**
 * Set after a successful GET from ~/.minnow. Blocks PUT until hydration so a boot-time
 * localStorage fallback cannot clobber on-disk sessions (MIN-408).
 */
let sessionsHydratedFromServer = false;

/** Dirty chat ids since last flush (telemetry for B.2 PATCH; B.1 still PUTs whole blob). */
const dirtyChatIds = new Set<string>();
/** Explicit chat deletes since last flush. */
const deletedChatIds = new Set<string>();
/** Dirty sidebar/board group ids since last flush. */
const dirtyGroupIds = new Set<string>();
/** Session scalars (activeId, sidebar, maps, …) changed since last flush. */
let sessionScalarsDirty = false;
/**
 * Shadow JSON of chats after last load/flush — used by the B.1 dev verifier to
 * catch mutations that bypassed {@link touchChat}.
 */
let dirtyTrackingShadowChatsJson: string | null = null;
/** When true, flush runs the unmarked-mutation verifier (tests / Vite DEV). */
let dirtyTrackingVerifierForced = false;

function isDirtyTrackingVerifierEnabled(): boolean {
  if (dirtyTrackingVerifierForced) return true;
  try {
    // Vite sets import.meta.env.DEV; Node/tsx tests leave it undefined.
    return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

function captureDirtyTrackingShadow(state: SessionState | null): void {
  dirtyTrackingShadowChatsJson = state ? JSON.stringify(state.chats) : null;
}

function clearSessionDirtySets(): void {
  dirtyChatIds.clear();
  deletedChatIds.clear();
  dirtyGroupIds.clear();
  sessionScalarsDirty = false;
}

/** Mark session-level scalars dirty for upcoming PATCH telemetry. */
export function markSessionScalarsDirty(): void {
  sessionScalarsDirty = true;
}

/** Mark a sidebar/board group dirty for upcoming PATCH telemetry. */
export function markGroupDirty(groupId: string): void {
  const id = typeof groupId === 'string' ? groupId.trim() : '';
  if (id) dirtyGroupIds.add(id);
}

/**
 * Dev/test verifier: warn when a chat stringified differently without touchChat.
 * Still does not change the PUT payload (whole blob).
 */
function verifyDirtyChatTracking(state: SessionState): void {
  if (!isDirtyTrackingVerifierEnabled()) return;
  if (dirtyTrackingShadowChatsJson == null) return;
  let shadow: unknown;
  try {
    shadow = JSON.parse(dirtyTrackingShadowChatsJson);
  } catch {
    return;
  }
  if (!Array.isArray(shadow)) return;
  const shadowById = new Map(
    shadow
      .filter((c) => c && typeof c === 'object' && typeof (c as Chat).id === 'string')
      .map((c) => [(c as Chat).id, JSON.stringify(c)]),
  );
  for (const chat of state.chats) {
    const prev = shadowById.get(chat.id);
    if (prev === undefined) continue; // new chats are marked via touchChat on create
    const next = JSON.stringify(chat);
    if (prev !== next && !dirtyChatIds.has(chat.id)) {
      console.warn(
        `[sessions dirty-tracking] chat ${chat.id} changed without touchChat()`,
      );
    }
  }
}

/** Test helper: dirty set snapshot (B.1 still PUTs the full blob). */
export function getSessionDirtyTrackingForTests(): {
  dirtyChatIds: string[];
  deletedChatIds: string[];
  dirtyGroupIds: string[];
  sessionScalarsDirty: boolean;
} {
  return {
    dirtyChatIds: [...dirtyChatIds].sort(),
    deletedChatIds: [...deletedChatIds].sort(),
    dirtyGroupIds: [...dirtyGroupIds].sort(),
    sessionScalarsDirty,
  };
}

/** Test helper: force verifier on/off regardless of import.meta.env.DEV. */
export function setDirtyTrackingVerifierForcedForTests(forced: boolean): void {
  dirtyTrackingVerifierForced = forced;
}

/** Test helper: re-capture shadow without flushing. */
export function captureDirtyTrackingShadowForTests(): void {
  captureDirtyTrackingShadow(sessionState);
}


let sessionPersistenceShutdownRegistered = false;

/** Resolves once `loadSessionsFromStorage()` has populated `sessionState`. */
let resolveSessionsReady: () => void = () => undefined;
export const sessionsReady: Promise<void> = new Promise((resolve) => {
  resolveSessionsReady = resolve;
});

/** No-op when sessions are already loaded; otherwise waits for boot `initApp`. */
export async function ensureSessionsReady(): Promise<void> {
  if (sessionState) return;
  await sessionsReady;
}

function markSessionsReady(): void {
  resolveSessionsReady();
}

/** Replace in-memory session blob (unit tests). */
export function setSessionStateForTests(state: SessionState | null): void {
  sessionState = state;
  clearSessionDirtySets();
  captureDirtyTrackingShadow(state);
  if (state) {
    markSessionsReady();
    sessionsHydratedFromServer = true;
  } else {
    sessionsHydratedFromServer = false;
  }
}

/** Reset persistence guards between unit tests. */
export function resetSessionPersistenceForTests(): void {
  sessionsHydratedFromServer = false;
  sessionPersistenceShutdownRegistered = false;
  clearSessionDirtySets();
  dirtyTrackingShadowChatsJson = null;
  dirtyTrackingVerifierForced = false;
  // Clear debounce timer so Node test runners can exit.
  if (saveTimer) {
    clearTimeout(saveTimer);
    setSaveTimer(null);
  }
}

/** Expose hydration guard for persistence unit tests. */
export function isSessionsHydratedFromServerForTests(): boolean {
  return sessionsHydratedFromServer;
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
  return randomUUID();
}

export function createEmptyChatObject(modelId: string, workspacePath?: string): Chat {
  const boundWorkspace =
    workspacePath !== undefined
      ? normalizeWorkspacePath(workspacePath)
      : normalizeWorkspacePath(getWorkspacePath());
  return {
    id: newChatId(),
    name: PLACEHOLDER_CHAT_NAME,
    workspacePath: boundWorkspace,
    modelId: modelId || '',
    modeId: DEFAULT_MODE_ID,
    workAgentId: null,
    workAgentAuto: true,
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: Date.now(),
    lastMessageAt: Date.now(),
  };
}


function ensureGroupsFromRaw(raw: unknown): ChatGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatGroup[] = [];
  for (const item of raw) {
    const group = normalizeGroupRow(item) as ChatGroup | null;
    if (group) out.push(group);
  }
  return out;
}

/** Test helper: hydrate sidebar groups from persisted session JSON. */
export function hydrateSessionGroupsForTests(raw: unknown): ChatGroup[] {
  return ensureGroupsFromRaw(raw);
}

/** Move legacy chat-owned boards onto sidebar folders (schema v4 → v5). */
export function migrateSessionV4ToV5(state: SessionState): void {
  if (!state.groups) state.groups = [];

  for (const chat of state.chats) {
    const legacyBoard = chat.orchestrateBoard;
    if (!legacyBoard) continue;

    const legacyGroupId =
      typeof (legacyBoard as { groupId?: string }).groupId === 'string'
        ? (legacyBoard as { groupId?: string }).groupId!.trim()
        : '';
    let group = legacyGroupId
      ? state.groups.find((g) => g.id === legacyGroupId)
      : undefined;

    if (!group) {
      const planLabel =
        chat.orchestratePlanPath?.split('/').pop()?.replace(/\.md$/i, '') ||
        legacyBoard.planPath.split('/').pop()?.replace(/\.md$/i, '') ||
        'Orchestrate';
      const ws = normalizeWorkspacePath(chat.workspacePath);
      const siblings = state.groups.filter(
        (g) => normalizeWorkspacePath(g.workspacePath) === ws,
      );
      group = {
        id: `grp_${newChatId().slice(5)}`,
        name: planLabel,
        workspacePath: ws,
        collapsed: false,
        order: siblings.length,
        createdAt: Date.now(),
      };
      state.groups.push(group);
    }

    const boardCopy = { ...legacyBoard };
    delete (boardCopy as { groupId?: string }).groupId;
    group.orchestrateBoard = boardCopy;
    group.orchestratePlanPath =
      chat.orchestratePlanPath ?? group.orchestratePlanPath ?? legacyBoard.planPath;
    group.plannerChatId = chat.id;
    if (chat.viewMode === 'board') {
      group.viewMode = 'board';
      state.activeBoardGroupId = group.id;
    }

    chat.boardGroupId = group.id;
    chat.groupId = group.id;

    for (const task of legacyBoard.tasks) {
      const taskChatId = task.chatId?.trim();
      if (!taskChatId) continue;
      const taskChat = state.chats.find((c) => c.id === taskChatId);
      if (!taskChat) continue;
      taskChat.groupId = group.id;
      taskChat.boardGroupId = group.id;
    }

    delete chat.orchestrateBoard;
    delete chat.viewMode;
  }

  (state as { version: number }).version = 5;
}

/** Experts overhaul: expertId as sole identity, runtime snapshots, drop Auto picker state. */
export function migrateSessionV5ToV6(state: SessionState): void {
  for (const chat of state.chats) {
    const selection = chat.expertSelection;
    if (chat.kind === 'expert') {
      if (!chat.expertId?.trim() && selection?.mode === 'manual' && selection.expertId?.trim()) {
        chat.expertId = selection.expertId.trim();
      }
      if (!chat.expertRuntime) {
        chat.expertRuntime = {
          ...(chat.providerId?.trim() ? { providerId: chat.providerId.trim() } : {}),
          modelId: chat.modelId ?? '',
          modeId: normalizeModeId(chat.modeId),
          toolAllowlist: null,
          toolDenylist: [],
          enabledToolNames: [],
          memoryEnabled: true,
          warnings: [],
          profileSource: 'inherit',
        };
      }
    }
    delete chat.expertSelection;
  }
  state.version = 6;
}

/** Coerce a chat row via the shared server/client schema (Phase B.1). */
export function ensureChatShape(raw: Partial<Chat> | null | undefined): Chat {
  // Shared allowlist — no client-only twin that can drift from validators.
  const chat = normalizeChatRow(raw) as Chat;
  ensureTokenLedger(chat);
  return chat;
}

export function isExpertChat(chat: Chat): boolean {
  return chat.kind === 'expert';
}

/** Legacy Expert Lab sessions are omitted from the main sidebar. */
export function isHiddenFromMainSidebar(chat: Chat): boolean {
  return chat.kind === 'expert-lab';
}

/** Create a new expert-scoped chat from a resolved seed (runtime + greeting). */
export function createExpertChatFromSeed(seed: ExpertChatSeed): Chat {
  const state = requireSessionState();
  const chat = createEmptyChatObject(seed.modelId, seed.workspacePath);
  chat.kind = 'expert';
  chat.expertId = seed.expertId;
  if (seed.providerId?.trim()) chat.providerId = seed.providerId.trim();
  chat.modeId = seed.modeId;
  chat.expertRuntime = { ...seed.runtimeSnapshot };
  chat.name = PLACEHOLDER_CHAT_NAME;
  chat.history.push({ role: 'assistant', content: seed.greeting });
  state.chats.push(chat);
  touchChat(chat);
  scheduleSaveSessions();
  return chat;
}

/** @deprecated Use createExpertChatFromSeed with resolveExpertChatSeed. */
export function createExpertChat(
  expertId: string,
  modelId = '',
  workspacePath?: string,
): Chat {
  const state = requireSessionState();
  const trimmedId = expertId.trim();
  const chat = createEmptyChatObject(
    modelId,
    workspacePath?.trim() || getWorkspacePath(),
  );
  chat.kind = 'expert';
  chat.expertId = trimmedId;
  chat.modeId = 'general';
  chat.expertRuntime = {
    modelId: modelId || '',
    modeId: 'general',
    toolAllowlist: null,
    toolDenylist: [],
    enabledToolNames: [],
    memoryEnabled: true,
    warnings: [],
    profileSource: 'inherit',
  };
  chat.name = PLACEHOLDER_CHAT_NAME;
  state.chats.push(chat);
  touchChat(chat);
  scheduleSaveSessions();
  return chat;
}

/** Expert threads for one specialist, newest activity first. */
export function getExpertChats(expertId: string): Chat[] {
  const state = requireSessionState();
  const id = expertId.trim();
  return state.chats
    .filter((c) => c.kind === 'expert' && c.expertId === id)
    .sort((a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a));
}

/** Set the active chat id and schedule a session save. */
export function activateChatById(id: string): void {
  const state = requireSessionState();
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return;
  state.activeId = id;
  markSessionScalarsDirty();
  maybeRememberActiveChatForForegroundApp(state, chat);
  scheduleSaveSessions();
}

/** Read legacy expert selection when still present on disk (pre-v6). */
export function getExpertSelection(chat: Chat): ExpertSelection {
  if (chat.expertSelection) return chat.expertSelection;
  const expertId = chat.expertId?.trim();
  if (expertId) return { mode: 'manual', expertId };
  return defaultExpertSelection();
}

/** Upgrade v1/v2 session JSON to canonical schema v2 in memory. */
export function migrateSessionStateV1ToV2(parsed: RawSessionJson): SessionState {
  const state = migrateSessionJsonToV2(
    parsed,
    (c) => ensureChatShape(c as Partial<Chat>),
    () => createEmptyChatObject(''),
  );
  clearStaleGenerationIdsOnLoad(state.chats);
  return state;
}

/** Parse persisted session JSON (client load path; parity with server validateSessionState). */
export function parseSessionStateFromJson(parsed: RawSessionJson | null): SessionState {
  if (!parsed || !Array.isArray(parsed.chats)) {
    return defaultSessionState();
  }
  const ver = parsed.version;
  if (ver !== 1 && ver !== 2 && ver !== 3 && ver !== 4 && ver !== 5 && ver !== 6) {
    return defaultSessionState();
  }
  const state = migrateSessionStateV1ToV2(parsed);
  const rawSession = parsed as Partial<SessionState>;
  state.groups = ensureGroupsFromRaw(rawSession.groups);
  if (
    typeof rawSession.activeBoardGroupId === 'string' &&
    rawSession.activeBoardGroupId.trim()
  ) {
    state.activeBoardGroupId = rawSession.activeBoardGroupId.trim();
  }
  if (ver < 5 || state.chats.some((c) => c.orchestrateBoard)) {
    migrateSessionV4ToV5(state);
  } else if (ver >= 5) {
    (state as { version: number }).version = ver;
  }
  if (ver < 6) {
    migrateSessionV5ToV6(state);
  } else {
    state.version = 6;
  }
  repairPlannerChatFolderMembership(state);
  repairBoardChatWorktreeRoots(state);
  if (
    rawSession.codeChangeTotalsByWorkspace &&
    typeof rawSession.codeChangeTotalsByWorkspace === 'object'
  ) {
    state.codeChangeTotalsByWorkspace = rawSession.codeChangeTotalsByWorkspace;
  }
  if (!state.lastActiveChatIdByApp) {
    state.lastActiveChatIdByApp = {};
  }
  if (typeof rawSession.sidebarWidth === 'number' && Number.isFinite(rawSession.sidebarWidth)) {
    state.sidebarWidth = Math.min(520, Math.max(200, Math.round(rawSession.sidebarWidth)));
  }
  return state;
}

/** Backfill chat.worktreeRoot from the linked board task after session load. */
function repairBoardChatWorktreeRoots(state: SessionState): void {
  for (const chat of state.chats) {
    if (chat.worktreeRoot?.trim()) continue;
    const root = resolveChatWorktreeRoot(chat, state.groups);
    if (root) chat.worktreeRoot = root;
  }
}

/** Planners linked via boardGroupId appear under their board folder in the sidebar. */
function repairPlannerChatFolderMembership(state: SessionState): void {
  let titleChanged = false;
  for (const group of state.groups ?? []) {
    const plannerId = group.plannerChatId?.trim();
    if (!plannerId) continue;
    const planner = state.chats.find((c) => c.id === plannerId);
    if (!planner) continue;
    if (planner.boardGroupId === group.id && planner.groupId !== group.id) {
      planner.groupId = group.id;
    }
    if (
      syncOrchestratorPlannerChatTitle(
        planner,
        planner.orchestratePlanPath ?? group.orchestratePlanPath,
      )
    ) {
      touchChat(planner);
      titleChanged = true;
    }
  }
  if (titleChanged) {
    scheduleSaveSessions();
  }
}

/** When a foreground chat surface is active, persist its last active chat id per app. */
function maybeRememberActiveChatForForegroundApp(
  state: SessionState,
  chat: Chat,
): void {
  if (shouldPaintDesktopChatSurface()) {
    rememberActiveChatForAppInState(state, DESKTOP_APP_ID, chat.id);
    return;
  }
  if (getForegroundAppId() === EMAIL_APP_ID && chat.appScope === 'email') {
    rememberActiveChatForAppInState(state, EMAIL_APP_ID, chat.id);
    return;
  }
  if (getForegroundAppId() !== CHAT_APP_ID && !isChatAppForeground()) return;
  rememberActiveChatForAppInState(state, CHAT_APP_ID, chat.id);
}

/** Remember the active chat under the current workspace key before switching scope. */
function rememberActiveChatForWorkspaceKey(workspaceKey: string): void {
  const state = sessionState;
  if (!state?.activeId) return;
  if (!state.lastActiveChatIdByWorkspace) {
    state.lastActiveChatIdByWorkspace = {};
  }
  state.lastActiveChatIdByWorkspace[workspaceKey] = state.activeId;
  markSessionScalarsDirty();
}

/** Persist the active chat when it belongs to the given project workspace (before desktop chat). */
export function rememberWorkspaceActiveChat(workspacePath: string): void {
  const state = sessionState;
  if (!state?.activeId) return;
  const key = normalizeWorkspacePath(workspacePath);
  if (!key) return;
  const active = getActiveChat();
  if (normalizeWorkspacePath(active.workspacePath ?? '') !== key) return;
  rememberActiveChatForWorkspaceKey(key);
  scheduleSaveSessions();
}

/** Chats for the given workspace (newest first); empty workspace key returns none. */
export function getChatsForWorkspace(
  workspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterChatsForWorkspace(workspacePath, state);
}

/** Sidebar session rows for a workspace (excludes ephemeral empty chats). */
export function getSidebarListedChatsForWorkspace(
  workspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterSidebarListedChatsForWorkspace(workspacePath, state);
}

export {
  isEphemeralEmptyChat,
  isSidebarListedChat,
  pruneEphemeralEmptyChats,
  formatDraftChatSidebarName,
};

/** Legacy or unscoped chats (`workspacePath === ''`), newest first. */
export function getUnassignedChats(state: SessionState = requireSessionState()): Chat[] {
  return filterUnassignedChats(state);
}

/** Assistant chats for the chats workspace sandbox (sidebar-visible, newest first). */
export function getAssistantChats(
  chatsWorkspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterAssistantChats(state, chatsWorkspacePath);
}

/** All chats bound to the chats workspace (newest first). */
export function getChatsForChatsWorkspace(
  chatsWorkspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterChatsForChatsWorkspace(state, chatsWorkspacePath);
}

/** All Email-scoped chats for the chats workspace sandbox. */
export function getEmailAssistantChats(
  chatsWorkspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterEmailAssistantChats(state, chatsWorkspacePath);
}

/** Email history rows with a committed turn or unsent draft. */
export function getListedEmailAssistantChats(
  chatsWorkspacePath: string,
  state: SessionState = requireSessionState(),
): Chat[] {
  return filterListedEmailAssistantChats(state, chatsWorkspacePath);
}

/** Persist last active chat id for a MinnowOS app. */
export function rememberActiveChatForApp(appId: string, chatId: string): void {
  const state = requireSessionState();
  rememberActiveChatForAppInState(state, appId, chatId);
  markSessionScalarsDirty();
  scheduleSaveSessions();
}

/** Read remembered active chat id for a MinnowOS app. */
export function getLastActiveChatIdForAppFromSession(appId: string): string | undefined {
  return getLastActiveChatIdForApp(requireSessionState(), appId);
}

/**
 * Activate the last assistant chat for the Chat app or create one (general mode).
 * Requires the absolute chats workspace path from `getChatsWorkspacePath()`.
 */
export function activateAssistantChatForApp(chatsWorkspacePath: string): Chat {
  const state = requireSessionState();
  const nextId = resolveActiveAssistantChatId(chatsWorkspacePath, state, (workspaceKey) => {
    const fresh = createAssistantChat(workspaceKey, newChatId());
    touchChat(fresh);
    return fresh;
  });
  state.activeId = nextId;
  markSessionScalarsDirty();
  rememberActiveChatForAppInState(state, CHAT_APP_ID, nextId);
  scheduleSaveSessions();
  return getActiveChat();
}

/** Activate the remembered Email assistant chat or create one in Email mode. */
export function activateEmailAssistantChatForApp(chatsWorkspacePath: string): Chat {
  const state = requireSessionState();
  const nextId = resolveActiveEmailAssistantChatId(
    chatsWorkspacePath,
    state,
    (workspaceKey) => createEmailAssistantChat(workspaceKey, newChatId()),
  );
  state.activeId = nextId;
  markSessionScalarsDirty();
  rememberActiveChatForAppInState(state, EMAIL_APP_ID, nextId);
  scheduleSaveSessions();
  return getActiveChat();
}

/** Create, activate, and persist a fresh Email-scoped assistant chat. */
export function createEmailAssistantChatForApp(
  chatsWorkspacePath: string,
  fallbackModelId = '',
): Chat {
  const state = requireSessionState();
  const chat = createEmailAssistantChat(
    chatsWorkspacePath,
    newChatId(),
    fallbackModelId,
  );
  state.chats.unshift(chat);
  state.activeId = chat.id;
  markSessionScalarsDirty();
  touchChat(chat);
  pruneEphemeralEmptyChats(state, chat.id);
  rememberActiveChatForAppInState(state, EMAIL_APP_ID, chat.id);
  scheduleSaveSessions();
  notifySessionCreated(chat.id, chat.workspacePath);
  return chat;
}

/**
 * Activate the last desktop chat or create one (desktop mode).
 * Requires the absolute desktop workspace path from `getDesktopWorkspacePath()`.
 */
export function activateDesktopAssistantChatForApp(desktopWorkspacePath: string): Chat {
  const state = requireSessionState();
  const key = normalizeWorkspacePath(desktopWorkspacePath);
  const nextId = resolveActiveAssistantChatId(
    desktopWorkspacePath,
    state,
    (workspaceKey) => {
      const fresh = createDesktopChat(workspaceKey, newChatId());
      touchChat(fresh);
      return fresh;
    },
    DESKTOP_APP_ID,
  );
  // Migrate legacy `lastActiveChatIdByApp.chat` entries that pointed at desktop threads.
  if (
    key &&
    !getLastActiveChatIdForApp(state, DESKTOP_APP_ID) &&
    getLastActiveChatIdForApp(state, CHAT_APP_ID)
  ) {
    const legacy = state.chats.find(
      (c) =>
        c.id === getLastActiveChatIdForApp(state, CHAT_APP_ID) &&
        normalizeWorkspacePath(c.workspacePath ?? '') === key,
    );
    if (legacy) {
      rememberActiveChatForAppInState(state, DESKTOP_APP_ID, legacy.id);
    }
  }
  state.activeId = nextId;
  markSessionScalarsDirty();
  rememberActiveChatForAppInState(state, DESKTOP_APP_ID, nextId);
  scheduleSaveSessions();
  return getActiveChat();
}

/**
 * Pick the active chat id for a workspace: remembered id, else newest scoped chat,
 * else create a new empty chat bound to that workspace.
 */
export function resolveActiveChatIdForWorkspace(
  workspacePath: string,
  state: SessionState = requireSessionState(),
  fallbackModelId = '',
): string {
  return pickActiveChatIdForWorkspace(
    workspacePath,
    state,
    fallbackModelId,
    (modelId, workspaceKey) => {
      const fresh = createEmptyChatObject(modelId, workspaceKey);
      touchChat(fresh);
      return fresh;
    },
  );
}

export interface WorkspaceChangeResult {
  activeChat: Chat;
  activeChanged: boolean;
}

/**
 * After the workspace folder changes: persist per-workspace active chat and switch
 * to the best chat for the new path.
 */
export function onWorkspaceChanged(
  newPath: string,
  previousPath?: string,
): WorkspaceChangeResult {
  const state = requireSessionState();
  const prevKey = normalizeWorkspacePath(previousPath ?? '');
  rememberActiveChatForWorkspaceKey(prevKey);

  const fallbackModelId =
    state.chats.find((c) => c.id === state.activeId)?.modelId ?? '';
  const nextId = resolveActiveChatIdForWorkspace(newPath, state, fallbackModelId);
  const activeChanged = state.activeId !== nextId;
  state.activeId = nextId;
  markSessionScalarsDirty();
  rememberActiveChatForWorkspaceKey(normalizeWorkspacePath(newPath));
  scheduleSaveSessions();
  return { activeChat: getActiveChat(), activeChanged };
}

export interface LoadSessionsOptions {
  /** Re-fetch from server/localStorage even when sessionState is already populated. */
  force?: boolean;
}

/** Load sessions from API or localStorage (after detectConfigServer). */
export async function loadSessionsFromStorage(options?: LoadSessionsOptions): Promise<void> {
  if (sessionState && !options?.force) {
    return;
  }
  try {
    if (isServerStorageMode()) {
      try {
        const remote = await getSessions();
        sessionState = parseSessionStateFromJson(remote);
        await runSessionCodeChangeBackfill(sessionState);
        sessionsHydratedFromServer = true;
        return;
      } catch {
        if (typeof document !== 'undefined') {
          setStatus('err', 'Could not load sessions from ~/.minnow');
        }
        // Never fall through to localStorage when file-backed storage is active — that
        // empty blob would later overwrite ~/.minnow on save (MIN-408).
        if (!sessionState) {
          sessionState = defaultSessionState();
        }
        return;
      }
    }

    sessionsHydratedFromServer = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        sessionState = defaultSessionState();
        return;
      }
      sessionState = parseSessionStateFromJson(JSON.parse(raw) as Partial<SessionState>);
      await runSessionCodeChangeBackfill(sessionState);
    } catch {
      sessionState = defaultSessionState();
    }
  } finally {
    clearSessionDirtySets();
    captureDirtyTrackingShadow(sessionState);
    markSessionsReady();
  }
}

/**
 * Resolve a chat by id when session state is available.
 * Returns undefined when sessions are not loaded yet (e.g. tests, early boot) so callers
 * can fall back instead of throwing from requireSessionState().
 */
export function findChatById(chatId: string): Chat | undefined {
  if (!sessionState) return undefined;
  return sessionState.chats.find((c) => c.id === chatId);
}

/** Chats ordered newest-first for sidebar display (by last committed message). */
export function getChatsSortedByUpdatedDesc(): Chat[] {
  return [...requireSessionState().chats].sort(
    (a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a),
  );
}

export function getActiveChat(): Chat {
  const state = requireSessionState();
  const c = state.chats.find((x) => x.id === state.activeId);
  return c || state.chats[0];
}

export function touchChat(chat: Chat): void {
  chat.updatedAt = Date.now();
  // Entire chat dirty mechanism for B.2 PATCH telemetry (B.1 still PUTs whole blob).
  dirtyChatIds.add(chat.id);
}

/** Store a new /goal completion condition on the chat. */
export function setActiveGoal(chat: Chat, conditionText: string): void {
  const trimmed = conditionText.trim().slice(0, MAX_GOAL_CONDITION_CHARS);
  if (!trimmed) return;
  ensureTokenLedger(chat);
  chat.activeGoal = {
    conditionText: trimmed,
    startedAt: Date.now(),
    turnCount: 0,
    tokenBaseline: chat.tokenLedger?.totals.totalTokens ?? 0,
  };
  touchChat(chat);
  scheduleSaveSessions();
}

/** Remove goal state from the chat (/goal clear, /clear, etc.). */
export function clearActiveGoal(chat: Chat): void {
  if (!chat.activeGoal) return;
  chat.activeGoal = undefined;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Replace the build-agent progress checklist on a chat (todo_write). */
export function setChatTodos(chat: Chat, todos: ChatTodo[]): void {
  chat.todos = todos.slice(0, MAX_CHAT_TODO_ITEMS).map((item) => ({
    text: item.text.trim().slice(0, MAX_CHAT_TODO_TEXT_CHARS),
    status: normalizeChatTodoStatus(item.status),
  }));
  chat.todosUpdatedAt = Date.now();
  touchChat(chat);
  scheduleSaveSessions();
}

/** Clear build-agent todos (/clear or empty todo_write). */
export function clearChatTodos(chat: Chat): void {
  if (!chat.todos?.length && chat.todosUpdatedAt === undefined) return;
  chat.todos = undefined;
  chat.todosUpdatedAt = undefined;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Read persisted build-agent todos. */
export function getChatTodos(chat: Chat): ChatTodo[] | undefined {
  return chat.todos?.length ? chat.todos : undefined;
}

/** Read persisted goal state (may be achieved but still visible until cleared). */
export function getActiveGoal(chat: Chat): ActiveGoalState | undefined {
  return chat.activeGoal;
}

/** True while the evaluator loop should auto-continue and auto-approve tools. */
export function isGoalLoopActive(chat: Chat): boolean {
  const goal = chat.activeGoal;
  return Boolean(goal && !goal.achieved);
}

export interface AddActiveLoopInput {
  promptText: string;
  kind: 'interval' | 'auto';
  intervalMs?: number;
  currentDelayMs?: number;
  dueAt: number;
  createdAt: number;
  expiresAt: number;
}

/** Ask loop ticker to reschedule its next wake after dueAt changes. */
function notifyLoopTickerScheduleChanged(): void {
  void import('../chat/loop/ticker')
    .then((mod) => mod.notifyLoopScheduleChanged())
    .catch(() => {
      // Ticker not started yet (tests / headless) — ignore.
    });
}

/** Arm a new /loop on the chat; returns the stored row. */
export function addActiveLoop(chat: Chat, input: AddActiveLoopInput): ActiveLoopState {
  const id = chat.nextLoopId && chat.nextLoopId > 0
    ? chat.nextLoopId
    : (chat.activeLoops?.reduce((max, loop) => Math.max(max, loop.id), 0) ?? 0) + 1;

  const loop: ActiveLoopState = {
    id,
    promptText: input.promptText.slice(0, MAX_LOOP_PROMPT_CHARS),
    kind: input.kind,
    dueAt: input.dueAt,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    runCount: 0,
  };

  if (input.kind === 'interval') {
    loop.intervalMs = Math.max(
      MIN_LOOP_INTERVAL_MS,
      Math.floor(input.intervalMs ?? MIN_LOOP_INTERVAL_MS),
    );
  } else {
    loop.currentDelayMs = Math.min(
      3_600_000,
      Math.max(
        MIN_LOOP_INTERVAL_MS,
        Math.floor(input.currentDelayMs ?? INITIAL_LOOP_AUTO_DELAY_MS),
      ),
    );
  }

  chat.activeLoops = [...(chat.activeLoops ?? []), loop];
  chat.nextLoopId = id + 1;
  touchChat(chat);
  scheduleSaveSessions();
  notifyLoopTickerScheduleChanged();
  return loop;
}

/** Remove one loop by id, or all loops when target is `all`. */
export function removeActiveLoop(chat: Chat, target: number | 'all'): void {
  if (!chat.activeLoops?.length) return;
  if (target === 'all') {
    chat.activeLoops = undefined;
    touchChat(chat);
    scheduleSaveSessions();
    notifyLoopTickerScheduleChanged();
    return;
  }
  const next = chat.activeLoops.filter((loop) => loop.id !== target);
  if (next.length === chat.activeLoops.length) return;
  chat.activeLoops = next.length ? next : undefined;
  touchChat(chat);
  scheduleSaveSessions();
  notifyLoopTickerScheduleChanged();
}

/** Patch fields on a single active loop (schedule / pacing). */
export function updateActiveLoop(
  chat: Chat,
  id: number,
  patch: Partial<ActiveLoopState>,
): void {
  if (!chat.activeLoops?.length) return;
  const index = chat.activeLoops.findIndex((loop) => loop.id === id);
  if (index < 0) return;
  chat.activeLoops[index] = { ...chat.activeLoops[index], ...patch, id };
  touchChat(chat);
  scheduleSaveSessions();
  notifyLoopTickerScheduleChanged();
}

/** Persist after in-place loop mutations that already updated the array. */
export function touchActiveLoops(chat: Chat): void {
  touchChat(chat);
  scheduleSaveSessions();
  notifyLoopTickerScheduleChanged();
}

/** Read active loops (empty array when none). */
export function getActiveLoops(chat: Chat): ActiveLoopState[] {
  return chat.activeLoops?.length ? [...chat.activeLoops] : [];
}

/** True when the chat has at least one armed loop. */
export function hasActiveLoops(chat: Chat): boolean {
  return Boolean(chat.activeLoops?.length);
}

/** Clear all loops (/clear, etc.). */
export function clearActiveLoops(chat: Chat): void {
  if (!chat.activeLoops?.length && chat.nextLoopId == null) return;
  chat.activeLoops = undefined;
  // Keep nextLoopId so ids stay unique across clear/re-arm in the same chat
  touchChat(chat);
  scheduleSaveSessions();
}

/** Bump sidebar sort time when user or assistant history is committed. */
export function recordChatMessage(chat: Chat): void {
  const now = Date.now();
  chat.lastMessageAt = now;
  // touchChat sets updatedAt + dirtyChatIds (do not bypass dirty tracking).
  touchChat(chat);
  chat.updatedAt = now;
}

export type SaveSessionsOptions = {
  /** Use fetch keepalive for unload handlers (fire-and-forget). */
  keepalive?: boolean;
};

export function saveSessionsNow(options?: SaveSessionsOptions): SaveSessionsResult {
  if (!sessionState) return 'ok';

  // B.1 telemetry: detect unmarked chat mutations in DEV (still PUT whole blob).
  verifyDirtyChatTracking(sessionState);

  if (isServerStorageMode()) {
    if (!sessionsHydratedFromServer) {
      return 'ok';
    }
    if (options?.keepalive) {
      putSessionsKeepalive(sessionState);
    } else {
      void putSessions(sessionState).catch(() => {
        setStatus('err', 'Could not save sessions to ~/.minnow');
      });
    }
    clearSessionDirtySets();
    captureDirtyTrackingShadow(sessionState);
    void import('../ui/hub').then((m) => m.refreshHubLiveData());
    return 'ok';
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));
    clearSessionDirtySets();
    captureDirtyTrackingShadow(sessionState);
    void import('../ui/hub').then((m) => m.refreshHubLiveData());
    return 'ok';
  } catch (e) {
    const err = e as { name?: string };
    if (err && err.name === 'QuotaExceededError') {
      return 'quota_exceeded';
    }
    return 'ok';
  }
}

export function scheduleSaveSessions(hint?: { chatId?: string; groupId?: string }): void {
  // Opportunistic dirty hints for callers that know what changed (B.2-ready).
  if (hint?.chatId?.trim()) dirtyChatIds.add(hint.chatId.trim());
  if (hint?.groupId?.trim()) dirtyGroupIds.add(hint.groupId.trim());
  if (saveTimer) clearTimeout(saveTimer);
  setSaveTimer(
    setTimeout(() => {
      setSaveTimer(null);
      saveSessionsNow();
    }, SAVE_DEBOUNCE_MS)
  );
}

/** Run any debounced session save immediately (unit tests only). */
export function flushScheduledSessionSaveForTests(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  setSaveTimer(null);
  saveSessionsNow();
}

/** Flush debounced saves and persist immediately (pagehide / abrupt quit). */
export function flushPendingSessionSaveOnShutdown(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    setSaveTimer(null);
  }
  saveSessionsNow({ keepalive: true });
}

/** Register a one-time pagehide handler so debounced saves are not lost on quit. */
export function registerSessionPersistenceShutdownHandler(): void {
  if (sessionPersistenceShutdownRegistered || typeof window === 'undefined') return;
  sessionPersistenceShutdownRegistered = true;
  window.addEventListener('pagehide', () => {
    flushPendingSessionSaveOnShutdown();
  });
}

/** Create a chat, make it active, and persist (debounced). */
export function createAndActivateChat(modelId: string): Chat {
  const state = requireSessionState();
  const chat = createEmptyChatObject(modelId);
  state.chats.unshift(chat);
  state.activeId = chat.id;
  markSessionScalarsDirty();
  touchChat(chat);
  rememberActiveChatForWorkspaceKey(normalizeWorkspacePath(chat.workspacePath));
  maybeRememberActiveChatForForegroundApp(state, chat);
  scheduleSaveSessions();
  notifySessionCreated(chat.id, chat.workspacePath);
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
  markSessionScalarsDirty();
  rememberActiveChatForWorkspaceKey(normalizeWorkspacePath(chat.workspacePath ?? ''));
  maybeRememberActiveChatForForegroundApp(state, chat);
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
  markSessionScalarsDirty();
  scheduleSaveSessions();
  return state.sidebarCollapsed;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  const state = requireSessionState();
  state.sidebarCollapsed = collapsed;
  markSessionScalarsDirty();
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
  const victimAgent = resolveActiveWorkAgent(victim);
  cleanupChatArchiveOnDelete(
    victim.id,
    victim.workspacePath ?? '',
    victimAgent?.contextEnforcementPolicy,
  );
  void cleanupChatWorktreeOnDelete(victim);
  abortChatTitleGeneration(chatId);
  const wasActive = state.activeId === chatId;

  // Planner deletion: keep plan path on the board folder so hub/sidebar boards survive.
  const boardGroup = (state.groups ?? []).find((g) => g.plannerChatId === chatId);
  if (boardGroup) {
    const planPath = normalizeOrchestratePlanPath(victim.orchestratePlanPath);
    if (planPath) {
      boardGroup.orchestratePlanPath = planPath;
    }
    delete boardGroup.plannerChatId;
  }

  state.chats.splice(idx, 1);
  deletedChatIds.add(chatId);
  if (boardGroup) {
    markGroupDirty(boardGroup.id);
  }

  const victimWorkspace = normalizeWorkspacePath(victim.workspacePath ?? '');
  let activeChanged = wasActive;
  if (state.chats.length === 0) {
    const fresh = createEmptyChatObject(fallbackModelId, victimWorkspace);
    state.chats.push(fresh);
    state.activeId = fresh.id;
    markSessionScalarsDirty();
    touchChat(fresh);
    activeChanged = true;
  } else if (wasActive) {
    const inWorkspace = getSidebarListedChatsForWorkspace(victimWorkspace, state);
    if (inWorkspace.length) {
      state.activeId = inWorkspace[0]!.id;
      markSessionScalarsDirty();
    } else {
      const fresh = createEmptyChatObject(fallbackModelId, victimWorkspace);
      state.chats.push(fresh);
      state.activeId = fresh.id;
      markSessionScalarsDirty();
      touchChat(fresh);
    }
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
  if (!chat || !isPlaceholderChatName(chat.name)) return false;
  const trimmed = title.trim();
  if (!trimmed) return false;
  chat.name = trimmed;
  touchChat(chat);
  return true;
}
