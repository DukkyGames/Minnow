/**
 * Session Engine sub-agent controller host (MIN-361 Phase 3).
 *
 * Runs the controller registry / scheduler / watchdog in the engine process so
 * sub-agent work survives renderer disconnect and live status fans out over
 * Phase 0 SessionState SSE.
 */

import {
  ensureControllerReady,
  initControllerPersistence,
} from '../agents/controller/controller.ts';
import {
  isEngineControllerHostActive as gateIsActive,
  setEngineOwnsController,
} from '../agents/controller/host-gate.ts';
import {
  setLiveSubAgentPublishHook,
  startLiveSubAgentPublish,
  stopLiveSubAgentPublish,
} from '../agents/controller/live-publish.ts';
import { initOrchestratorAutoReports } from '../agents/controller/report.ts';
import { startWatchdog, stopWatchdog } from '../agents/controller/watchdog.ts';
import { initSubAgentSessionPersistence } from '../state/sub-agent-session-sync.ts';
import { activateEngineBoardHost } from './board-host.ts';

let bootPromise: Promise<void> | null = null;

/** True when this Node process owns the sub-agent controller registry. */
export function isEngineControllerHostActive(): boolean {
  return gateIsActive();
}

/**
 * Activate engine ownership: board session alias, persistence reconcile,
 * watchdog, auto-reports, and live SSE publish.
 */
export async function activateEngineControllerHost(): Promise<void> {
  if (gateIsActive()) return;

  // Claim ownership before importing/starting so module auto-boot stays off.
  setEngineOwnsController(true);

  // Board host provides sessionState alias for syncBoardTask* + reports.
  await activateEngineBoardHost();

  const { publishLiveEngineState } = await import(
    '../../server/session/engine-api.js'
  );

  setLiveSubAgentPublishHook(async (soft) => {
    await publishLiveEngineState({ soft });
  });

  // Terminal runs still land on chat.subAgentRuns for drawer restore.
  initSubAgentSessionPersistence();
  // Planner lifecycle reports (stream-end bus is in-process under Phase 2).
  initOrchestratorAutoReports();

  await initControllerPersistence();
  startWatchdog();
  startLiveSubAgentPublish();
}

/**
 * Boot path: reconcile persisted registry + start watchdog once per process.
 * Idempotent — safe to call from server.js after ensureSessionEngineBooted.
 */
export async function bootEngineControllerOnStart(): Promise<void> {
  if (bootPromise) {
    await bootPromise;
    return;
  }
  bootPromise = (async () => {
    await activateEngineControllerHost();
    // ensureControllerReady is a no-op once init has completed; keeps spawn paths honest.
    await ensureControllerReady();
  })();
  try {
    await bootPromise;
  } catch (err) {
    bootPromise = null;
    throw err;
  }
}

/** Tear down host bindings (tests / shutdown). */
export async function deactivateEngineControllerHost(): Promise<void> {
  stopLiveSubAgentPublish();
  stopWatchdog();
  setEngineOwnsController(false);
  bootPromise = null;
}

/** Test helper: reset boot latch without full deactivate. */
export function resetEngineControllerHostBootForTests(): void {
  bootPromise = null;
}
