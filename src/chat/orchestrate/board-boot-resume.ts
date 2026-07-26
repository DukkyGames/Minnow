/**
 * Boot-time resume for orchestrate boards after page reload.
 * Mirrors generation-resume.ts for chat.currentGenerationId.
 *
 * Phase 4 (MIN-362): Session Engine is default-on and resumes boards on
 * server boot — this renderer path is a no-op unless emergency opt-out
 * (MINNOW_SERVER_ENGINE=0) restores legacy single-device drive.
 */

import { getPlannerChatForGroup } from '../../state/chat-groups.ts';
import {
  pauseAllRunningBoardsForShutdown,
  recoverInterruptedMergesAfterReload,
  resumeBoardExecutionAfterReload,
} from '../../state/orchestrate-board-actions.ts';
import { isBoardRunning } from '../../state/orchestrate-board-store.ts';
import type { SessionState } from '../../types.ts';
import { canDriveOrchestrateBoard } from '../../state/board-driver-gate.ts';
import { isServerEngineEnabled } from '../../state/server-engine-flag.ts';
import {
  probeOomPauseFromElectron,
  setOomPauseActiveForBoot,
} from './oom-recovery.ts';

/** Resume auto/sequential delegation for boards that were running before reload. */
export async function bootOrchestrateBoardResume(state: SessionState): Promise<void> {
  // Default path: engine owns board resume on server boot — do not double-drive.
  if (isServerEngineEnabled()) return;

  const oomPause = await probeOomPauseFromElectron();
  setOomPauseActiveForBoot(oomPause);

  if (oomPause) {
    if (canDriveOrchestrateBoard()) {
      pauseAllRunningBoardsForShutdown();
    }
    for (const group of state.groups ?? []) {
      if (!group.orchestrateBoard) continue;
      const planner = getPlannerChatForGroup(group);
      if (!planner) continue;
      if (canDriveOrchestrateBoard()) {
        await recoverInterruptedMergesAfterReload(group, planner);
      }
    }
    return;
  }

  for (const group of state.groups ?? []) {
    if (!group.orchestrateBoard) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    if (canDriveOrchestrateBoard()) {
      await recoverInterruptedMergesAfterReload(group, planner);
    }
    if (!isBoardRunning(group)) continue;
    if (!canDriveOrchestrateBoard()) continue;
    await resumeBoardExecutionAfterReload(group, planner);
  }
}
