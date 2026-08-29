/**
 * Boot-time resume for orchestrate boards after page reload.
 * Mirrors generation-resume.ts for chat.currentGenerationId.
 */

import { getPlannerChatForGroup } from '../../state/chat-groups.ts';
import {
  pauseAllRunningBoardsForShutdown,
  recoverInterruptedMergesAfterReload,
  resumeBoardExecutionAfterReload,
} from '../../state/orchestrate-board-actions.ts';
import { isBoardRunning } from '../../state/orchestrate-board-store.ts';
import type { SessionState } from '../../types.ts';
import {
  probeOomPauseFromElectron,
  setOomPauseActiveForBoot,
} from './oom-recovery.ts';
import { syncAfkBoardPowerGuardFromSession } from './board-afk-power.ts';
import { initOrchestrateBoardDisplayWake } from './board-display-wake.ts';

/**
 * Repair-only half of boot resume: wake hooks, OOM probe, and interrupted-merge
 * recovery. Safe to run before the user has answered the resume prompt, and runs
 * whichever way they answer — it fixes state that was left half-written, it does
 * not start new work.
 *
 * Returns true when an OOM pause short-circuited the boot (boards are paused and
 * wait for an explicit Start, so there is nothing left to resume).
 */
export async function bootOrchestrateBoardRepair(state: SessionState): Promise<boolean> {
  initOrchestrateBoardDisplayWake();
  const oomPause = await probeOomPauseFromElectron();
  setOomPauseActiveForBoot(oomPause);

  if (oomPause) {
    pauseAllRunningBoardsForShutdown();
  }

  for (const group of state.groups ?? []) {
    if (!group.orchestrateBoard) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    await recoverInterruptedMergesAfterReload(group, planner);
  }
  syncAfkBoardPowerGuardFromSession(state);
  return oomPause;
}

/** Resume auto/sequential delegation for boards that were running before reload. */
export async function bootOrchestrateBoardResume(state: SessionState): Promise<void> {
  const oomPause = await bootOrchestrateBoardRepair(state);
  if (oomPause) return;
  await resumeRunningBoardsAfterGate(state);
}

/** Resume every still-running board (post-prompt half of `bootOrchestrateBoardResume`). */
export async function resumeRunningBoardsAfterGate(state: SessionState): Promise<void> {
  for (const group of state.groups ?? []) {
    if (!group.orchestrateBoard) continue;
    if (!isBoardRunning(group)) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    await resumeBoardExecutionAfterReload(group, planner);
  }
}
