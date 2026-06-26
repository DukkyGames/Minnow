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

/** Resume auto/sequential delegation for boards that were running before reload. */
export async function bootOrchestrateBoardResume(state: SessionState): Promise<void> {
  const oomPause = await probeOomPauseFromElectron();
  setOomPauseActiveForBoot(oomPause);

  if (oomPause) {
    pauseAllRunningBoardsForShutdown();
    for (const group of state.groups ?? []) {
      if (!group.orchestrateBoard) continue;
      const planner = getPlannerChatForGroup(group);
      if (!planner) continue;
      await recoverInterruptedMergesAfterReload(group, planner);
    }
    return;
  }

  for (const group of state.groups ?? []) {
    if (!group.orchestrateBoard) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    await recoverInterruptedMergesAfterReload(group, planner);
    if (!isBoardRunning(group)) continue;
    await resumeBoardExecutionAfterReload(group, planner);
  }
}
