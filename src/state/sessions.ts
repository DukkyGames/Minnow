import { PLACEHOLDER_CHAT_NAME, SAVE_DEBOUNCE_MS, STORAGE_KEY } from '../constants';
import { abortChatTitleGeneration } from '../chat/titles/inflight';
import { cleanupChatWorktreeOnDelete } from './chat-worktree';
import { isPlaceholderChatName } from '../chat/titles/placeholder';
import { setSaveTimer, saveTimer } from '../app-state';
import {
  flushSessionsOnShutdown,
  getChatHistory,
  getSessionsWithRev,
  getSessionSummariesWithRev,
  patchSessions,
  putSessions,
  SessionRevisionConflictError,
  type SessionsPatchDelta,
} from '../config/api-client';
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
import type {
  ActiveGoalState,
  ActiveLoopState,
  Chat,
  ChatGroup,
  ChatSummary,
  ChatTodo,
  ExpertSelection,
  Message,
  SessionState,
  SessionSummariesState,
} from '../types';
import { SESSION_SCHEMA_VERSION } from '../types';

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
 * Skips chats whose history is not loaded yet (lazy boot) — re-run after ensure.
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
    // Unloaded histories are empty placeholders — do not treat that as "no assistant yet".
    if (chat.historyLoaded === false) continue;
    const last = chat.history[chat.history.length - 1];
    if (last?.role === 'assistant') {
      const text = typeof last.content === 'string' ? last.content.trim() : '';
      if (text.length > 0) {
        delete chat.currentGenerationId;
      }
    }
  }
}

const MAX_CHAT_TODO_ITEMS = 20;
const MAX_CHAT_TODO_TEXT_CHARS = 140;

function normalizeChatTodoStatus(raw: unknown): ChatTodo['status'] {
  if (raw === 'completed' || raw === 'in_progress' || raw === 'pending') return raw;
  return 'pending';
}

/** In-memory session blob mirrored to ~/.minnow or localStorage fallback. */
export let sessionState: SessionState | null = null;

/**
 * When set, scheduleSaveSessions/saveSessionsNow publish via the Session Engine
 * instead of client PUT/PATCH (MIN-360 board host).
 */
let engineHostPersistHook: (() => void) | null = null;

/** Engine board host installs a persist hook; null restores normal client saves. */
export function setEngineHostPersistHook(hook: (() => void) | null): void {
  engineHostPersistHook = hook;
}

/**
 * Point sessionState at the engine-owned blob (same reference — board mutates in place).
 * Does not run client hydrate/dirty tracking resets beyond assigning the ref.
 */
export function setSessionStateForEngineHost(state: SessionState | null): void {
  sessionState = state;
  if (state) {
    sessionsHydratedFromServer = true;
    sessionPatchDirtySetsReady = true;
    captureDirtyTrackingShadow(state);
  }
}

/** Monotonic server revision for optimistic concurrency (Phase 0). */
let sessionRev = 0;

/** Current session revision from the server (0 when unknown). */
export function getSessionRev(): number {
  return sessionRev;
}

/** Update tracked revision after a successful load/save/reconcile. */
export function setSessionRev(rev: number): void {
  if (Number.isFinite(rev) && rev >= 0) {
    sessionRev = rev;
  }
}

/**
 * Replace in-memory session state from a remote SSE snapshot/patch.
 * Full-state replace: mark histories loaded so lazy-history clients stay consistent.
 */
export function applyRemoteSessionState(raw: unknown): void {
  // Durable PUTs/PATCHes omit ephemeral liveSubAgentRuns. Preserve the last known
  // slice unless the remote payload explicitly includes the field (incl. []).
  const prevLive = sessionState?.liveSubAgentRuns;
  const remoteOmitsLive =
    raw != null &&
    typeof raw === 'object' &&
    !Object.prototype.hasOwnProperty.call(raw, 'liveSubAgentRuns');

  sessionState = parseSessionStateFromJson(raw as RawSessionJson);
  if (
    remoteOmitsLive &&
    sessionState.liveSubAgentRuns == null &&
    Array.isArray(prevLive)
  ) {
    sessionState.liveSubAgentRuns = prevLive;
  }
  markAllHistoriesLoaded(sessionState.chats);
  // Remote replace invalidates local dirty sets — next save should full-PUT.
  clearSessionDirtySets();
  sessionPatchDirtySetsReady = false;
  captureDirtyTrackingShadow(sessionState);
}

/**
 * Set after a successful GET from ~/.minnow. Blocks PUT until hydration so a boot-time
 * localStorage fallback cannot clobber on-disk sessions (MIN-408).
 */
let sessionsHydratedFromServer = false;

/** Dirty chat ids since last successful flush (B.2 PATCH payload). */
const dirtyChatIds = new Set<string>();
/** Explicit chat deletes since last successful flush. */
const deletedChatIds = new Set<string>();
/** Dirty sidebar/board group ids since last successful flush. */
const dirtyGroupIds = new Set<string>();
/** Explicit group deletes since last successful flush (PATCH deleteGroupIds). */
const deletedGroupIds = new Set<string>();
/** Session scalars (activeId, sidebar, maps, …) changed since last successful flush. */
let sessionScalarsDirty = false;
/**
 * Shadow JSON of chats after last load/flush — used by the B.1/B.2 DEV verifier to
 * catch mutations that bypassed {@link touchChat}.
 */
let dirtyTrackingShadowChatsJson: string | null = null;
/** When true, flush runs the unmarked-mutation verifier (tests / Vite DEV). */
let dirtyTrackingVerifierForced = false;
/**
 * B.2 flag: when true (default), server-mode flush uses PATCH once dirty sets are trusted.
 * Full-PUT fallback when dirty sets are unavailable (first save after load, or verifier miss).
 */
let sessionsClientPatchEnabled = true;
/**
 * C.2 flag: when true, boot loads chat summaries and fetches history on demand.
 * Default ON — whole-blob GET only when explicitly flipped off in tests.
 */
let sessionsLazyHistoryEnabled = true;
/**
 * False after load / verifier miss — next successful full PUT establishes a trusted baseline
 * so subsequent flushes may PATCH.
 */
let sessionPatchDirtySetsReady = false;

/** In-flight `ensureChatHistoryLoaded` promises keyed by chat id (concurrent dedupe). */
const historyLoadInflight = new Map<string, Promise<void>>();
/** When true, install the unloaded-history DEV trap even outside Vite DEV (unit tests). */
let historyTrapForcedForTests = false;

function isViteDevBuild(): boolean {
  try {
    // Vite sets import.meta.env.DEV; Node/tsx tests leave it undefined.
    return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

function shouldInstallHistoryTrap(): boolean {
  return sessionsLazyHistoryEnabled && (historyTrapForcedForTests || isViteDevBuild());
}

function isDirtyTrackingVerifierEnabled(): boolean {
  if (dirtyTrackingVerifierForced) return true;
  return isViteDevBuild();
}

/** Snapshot chats for dirty-tracking without reading lazy-unloaded `history`. */
function chatSnapshotForDirtyShadow(chat: Chat): Record<string, unknown> {
  if (chat.historyLoaded === false) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(chat)) {
      if (key === 'history') continue;
      out[key] = (chat as unknown as Record<string, unknown>)[key];
    }
    delete out.historyLoaded;
    delete out.messageCount;
    return out;
  }
  const { historyLoaded: _loaded, messageCount: _count, ...rest } = chat;
  void _loaded;
  void _count;
  return { ...rest };
}

function captureDirtyTrackingShadow(state: SessionState | null): void {
  dirtyTrackingShadowChatsJson = state
    ? JSON.stringify(state.chats.map(chatSnapshotForDirtyShadow))
    : null;
}

function clearSessionDirtySets(): void {
  dirtyChatIds.clear();
  deletedChatIds.clear();
  dirtyGroupIds.clear();
  deletedGroupIds.clear();
  sessionScalarsDirty = false;
}

/** True when any dirty marker would produce a non-empty PATCH. */
function hasSessionDirtyWork(): boolean {
  return (
    dirtyChatIds.size > 0 ||
    deletedChatIds.size > 0 ||
    dirtyGroupIds.size > 0 ||
    deletedGroupIds.size > 0 ||
    sessionScalarsDirty
  );
}

/** Mark session-level scalars dirty for the next PATCH. */
export function markSessionScalarsDirty(): void {
  sessionScalarsDirty = true;
}

/** Mark a sidebar/board group dirty for the next PATCH upsert. */
export function markGroupDirty(groupId: string): void {
  const id = typeof groupId === 'string' ? groupId.trim() : '';
  if (!id) return;
  // A resurrected/upserted group is not a delete.
  deletedGroupIds.delete(id);
  dirtyGroupIds.add(id);
}

/** Mark a group deleted for PATCH `deleteGroupIds` (not a dirty upsert). */
export function markGroupDeleted(groupId: string): void {
  const id = typeof groupId === 'string' ? groupId.trim() : '';
  if (!id) return;
  dirtyGroupIds.delete(id);
  deletedGroupIds.add(id);
}

/**
 * Dev/test verifier: warn when a chat stringified differently without touchChat.
 * @returns true when an unmarked mutation was detected (dirty sets untrusted → full PUT).
 */
function verifyDirtyChatTracking(state: SessionState): boolean {
  if (!isDirtyTrackingVerifierEnabled()) return false;
  if (dirtyTrackingShadowChatsJson == null) return false;
  let shadow: unknown;
  try {
    shadow = JSON.parse(dirtyTrackingShadowChatsJson);
  } catch {
    return false;
  }
  if (!Array.isArray(shadow)) return false;
  const shadowById = new Map(
    shadow
      .filter((c) => c && typeof c === 'object' && typeof (c as Chat).id === 'string')
      .map((c) => [(c as Chat).id, JSON.stringify(c)]),
  );
  let missed = false;
  for (const chat of state.chats) {
    const prev = shadowById.get(chat.id);
    if (prev === undefined) continue; // new chats are marked via touchChat on create
    const next = JSON.stringify(chatSnapshotForDirtyShadow(chat));
    if (prev !== next && !dirtyChatIds.has(chat.id)) {
      missed = true;
      console.warn(
        `[sessions dirty-tracking] chat ${chat.id} changed without touchChat()`,
      );
    }
  }
  return missed;
}

/**
 * Serialize one chat for PATCH/PUT when history may still be lazy-unloaded (C.2).
 * Omits `history` so the server preserves existing message rows instead of syncing [].
 */
export function chatForSessionsWire(chat: Chat): Chat {
  if (chat.historyLoaded === false) {
    const {
      history: _history,
      historyLoaded: _loaded,
      messageCount: _messageCount,
      ...rest
    } = chat;
    void _history;
    void _loaded;
    void _messageCount;
    return rest as Chat;
  }
  const { historyLoaded: _loaded, messageCount: _messageCount, ...rest } = chat;
  void _loaded;
  void _messageCount;
  return rest as Chat;
}

/** Clone session state for wire I/O, stripping unloaded chat histories. */
export function sessionStateForSessionsWire(state: SessionState): SessionState {
  // liveSubAgentRuns is engine-ephemeral — never let a client PUT overwrite it.
  const { liveSubAgentRuns: _live, ...rest } = state;
  return {
    ...rest,
    chats: state.chats.map(chatForSessionsWire),
  };
}

/** Build a PATCH delta from the current dirty sets (full dirty chats/groups). */
export function buildSessionsPatchDelta(state: SessionState): SessionsPatchDelta {
  const delta: SessionsPatchDelta = {
    baseVersion: state.version ?? SESSION_SCHEMA_VERSION,
  };

  const rev = getSessionRev();
  if (rev > 0) {
    // Phase 0: carry expectedRev in body as well as If-Match (beacons cannot set headers).
    delta.expectedRev = rev;
  }

  if (dirtyChatIds.size > 0) {
    const byId = new Map(state.chats.map((c) => [c.id, c]));
    const chats: Chat[] = [];
    for (const id of dirtyChatIds) {
      // Skip ids that were also deleted in the same window.
      if (deletedChatIds.has(id)) continue;
      const chat = byId.get(id);
      if (chat) chats.push(chatForSessionsWire(chat));
    }
    if (chats.length) delta.chats = chats;
  }

  if (deletedChatIds.size > 0) {
    delta.deleteChatIds = [...deletedChatIds];
  }

  if (dirtyGroupIds.size > 0) {
    const byId = new Map((state.groups ?? []).map((g) => [g.id, g]));
    const groups: ChatGroup[] = [];
    for (const id of dirtyGroupIds) {
      if (deletedGroupIds.has(id)) continue;
      const group = byId.get(id);
      if (group) groups.push(group);
    }
    if (groups.length) delta.groups = groups;
  }

  if (deletedGroupIds.size > 0) {
    delta.deleteGroupIds = [...deletedGroupIds];
  }

  if (sessionScalarsDirty) {
    // Partial scalars — only keys we always track as a session-level bundle.
    const scalars: Record<string, unknown> = {
      version: state.version ?? SESSION_SCHEMA_VERSION,
      activeId: typeof state.activeId === 'string' ? state.activeId : '',
      sidebarCollapsed: !!state.sidebarCollapsed,
      lastActiveChatIdByWorkspace: state.lastActiveChatIdByWorkspace ?? {},
      lastActiveChatIdByApp: state.lastActiveChatIdByApp ?? {},
    };
    // Optional keys: send explicit null so PATCH can clear them.
    scalars.sidebarWidth = state.sidebarWidth ?? null;
    scalars.activeBoardGroupId = state.activeBoardGroupId ?? null;
    if (state.codeChangeTotalsByWorkspace) {
      scalars.codeChangeTotalsByWorkspace = state.codeChangeTotalsByWorkspace;
    }
    delta.scalars = scalars;
  }

  return delta;
}

/** Test helper: dirty set snapshot for B.2 PATCH. */
export function getSessionDirtyTrackingForTests(): {
  dirtyChatIds: string[];
  deletedChatIds: string[];
  dirtyGroupIds: string[];
  deletedGroupIds: string[];
  sessionScalarsDirty: boolean;
  sessionPatchDirtySetsReady: boolean;
  sessionsClientPatchEnabled: boolean;
} {
  return {
    dirtyChatIds: [...dirtyChatIds].sort(),
    deletedChatIds: [...deletedChatIds].sort(),
    dirtyGroupIds: [...dirtyGroupIds].sort(),
    deletedGroupIds: [...deletedGroupIds].sort(),
    sessionScalarsDirty,
    sessionPatchDirtySetsReady,
    sessionsClientPatchEnabled,
  };
}

/** Test helper: toggle B.2 client PATCH flag (`sessionsClientPatchEnabled`, default ON). */
export function setSessionsClientPatchEnabledForTests(enabled: boolean): void {
  sessionsClientPatchEnabled = enabled;
}

/** Test helper: toggle C.2 lazy-history flag (`sessionsLazyHistoryEnabled`, default ON). */
export function setSessionsLazyHistoryEnabledForTests(enabled: boolean): void {
  sessionsLazyHistoryEnabled = enabled;
}

/** Whether lazy history loading is enabled (C.2; default true). */
export function isSessionsLazyHistoryEnabled(): boolean {
  return sessionsLazyHistoryEnabled;
}

/** Test helper: force the unloaded-history DEV trap on/off (tsx has no import.meta.env.DEV). */
export function setHistoryTrapForcedForTests(forced: boolean): void {
  historyTrapForcedForTests = forced;
}

/**
 * Test helper: mark a chat unloaded and attach the DEV history trap (requires flag + trap force).
 */
export function attachUnloadedHistoryTrapForTests(chat: Chat): void {
  chat.historyLoaded = false;
  if (!Array.isArray(chat.history)) chat.history = [];
  installUnloadedHistoryTrap(chat);
}

/** Test helper: mark dirty sets trusted (or force full-PUT fallback). */
export function setSessionPatchDirtySetsReadyForTests(ready: boolean): void {
  sessionPatchDirtySetsReady = ready;
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
/** In-flight server PATCH/PUT so tests can await dirty-set clear after success. */
let inFlightSessionSave: Promise<void> | null = null;

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
    // Tests start past the post-load full-PUT baseline so PATCH can be exercised directly.
    sessionPatchDirtySetsReady = true;
  } else {
    sessionsHydratedFromServer = false;
    sessionPatchDirtySetsReady = false;
  }
}

/** Reset persistence guards between unit tests. */
export function resetSessionPersistenceForTests(): void {
  sessionsHydratedFromServer = false;
  sessionPersistenceShutdownRegistered = false;
  clearSessionDirtySets();
  dirtyTrackingShadowChatsJson = null;
  dirtyTrackingVerifierForced = false;
  sessionsClientPatchEnabled = true;
  sessionsLazyHistoryEnabled = true;
  historyTrapForcedForTests = false;
  sessionPatchDirtySetsReady = false;
  inFlightSessionSave = null;
  historyLoadInflight.clear();
  // Clear debounce timer so Node test runners can exit.
  if (saveTimer) {
    clearTimeout(saveTimer);
    setSaveTimer(null);
  }
}

/** Await the in-flight server PATCH/PUT started by {@link saveSessionsNow} (tests). */
export async function waitForSessionSaveForTests(): Promise<void> {
  if (inFlightSessionSave) await inFlightSessionSave;
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
    // Locally created chats own their (empty) transcript immediately.
    historyLoaded: true,
    lastStats: null,
    modelInfo: {},
    updatedAt: Date.now(),
    lastMessageAt: Date.now(),
  };
}

/** True when `history` is safe to read/mutate without a lazy fetch. */
export function isChatHistoryLoaded(chat: Chat): boolean {
  return chat.historyLoaded !== false;
}

/**
 * Throw when history is not loaded — use at highest-risk mutators (category-3).
 * Prefer {@link ensureChatHistoryLoaded} before calling this on the flag-on path.
 */
export function requireHistory(chat: Chat): Message[] {
  if (chat.historyLoaded === false) {
    throw new Error(
      `Chat history not loaded for ${chat.id}; await ensureChatHistoryLoaded(chatId) first`,
    );
  }
  return chat.history;
}

/**
 * Inflate a {@link ChatSummary} into a Chat placeholder (empty history).
 * Spreads cold meta_json fields + non-message children from the summary payload (C.2).
 */
export function chatSummaryToChat(summary: ChatSummary): Chat {
  // Drop list-only wire keys except messageCount (needed for rail listing while unloaded).
  const {
    messageCount: rawMessageCount,
    lastMessagePreview: _lastMessagePreview,
    sortIndex: _sortIndex,
    historyDigest: _historyDigest,
    ...cold
  } = summary as ChatSummary & Record<string, unknown>;
  void _lastMessagePreview;
  void _sortIndex;
  void _historyDigest;

  const messageCount =
    typeof rawMessageCount === 'number' && Number.isFinite(rawMessageCount)
      ? Math.max(0, Math.floor(rawMessageCount))
      : 0;

  const chat: Chat = {
    ...(cold as Partial<Chat>),
    id: summary.id,
    name: summary.name || PLACEHOLDER_CHAT_NAME,
    workspacePath: summary.workspacePath ?? '',
    modelId: summary.modelId ?? '',
    history: [],
    historyLoaded: false,
    // Keep denormalized count so desktop/Code rails list chats before history hydrate.
    messageCount,
    lastStats: (cold as Partial<Chat>).lastStats ?? null,
    modelInfo: (cold as Partial<Chat>).modelInfo ?? {},
    updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : Date.now(),
  };
  return chat;
}

/**
 * Dev-only trap: first `history` read while unloaded logs an error + stack, then returns [].
 * Active when lazy-history flag is on and Vite DEV (or {@link setHistoryTrapForcedForTests}).
 */
function installUnloadedHistoryTrap(chat: Chat): void {
  if (!shouldInstallHistoryTrap()) return;
  if (chat.historyLoaded !== false) return;

  let store: Message[] = Array.isArray(chat.history) ? chat.history : [];
  let warned = false;
  Object.defineProperty(chat, 'history', {
    configurable: true,
    enumerable: true,
    get() {
      if (chat.historyLoaded === false && !warned) {
        warned = true;
        console.error(
          `[sessions] chat.history read before ensureChatHistoryLoaded (${chat.id})`,
          new Error().stack,
        );
      }
      return store;
    },
    set(value: Message[]) {
      store = Array.isArray(value) ? value : [];
    },
  });
}

/** Replace placeholder history with the full transcript and clear the unload marker. */
function materializeChatHistory(chat: Chat, messages: Message[]): void {
  const desc = Object.getOwnPropertyDescriptor(chat, 'history');
  if (desc && (desc.get || desc.set)) {
    // Drop the dev trap getter so subsequent access is a plain data property.
    delete (chat as { history?: Message[] }).history;
  }
  chat.history = Array.isArray(messages) ? messages : [];
  chat.historyLoaded = true;
  chat.messageCount = chat.history.length;
}

/** Mark every chat as fully loaded (whole-blob boot / flag-off path). */
function markAllHistoriesLoaded(chats: Chat[]): void {
  for (const chat of chats) {
    chat.historyLoaded = true;
  }
}

/**
 * Build SessionState from GET /api/config/sessions/summaries (flag-on boot).
 * Chats start with `history: []` and `historyLoaded: false`.
 */
function sessionStateFromSummaries(remote: SessionSummariesState): SessionState {
  const inflatedChats = remote.chats.map((summary) => chatSummaryToChat(summary));
  // RawSessionJson is the wire shape; groups / totals are read via Partial<SessionState> inside parse.
  const raw = {
    version: remote.version ?? SESSION_SCHEMA_VERSION,
    activeId: remote.activeId,
    sidebarCollapsed: remote.sidebarCollapsed,
    chats: inflatedChats,
    groups: remote.groups,
    activeBoardGroupId: remote.activeBoardGroupId,
    lastActiveChatIdByWorkspace: remote.lastActiveChatIdByWorkspace,
    lastActiveChatIdByApp: remote.lastActiveChatIdByApp,
    sidebarWidth: remote.sidebarWidth,
    codeChangeTotalsByWorkspace: remote.codeChangeTotalsByWorkspace,
  } as RawSessionJson;
  const state = parseSessionStateFromJson(raw);
  // parse/ensureChatShape may drop historyLoaded — re-apply unload markers + traps.
  for (const chat of state.chats) {
    const fromSummary = remote.chats.some((s) => s.id === chat.id);
    if (!fromSummary) {
      chat.historyLoaded = true;
      continue;
    }
    chat.historyLoaded = false;
    if (!Array.isArray(chat.history)) chat.history = [];
    installUnloadedHistoryTrap(chat);
  }
  return state;
}

/**
 * Idempotent lazy history fetch. Concurrent callers for the same id share one in-flight Promise.
 * No-op when the lazy-history flag is off or the chat is already loaded / missing.
 */
export async function ensureChatHistoryLoaded(chatId: string): Promise<void> {
  const id = typeof chatId === 'string' ? chatId.trim() : '';
  if (!id) return;
  if (!sessionsLazyHistoryEnabled) return;

  const chat = findChatById(id);
  if (!chat || chat.historyLoaded !== false) return;

  const existing = historyLoadInflight.get(id);
  if (existing) return existing;

  const loadPromise = (async () => {
    if (!isServerStorageMode()) {
      // localStorage boot always has full history; treat as loaded.
      const local = findChatById(id);
      if (local) local.historyLoaded = true;
      return;
    }
    const messages = await getChatHistory(id);
    const target = findChatById(id);
    if (!target || target.historyLoaded !== false) return;
    materializeChatHistory(target, messages);
  })().finally(() => {
    historyLoadInflight.delete(id);
  });

  historyLoadInflight.set(id, loadPromise);
  return loadPromise;
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

/**
 * Set the active chat id, hydrate history, and schedule a session save.
 * Await this (or {@link ensureChatHistoryLoaded}) before painting the transcript —
 * lazy-boot chats start with `history: []` until the history GET lands.
 */
export async function activateChatById(id: string): Promise<void> {
  const state = requireSessionState();
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return;
  state.activeId = id;
  markSessionScalarsDirty();
  maybeRememberActiveChatForForegroundApp(state, chat);
  scheduleSaveSessions();
  await ensureChatHistoryLoaded(id);
}

/** Read legacy expert selection when still present on disk (pre-v6). */
export function getExpertSelection(chat: Chat): ExpertSelection {
  if (chat.expertSelection) return chat.expertSelection;
  const expertId = chat.expertId?.trim();
  if (expertId) return { mode: 'manual', expertId };
  return { mode: 'auto', expertId: null };
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
  // Engine SSE live slice (MIN-361) — not in scalar allowlist; copy through for clients.
  if (Array.isArray(rawSession.liveSubAgentRuns)) {
    state.liveSubAgentRuns = rawSession.liveSubAgentRuns;
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
 * to the best chat for the new path. Awaits history hydrate for the new active chat.
 */
export async function onWorkspaceChanged(
  newPath: string,
  previousPath?: string,
): Promise<WorkspaceChangeResult> {
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
  // C.1: hydrate before callers paint — lazy-boot chats have empty history until this lands.
  await ensureChatHistoryLoaded(nextId);
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
        if (sessionsLazyHistoryEnabled) {
          // C.2: summaries first (meta + non-message children); history on demand.
          const remote = await getSessionSummariesWithRev();
          sessionState = sessionStateFromSummaries(remote.state);
          setSessionRev(remote.rev);
          // Active chat is hydrated immediately so the first paint has a transcript.
          if (sessionState.activeId) {
            await ensureChatHistoryLoaded(sessionState.activeId);
            const active = findChatById(sessionState.activeId);
            if (active) clearStaleGenerationIdsOnLoad([active]);
          }
          // Code-change backfill only for chats whose history is already loaded.
          await runSessionCodeChangeBackfill(sessionState);
        } else {
          // Flag off (tests): whole-blob GET — every chat is fully loaded.
          const remote = await getSessionsWithRev();
          sessionState = parseSessionStateFromJson(remote.state);
          setSessionRev(remote.rev);
          markAllHistoriesLoaded(sessionState.chats);
          await runSessionCodeChangeBackfill(sessionState);
        }
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
          markAllHistoriesLoaded(sessionState.chats);
        }
        return;
      }
    }

    sessionsHydratedFromServer = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        sessionState = defaultSessionState();
        markAllHistoriesLoaded(sessionState.chats);
        return;
      }
      sessionState = parseSessionStateFromJson(JSON.parse(raw) as Partial<SessionState>);
      markAllHistoriesLoaded(sessionState.chats);
      await runSessionCodeChangeBackfill(sessionState);
    } catch {
      sessionState = defaultSessionState();
      markAllHistoriesLoaded(sessionState.chats);
    }
  } finally {
    clearSessionDirtySets();
    // First save after load must full-PUT until a successful baseline flush.
    sessionPatchDirtySetsReady = false;
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
  // Entire-chat dirty marker for the next PATCH upsert.
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
  /** Use fetch keepalive / sendBeacon for unload handlers (fire-and-forget). */
  keepalive?: boolean;
};

/**
 * PUT session blob with If-Match; on 409 re-pull and retry once.
 * Throws on non-conflict failures so callers can surface status.
 */
async function persistSessionsPutToServer(): Promise<void> {
  if (!sessionState) return;
  const snapshot = sessionStateForSessionsWire(sessionState);
  const expectedRev = getSessionRev();
  try {
    const newRev = await putSessions(snapshot, expectedRev > 0 ? expectedRev : undefined);
    setSessionRev(newRev);
  } catch (err) {
    if (!(err instanceof SessionRevisionConflictError)) throw err;
    const remote = await getSessionsWithRev();
    setSessionRev(remote.rev);
    const retryRev = await putSessions(snapshot, remote.rev > 0 ? remote.rev : undefined);
    setSessionRev(retryRev);
  }
}

/**
 * PATCH with If-Match / expectedRev; on 409 refresh rev and retry the same delta once.
 */
async function persistSessionsPatchToServer(delta: SessionsPatchDelta): Promise<void> {
  try {
    const newRev = await patchSessions(delta);
    setSessionRev(newRev);
  } catch (err) {
    if (!(err instanceof SessionRevisionConflictError)) throw err;
    setSessionRev(err.rev);
    const retryDelta: SessionsPatchDelta = {
      ...delta,
      expectedRev: err.rev > 0 ? err.rev : undefined,
    };
    const retryRev = await patchSessions(retryDelta);
    setSessionRev(retryRev);
  }
}

/**
 * Persist session state. In server mode (B.2):
 * - MIN-408: no network write until hydrated from ~/.minnow
 * - PATCH when `sessionsClientPatchEnabled` (default ON) and dirty sets are trusted
 * - full PUT on first save after load, or after a dirty-tracking verifier miss
 * - dirty sets clear only after a successful PATCH/PUT (or accepted shutdown beacon)
 */
export function saveSessionsNow(options?: SaveSessionsOptions): SaveSessionsResult {
  if (!sessionState) return 'ok';

  // Engine board host: publish in-place engine state (no client PUT/PATCH).
  if (engineHostPersistHook) {
    clearSessionDirtySets();
    captureDirtyTrackingShadow(sessionState);
    engineHostPersistHook();
    return 'ok';
  }

  // Detect unmarked chat mutations in DEV; a miss forces full-PUT fallback.
  const verifierMiss = verifyDirtyChatTracking(sessionState);
  if (verifierMiss) {
    sessionPatchDirtySetsReady = false;
  }

  if (isServerStorageMode()) {
    // MIN-408: never PATCH/PUT before a successful server hydrate.
    if (!sessionsHydratedFromServer) {
      return 'ok';
    }

    const usePatch =
      sessionsClientPatchEnabled && sessionPatchDirtySetsReady && !verifierMiss;

    if (usePatch && !hasSessionDirtyWork()) {
      // Nothing changed since the last successful flush.
      captureDirtyTrackingShadow(sessionState);
      void import('../ui/hub').then((m) => m.refreshHubLiveData());
      return 'ok';
    }

    if (options?.keepalive) {
      // Shutdown: small PATCH delta → sendBeacon (POST alias); else keepalive whole-blob PUT.
      const delta = usePatch && hasSessionDirtyWork() ? buildSessionsPatchDelta(sessionState) : null;
      const wireState = sessionStateForSessionsWire(sessionState);
      const { clearedOk } = flushSessionsOnShutdown(delta, wireState);
      if (clearedOk) {
        clearSessionDirtySets();
        // Keepalive PUT also re-establishes a trusted baseline when we were not patching.
        if (!usePatch) sessionPatchDirtySetsReady = true;
      }
      captureDirtyTrackingShadow(sessionState);
      void import('../ui/hub').then((m) => m.refreshHubLiveData());
      return 'ok';
    }

    const reportSaveError = (): void => {
      if (typeof document !== 'undefined') {
        setStatus('err', 'Could not save sessions to ~/.minnow');
      }
    };

    if (usePatch) {
      const delta = buildSessionsPatchDelta(sessionState);
      inFlightSessionSave = persistSessionsPatchToServer(delta)
        .then(() => {
          clearSessionDirtySets();
          captureDirtyTrackingShadow(sessionState);
        })
        .catch(reportSaveError)
        .finally(() => {
          inFlightSessionSave = null;
        });
      void import('../ui/hub').then((m) => m.refreshHubLiveData());
      return 'ok';
    }

    // Full-PUT fallback (first save after load, verifier miss, or flag off).
    inFlightSessionSave = persistSessionsPutToServer()
      .then(() => {
        clearSessionDirtySets();
        sessionPatchDirtySetsReady = true;
        captureDirtyTrackingShadow(sessionState);
      })
      .catch(reportSaveError)
      .finally(() => {
        inFlightSessionSave = null;
      });
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
  // Opportunistic dirty hints for callers that know what changed.
  if (hint?.chatId?.trim()) dirtyChatIds.add(hint.chatId.trim());
  if (hint?.groupId?.trim()) markGroupDirty(hint.groupId.trim());
  if (saveTimer) clearTimeout(saveTimer);
  setSaveTimer(
    setTimeout(() => {
      setSaveTimer(null);
      saveSessionsNow();
    }, SAVE_DEBOUNCE_MS)
  );
}

/** Cancel the debounced timer and start a save now (shared by flush helpers). */
function runScheduledSessionSaveImmediately(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    setSaveTimer(null);
  }
  saveSessionsNow();
}

/**
 * Flush any debounced session save before engine commands that require the chat
 * row to exist server-side (e.g. send_message on a freshly created desktop chat).
 */
export async function flushScheduledSessionSave(): Promise<void> {
  runScheduledSessionSaveImmediately();
  if (inFlightSessionSave) {
    await inFlightSessionSave;
  }
}

/** True when the chat id was present in the last dirty-tracking baseline (server hydrate). */
function isChatKnownToServerShadow(chatId: string): boolean {
  if (!dirtyTrackingShadowChatsJson) return false;
  try {
    const shadow = JSON.parse(dirtyTrackingShadowChatsJson) as Array<{ id?: string }>;
    if (!Array.isArray(shadow)) return false;
    return shadow.some((row) => row?.id === chatId);
  } catch {
    return false;
  }
}

/**
 * Ensure a chat row is queued for PATCH/PUT before an engine command.
 * Covers creation paths that forgot touchChat (hero seed, rail new chat, etc.).
 */
export async function ensureChatPersistedBeforeEngineCommand(chatId: string): Promise<void> {
  const id = typeof chatId === 'string' ? chatId.trim() : '';
  if (!id) return;

  const chat = findChatById(id);
  if (chat && !isChatKnownToServerShadow(id)) {
    touchChat(chat);
    if (sessionState?.activeId === id) {
      markSessionScalarsDirty();
    }
  } else if (chat && !dirtyChatIds.has(id)) {
    // Chat existed at hydrate but may still be dirty from an unmarked activeId switch.
    if (sessionState?.activeId === id && !sessionScalarsDirty) {
      markSessionScalarsDirty();
    }
  }

  await flushScheduledSessionSave();
}

/** Run any debounced session save immediately (unit tests only). */
export function flushScheduledSessionSaveForTests(): void {
  if (!saveTimer) return;
  runScheduledSessionSaveImmediately();
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
 * Awaits history hydrate so callers can paint a full transcript after the Promise settles.
 */
export async function switchActiveChat(id: string): Promise<Chat | null> {
  const state = requireSessionState();
  if (id === state.activeId) return null;
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return null;
  state.activeId = id;
  markSessionScalarsDirty();
  rememberActiveChatForWorkspaceKey(normalizeWorkspacePath(chat.workspacePath ?? ''));
  maybeRememberActiveChatForForegroundApp(state, chat);
  scheduleSaveSessions();
  await ensureChatHistoryLoaded(id);
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
