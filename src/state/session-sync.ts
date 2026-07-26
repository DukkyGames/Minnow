/**
 * Multi-device session state sync (Phase 0 / MIN-357 + Phase 4 / MIN-362).
 * Subscribes to GET /api/session/stream and reconciles remote revisions.
 *
 * Phase 4: the Phase 0 board driver lease is removed. The Session Engine is
 * the sole chat/board/controller driver when enabled (default). This module
 * is a read-model hydrate + UI refresh path only.
 */

import { streamingChatIds } from '../app-state';
import { withSessionToken } from '../api/session-token';
import {
  isActiveChatEngineTurnActive,
  notifyChatStreamEnded,
  subscribeChatStreamEnd,
} from '../chat/streaming-state';
import { isServerStorageMode } from '../config/storage-mode';
import { reportBackgroundError } from '../boot/report-background-error';
import {
  applyRemoteSessionState,
  getActiveChat,
  getSessionRev,
  sessionState,
  setSessionRev,
} from './sessions';
import { emitBoardChange } from './orchestrate-board-events';
import { renderSidebar } from '../ui/sidebar';
import { renderChatInForegroundShell } from '../ui/messages';
import { syncComposerFromStreamingState } from '../ui/composer-send';
import { isBoardRunning } from './orchestrate-board-store';
import {
  canDriveOrchestrateBoard as canDriveFromGate,
  setEngineOwnsBoardDrive,
  setServerEngineFlagProbe,
} from './board-driver-gate';
import { isServerEngineEnabled } from './server-engine-flag';

export { setEngineOwnsBoardDrive };

/** Poll while a remote patch is buffered during local stream activity. */
const PENDING_FLUSH_MS = 2_000;

let syncInitialized = false;
let eventSource: EventSource | null = null;
let pendingFlushTimer: ReturnType<typeof setInterval> | null = null;
let streamEndUnsub: (() => void) | null = null;

/**
 * Latest remote snapshot/patch deferred while this client is streaming.
 * Must not advance sessionRev until applied — otherwise the one-shot SSE
 * event is lost and the client stays permanently stale.
 */
let pendingRemote: { rev: number; state: unknown } | null = null;
/** Track engine-turn edges so we can fire stream-end + composer sync when a turn settles. */
let prevActiveEngineTurnActive = false;

/** True when this client/process may run board auto-drive / delegation. */
export function canDriveOrchestrateBoard(): boolean {
  return canDriveFromGate();
}

function isAnyChatStreaming(): boolean {
  return streamingChatIds.size > 0;
}

function hasLocalRunningBoard(): boolean {
  if (!sessionState?.groups?.length) return false;
  return sessionState.groups.some((g) => isBoardRunning(g));
}

/**
 * Skip remote reconcile while this client is actively streaming tokens.
 * Under the engine (default), the server owns board drive — do not buffer for
 * board autoRunning (that would stall multi-device views for the whole run).
 * Emergency opt-out may still drive boards in the renderer.
 */
function shouldSkipRemoteReconcile(): boolean {
  if (isAnyChatStreaming()) return true;
  if (!isServerEngineEnabled() && hasLocalRunningBoard()) return true;
  return false;
}

async function refreshUiAfterRemoteSession(): Promise<void> {
  if (!sessionState) return;
  try {
    const active = getActiveChat();
    const engineTurnActive = isActiveChatEngineTurnActive();
    renderSidebar();
    // Paint the visible transcript shell (desktop / chat app / code), not always #chatArea.
    renderChatInForegroundShell(active);
    if (prevActiveEngineTurnActive && !engineTurnActive) {
      notifyChatStreamEnded(active.id);
    }
    prevActiveEngineTurnActive = engineTurnActive;
    syncComposerFromStreamingState();
    // Engine mode: subscribe to generation token streams from currentGenerationId.
    const { syncEngineStreamMirrors } = await import('../chat/engine-stream-mirror');
    syncEngineStreamMirrors();
    // Engine ask_question pause: open the existing strip from pendingAskQuestion.
    const { syncEngineAskQuestionUi } = await import('../chat/engine-ask-question-mirror');
    syncEngineAskQuestionUi();
    for (const group of sessionState.groups ?? []) {
      if (group.orchestrateBoard) {
        emitBoardChange(group.id);
      }
    }
  } catch (err) {
    reportBackgroundError('session-sync-ui', err);
  }
}

function stopPendingFlushTimer(): void {
  if (!pendingFlushTimer) return;
  clearInterval(pendingFlushTimer);
  pendingFlushTimer = null;
}

/** Apply a buffered remote payload once local stream activity clears. */
function flushPendingRemote(): void {
  if (!pendingRemote) {
    stopPendingFlushTimer();
    return;
  }
  if (shouldSkipRemoteReconcile()) return;

  const { rev, state } = pendingRemote;
  pendingRemote = null;
  stopPendingFlushTimer();

  if (rev <= getSessionRev()) return;
  applyRemoteSessionState(state);
  setSessionRev(rev);
  mirrorLiveSubAgentRunsFromSession();
  void refreshUiAfterRemoteSession();
}

function ensurePendingFlushTimer(): void {
  if (pendingFlushTimer || !pendingRemote) return;
  // Board autoRunning (opt-out path) can clear without a stream-end event — poll.
  pendingFlushTimer = setInterval(() => {
    flushPendingRemote();
  }, PENDING_FLUSH_MS);
}

function handleRemotePayload(payload: { rev?: number; state?: unknown }): void {
  const rev = typeof payload.rev === 'number' ? payload.rev : 0;
  if (rev <= getSessionRev()) return;
  if (!payload.state) return;

  if (shouldSkipRemoteReconcile()) {
    // Buffer only — do not bump rev (SSE will not re-send this revision).
    if (!pendingRemote || rev >= pendingRemote.rev) {
      pendingRemote = { rev, state: payload.state };
    }
    ensurePendingFlushTimer();
    return;
  }

  // A live apply supersedes any older buffered remote.
  if (pendingRemote && pendingRemote.rev <= rev) {
    pendingRemote = null;
    stopPendingFlushTimer();
  }

  applyRemoteSessionState(payload.state);
  setSessionRev(rev);
  mirrorLiveSubAgentRunsFromSession();
  void refreshUiAfterRemoteSession();
}

/** Feed UI subscribeSubAgentRuns from engine-published liveSubAgentRuns (MIN-361). */
function mirrorLiveSubAgentRunsFromSession(): void {
  void import('../agents/controller/client-live-mirror.ts').then((mod) => {
    mod.mirrorRemoteLiveSubAgentRuns(sessionState);
  });
}

function connectSessionStream(): void {
  if (eventSource) return;
  // EventSource cannot set Authorization / X-Minnow-Token — append ?token= (session)
  // and optional ?minnowToken= when VITE_MINNOW_TOKEN mirrors server MINNOW_TOKEN.
  let streamPath = withSessionToken('/api/session/stream');
  const minnowToken =
    typeof import.meta.env.VITE_MINNOW_TOKEN === 'string'
      ? import.meta.env.VITE_MINNOW_TOKEN.trim()
      : '';
  if (minnowToken) {
    const sep = streamPath.includes('?') ? '&' : '?';
    streamPath = `${streamPath}${sep}minnowToken=${encodeURIComponent(minnowToken)}`;
  }
  eventSource = new EventSource(streamPath);

  eventSource.addEventListener('snapshot', (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent).data) as {
        rev?: number;
        state?: unknown;
      };
      handleRemotePayload(payload);
    } catch (err) {
      reportBackgroundError('session-sync-snapshot', err);
    }
  });

  eventSource.addEventListener('patch', (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent).data) as {
        rev?: number;
        state?: unknown;
      };
      handleRemotePayload(payload);
    } catch (err) {
      reportBackgroundError('session-sync-patch', err);
    }
  });

  eventSource.onerror = () => {
    /* EventSource auto-reconnects */
  };
}

/** Start SSE subscription (server storage mode only). */
export function initSessionSync(): void {
  if (syncInitialized || !isServerStorageMode()) return;
  syncInitialized = true;
  // Wire engine-flag probe into the DOM-free board drive gate.
  setServerEngineFlagProbe(() => isServerEngineEnabled());
  connectSessionStream();
  // Flush deferred remotes as soon as any local stream ends.
  streamEndUnsub = subscribeChatStreamEnd(() => {
    flushPendingRemote();
  });
}

/** Tear down SSE on shutdown (best-effort). */
export function shutdownSessionSync(): void {
  stopPendingFlushTimer();
  if (streamEndUnsub) {
    streamEndUnsub();
    streamEndUnsub = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  pendingRemote = null;
}

/** Test helper: reset module state. */
export function resetSessionSyncForTests(): void {
  shutdownSessionSync();
  syncInitialized = false;
  pendingRemote = null;
  prevActiveEngineTurnActive = false;
}
