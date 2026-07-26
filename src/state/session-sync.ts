/**
 * Multi-device session state sync (Phase 0 / MIN-357).
 * Subscribes to GET /api/session/stream and reconciles remote revisions.
 * Manages the orchestrate board driver lease via POST /api/session/lease.
 */

import { streamingChatIds } from '../app-state';
import { withSessionToken } from '../api/session-token';
import { subscribeChatStreamEnd } from '../chat/streaming-state';
import { isServerStorageMode } from '../config/storage-mode';
import { randomUUID } from '../lib/random-id';
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
import { renderChatFromHistory } from '../ui/messages';
import { isBoardRunning } from './orchestrate-board-store';
import {
  canDriveOrchestrateBoard as canDriveFromGate,
  setBoardDriverLeaseProbe,
  setEngineOwnsBoardDrive,
  setServerEngineFlagProbe,
} from './board-driver-gate';

export { setEngineOwnsBoardDrive };

const DRIVER_ID_KEY = 'minnow.sessionDriverId';
const LEASE_RENEW_MS = 15_000;
/** Poll while a remote patch is buffered during local stream/board drive. */
const PENDING_FLUSH_MS = 2_000;

let syncInitialized = false;
let eventSource: EventSource | null = null;
let leaseTimer: ReturnType<typeof setInterval> | null = null;
let pendingFlushTimer: ReturnType<typeof setInterval> | null = null;
let streamEndUnsub: (() => void) | null = null;

let holdsBoardDriverLease = false;
let remoteDriverLabel: string | null = null;

/**
 * Latest remote snapshot/patch deferred while this client is streaming or
 * driving a local board. Must not advance sessionRev until applied — otherwise
 * the one-shot SSE event is lost and the client stays permanently stale.
 */
let pendingRemote: { rev: number; state: unknown } | null = null;

/** Bearer token for /api/session/* when MINNOW_TOKEN is set on the server. */
function sessionAuthHeaders(): Record<string, string> {
  const token =
    typeof import.meta.env.VITE_MINNOW_TOKEN === 'string'
      ? import.meta.env.VITE_MINNOW_TOKEN.trim()
      : '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** Stable per-tab driver id persisted for lease claim/renew. */
export function getSessionDriverId(): string {
  try {
    const existing = sessionStorage.getItem(DRIVER_ID_KEY);
    if (existing?.trim()) return existing.trim();
    const id = randomUUID();
    sessionStorage.setItem(DRIVER_ID_KEY, id);
    return id;
  } catch {
    return randomUUID();
  }
}

function deviceLeaseLabel(): string {
  if (typeof navigator === 'undefined') return 'Minnow';
  const ua = navigator.userAgent;
  if (/Electron/i.test(ua)) return 'Desktop';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'Phone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mobile/i.test(ua)) return 'Mobile';
  return 'Browser';
}

/** True when this client/process may run board auto-drive / delegation. */
export function canDriveOrchestrateBoard(): boolean {
  return canDriveFromGate();
}

/** True when another device holds the board driver lease. */
export function isBoardDrivenRemotely(): boolean {
  if (!isServerStorageMode() || !syncInitialized) return false;
  return !holdsBoardDriverLease && remoteDriverLabel != null;
}

/** Label for the remote driver (read-only board banner). */
export function getRemoteBoardDriverLabel(): string | null {
  return remoteDriverLabel;
}

function isAnyChatStreaming(): boolean {
  return streamingChatIds.size > 0;
}

function hasLocalRunningBoard(): boolean {
  if (!sessionState?.groups?.length) return false;
  return sessionState.groups.some((g) => isBoardRunning(g));
}

/** Skip remote reconcile while this client is actively streaming or driving. */
function shouldSkipRemoteReconcile(): boolean {
  if (isAnyChatStreaming()) return true;
  if (holdsBoardDriverLease && hasLocalRunningBoard()) return true;
  return false;
}

async function refreshUiAfterRemoteSession(): Promise<void> {
  if (!sessionState) return;
  try {
    renderSidebar();
    renderChatFromHistory(getActiveChat());
    // Engine mode: subscribe to generation token streams from currentGenerationId.
    const { syncEngineStreamMirrors } = await import('../chat/engine-stream-mirror');
    syncEngineStreamMirrors();
    for (const group of sessionState.groups ?? []) {
      if (group.orchestrateBoard) {
        emitBoardChange(group.id);
      }
    }
    const { syncOrchestrateBoardRemoteDriverBanner } = await import(
      '../ui/orchestrate-board-remote-driver'
    );
    syncOrchestrateBoardRemoteDriverBanner();
  } catch (err) {
    reportBackgroundError('session-sync-ui', err);
  }
}

function stopPendingFlushTimer(): void {
  if (!pendingFlushTimer) return;
  clearInterval(pendingFlushTimer);
  pendingFlushTimer = null;
}

/** Apply a buffered remote payload once local stream/board activity clears. */
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
  // Board autoRunning can clear without a stream-end event — poll until flushable.
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

async function postLease(action: 'claim' | 'renew' | 'release'): Promise<void> {
  const res = await fetch('/api/session/lease', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...sessionAuthHeaders(),
    },
    body: JSON.stringify({
      driverId: getSessionDriverId(),
      action,
      label: deviceLeaseLabel(),
    }),
  });
  if (!res.ok) return;
  const body = (await res.json()) as {
    held?: boolean;
    holder?: { label?: string };
    lease?: { driverId?: string; label?: string } | null;
  };
  holdsBoardDriverLease = body.held === true;
  if (holdsBoardDriverLease) {
    remoteDriverLabel = null;
    return;
  }
  const holder = body.holder ?? body.lease;
  const holderId =
    holder && typeof holder === 'object' && 'driverId' in holder
      ? String((holder as { driverId?: string }).driverId ?? '')
      : '';
  if (holderId && holderId !== getSessionDriverId()) {
    remoteDriverLabel =
      holder && typeof holder.label === 'string' && holder.label.trim()
        ? holder.label.trim()
        : 'another device';
  } else {
    remoteDriverLabel = null;
  }
}

/** Claim the board driver lease (call before board boot resume). */
export async function ensureBoardDriverLease(): Promise<boolean> {
  if (!isServerStorageMode()) {
    holdsBoardDriverLease = true;
    return true;
  }
  await postLease('claim');
  return holdsBoardDriverLease;
}

function startLeaseHeartbeat(): void {
  if (leaseTimer) return;
  leaseTimer = setInterval(() => {
    void postLease('renew').then(() => {
      // Lease/board state may have changed — try applying any buffered remote.
      flushPendingRemote();
      void import('../ui/orchestrate-board-remote-driver').then((m) =>
        m.syncOrchestrateBoardRemoteDriverBanner(),
      );
    });
  }, LEASE_RENEW_MS);
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

/** Start SSE subscription + lease heartbeat (server storage mode only). */
export function initSessionSync(): void {
  if (syncInitialized || !isServerStorageMode()) return;
  syncInitialized = true;
  // Wire Phase 0 lease probe into the DOM-free board drive gate.
  setBoardDriverLeaseProbe(() => {
    if (!syncInitialized) return true;
    return holdsBoardDriverLease;
  });
  void import('./server-engine-flag').then(({ isServerEngineEnabled }) => {
    setServerEngineFlagProbe(() => isServerEngineEnabled());
  });
  connectSessionStream();
  // Flush deferred remotes as soon as any local stream ends.
  streamEndUnsub = subscribeChatStreamEnd(() => {
    flushPendingRemote();
  });
  // Flag-on: engine owns board drive — skip lease claim/renew for board guards.
  void import('./server-engine-flag').then(({ isServerEngineEnabled }) => {
    if (isServerEngineEnabled()) return;
    void ensureBoardDriverLease().then(() => {
      startLeaseHeartbeat();
      void import('../ui/orchestrate-board-remote-driver').then((m) =>
        m.syncOrchestrateBoardRemoteDriverBanner(),
      );
    });
  });
}

/** Release lease on shutdown (best-effort). */
export function shutdownSessionSync(): void {
  if (leaseTimer) {
    clearInterval(leaseTimer);
    leaseTimer = null;
  }
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
  if (isServerStorageMode()) {
    void postLease('release');
  }
}

/** Test helper: reset module state. */
export function resetSessionSyncForTests(): void {
  shutdownSessionSync();
  syncInitialized = false;
  holdsBoardDriverLease = false;
  remoteDriverLabel = null;
  pendingRemote = null;
}
