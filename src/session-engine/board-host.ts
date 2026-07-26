/**
 * Session Engine board host (MIN-360 Phase 2).
 *
 * Bridges engine-owned SessionState into the existing orchestrate board modules
 * (tsx-imported), installs the engine chat-turn runner, and resumes auto/AFK
 * boards on server boot so progress continues with zero connected devices.
 */

import { setStreaming } from '../app-state.ts';
import {
  recoverInterruptedMergesAfterReload,
  resumeBoardExecutionAfterReload,
  setBoardChatTurnRunner,
} from '../state/orchestrate-board-actions.ts';
import { isBoardRunning } from '../state/orchestrate-board-store.ts';
import { getPlannerChatForGroup } from '../state/chat-groups.ts';
import { setEngineOwnsBoardDrive } from '../state/board-driver-gate.ts';
import {
  scheduleSaveSessions,
  sessionState,
  setSessionStateForEngineHost,
  setEngineHostPersistHook,
} from '../state/sessions.ts';
import type { SessionState } from '../types.ts';
import { runBoardEngineChatTurn } from './board-turn-runner.ts';

let hostActive = false;
let bootResumePromise: Promise<void> | null = null;

/** True when this Node process is hosting the board scheduler. */
export function isEngineBoardHostActive(): boolean {
  return hostActive;
}

/**
 * Bind engine SessionState into sessions.ts, install turn runner + persist hook,
 * and claim board drive (bypass Phase 0 lease for this process).
 */
export async function activateEngineBoardHost(): Promise<void> {
  if (hostActive) return;

  const { getEngineSessionState, publishLiveEngineState } = await import(
    '../../server/session/engine-api.js'
  );

  const state = getEngineSessionState() as SessionState | null;
  if (!state || typeof state !== 'object') {
    throw new Error('Session engine has no state for board host');
  }

  // Engine is the sole board driver when the flag is on.
  setEngineOwnsBoardDrive(true);
  setBoardChatTurnRunner(runBoardEngineChatTurn);

  // Persist board mutations through the engine publish path (no client PUT).
  setEngineHostPersistHook(() => {
    void publishLiveEngineState({ soft: true }).catch((err) => {
      console.error('[session-engine] board host persist failed:', err);
    });
  });

  setSessionStateForEngineHost(state);
  hostActive = true;
}

/** Tear down host bindings (tests / shutdown). */
export async function deactivateEngineBoardHost(): Promise<void> {
  setBoardChatTurnRunner(null);
  setEngineHostPersistHook(null);
  setEngineOwnsBoardDrive(false);
  setSessionStateForEngineHost(null);
  setStreaming(false);
  hostActive = false;
  bootResumePromise = null;
}

/**
 * After server boot: reconcile interrupted merges and resume autoRunning boards.
 * Idempotent — safe to call once per process start.
 */
export async function resumeEngineBoardsOnBoot(): Promise<void> {
  await activateEngineBoardHost();
  if (bootResumePromise) {
    await bootResumePromise;
    return;
  }
  bootResumePromise = (async () => {
    const state = sessionState;
    if (!state?.groups?.length) return;

    for (const group of state.groups) {
      if (!group.orchestrateBoard) continue;
      const planner = getPlannerChatForGroup(group);
      if (!planner) continue;
      await recoverInterruptedMergesAfterReload(group, planner);
      if (!isBoardRunning(group)) continue;
      await resumeBoardExecutionAfterReload(group, planner);
    }
    // Flush any resume-side mutations immediately.
    scheduleSaveSessions();
  })();
  try {
    await bootResumePromise;
  } finally {
    // Keep host active; allow a later explicit re-resume in tests by clearing.
  }
}

/** Re-bind sessionState after engine hard-replaces its blob (clone commits). */
export function rebindEngineBoardHostSession(): void {
  if (!hostActive) return;
  void import('../../server/session/engine-api.js').then(({ getEngineSessionState }) => {
    const state = getEngineSessionState() as SessionState | null;
    if (state) setSessionStateForEngineHost(state);
  });
}

/** Test helper: reset boot-resume latch without full deactivate. */
export function resetEngineBoardHostBootForTests(): void {
  bootResumePromise = null;
}
